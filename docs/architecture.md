# Architecture

## Overview

Femtoclaw is a lightweight multi-user conversational agent service built directly on the Anthropic Messages API. It does not use the Claude Agent SDK or Docker-based process isolation. Instead, it achieves user and conversation isolation at the application layer, exposes only safe built-in tools (no shell, no filesystem), and keeps system prompts compact (~8KB vs picoclaw's ~32KB).

### Design Principles

- **No shell, no filesystem**: The agent cannot execute commands or read/write files. All external interaction happens through safe built-in tools and MCP.
- **Business-layer isolation**: User data separation is enforced by `userId` checks at every storage and tool boundary, not by OS-level containers.
- **Stateless service**: All persistent state lives in external storage (SQLite locally, or API/MCP backends). The service itself can be stopped and restarted without data loss.
- **Incremental client, bounded-replay server**: Clients send only the current message. The server reloads history from storage and rebuilds Anthropic `messages[]` on each turn using a recent message window.

---

## System Architecture

```
+-----------------------------------------------------------+
|                      Client (Web/App)                     |
+-----------------------------+-----------------------------+
                              | HTTP / SSE
                              v
+-----------------------------------------------------------+
|                      Femtoclaw Server                     |
|                                                           |
|  +-------------+  +--------------+  +------------------+ |
|  | Express      |  | Auth / Rate  |  | Request ID       | |
|  | Router       |  | Middleware   |  | Logging          | |
|  +------+------+  +------+-------+  +--------+---------+ |
|         |                |                    |           |
|         v                v                    v           |
|  +----------------------------------------------------+  |
|  |              Conversation Manager                   |  |
|  |  +----------------------------------------------+  |  |
|  |  | Per-Conversation Lock (queue-based mutex)     |  |  |
|  |  +----------------------------------------------+  |  |
|  +------------------------+---------------------------+  |
|                           |                              |
|         +-----------------+------------------+           |
|         v                 v                  v           |
|  +------------+   +--------------+   +---------------+  |
|  | Agent       |   | Skill        |   | MCP Client    |  |
|  | Engine      |   | Manager      |   | Pool          |  |
|  |             |   |              |   |               |  |
|  | Messages    |   | builtin      |   | managed       |  |
|  | API loop    |   | org-level    |   | per-request   |  |
|  +------+------+   +--------------+   +-------+-------+  |
|         |                                     |          |
|         v                                     v          |
|  +----------------------------------------------------+  |
|  |                Tool Executor                        |  |
|  |                                                     |  |
|  |  Built-in: Skill, WebSearch, WebFetch, Memory,      |  |
|  |            TodoWrite, SendMessage, AskUserQuestion   |  |
|  |  MCP:      mcp__<server>__<tool> (dynamic)           |  |
|  +------------------------+---------------------------+  |
|                           |                              |
+---------------------------+------------------------------+
                            |
              +-------------+---------------+
              v             v               v
     +----------+    +-----------+    +-----------+
     | Anthropic |    | MCP       |    | Memory    |
     | Messages  |    | Servers   |    | Service   |
     | API       |    | (external)|    | (external)|
     +----------+    +-----------+    +-----------+
```

---

## Request Lifecycle

A `POST /chat` request follows this path:

```
1. Express receives request
   |
2. requestIdMiddleware      assigns X-Request-ID
   |
3. authMiddleware           validates Bearer token, extracts UserContext
   |
4. rateLimitMiddleware      checks per-user RPM budget
   |
5. chatRoutes handler       validates body with Zod schema
   |
6. ConversationManager      getOrCreateConversation(userId, conversationId)
   |
7. ConversationLock         acquireLock(conversationId)  -- serializes
   |                                                        same-conversation
8. ConversationStore        getMessages(conversationId)  -- reload history
   |
9. AgentEngine.run()        builds system prompt
   |                        builds user preamble (skills + memory)
   |                        assembles Anthropic messages[]
   |                        enters agent loop:
   |                          messages.create() --> stream events
   |                          tool_use? --> executeTool() --> loop
   |                          end_turn? --> exit loop
   |                        returns newMessages + usage
   |
10. persistMessages()       appendMessages to ConversationStore
    |
11. lock.release()          in finally{} block
    |
12. SSE stream closes       (or JSON response sent)
```

Key invariant: step 7 ensures **at most one agent loop runs per conversation at any time**. A second request to a busy conversation receives `409 Conflict`.

---

## Module Reference

### Boot & Server (`src/index.ts`, `src/server.ts`)

`main()` in `index.ts` wires all dependencies in order:

```
ConversationStore (factory)
  --> ConversationLock
    --> ConversationManager(store, lock)
SkillManager(builtin, org?, user?) --> loadSkills()
McpClientPool --> init()
MemoryService (factory, pool)
  --> ServerDeps { conversationManager, skillManager, memoryService, mcpClientPool }
    --> createApp(deps) --> listen(PORT)
```

`createApp()` in `server.ts` assembles the Express middleware chain:

| Order | Middleware            | Path       | Purpose                           |
| ----- | --------------------- | ---------- | --------------------------------- |
| 1     | `express.json`        | all        | Body parsing (1MB limit)          |
| 2     | `requestIdMiddleware` | all        | `X-Request-ID` header             |
| 3     | Version headers       | all        | `X-Build-Version`, `X-Build-Commit` |
| 4     | Request logging       | all        | Duration, status code, method     |
| 5     | `healthRoutes`        | `/health`  | No auth required                  |
| 6     | `authMiddleware`      | all below  | Bearer token + UserContext        |
| 7     | `rateLimitMiddleware` | all below  | Per-user RPM with headers         |
| 8     | `chatRoutes`          | `/chat`    | Core chat API                     |
| 9     | `skillRoutes`         | `/skills`  | Skill manifest                    |
| 10    | `adminRoutes`         | `/admin`   | Skill reload                      |
| 11    | 404 handler           | fallback   | Unknown routes                    |
| 12    | `errorHandler`        | fallback   | Uncaught exceptions               |

Graceful shutdown handles `SIGTERM`/`SIGINT`: stops accepting connections, closes MCP pool, closes database.

### Agent Engine (`src/agent/engine.ts`)

The core class `AgentEngine` implements the Anthropic Messages API loop:

```typescript
class AgentEngine {
  constructor(skillManager, memoryService, mcpClientPool)

  async run(
    input: AgentRunInput,
    onEvent: (event: StreamEvent) => void,
    waitForUserInput: (toolUseId: string) => Promise<InputResponse>,
    abortSignal?: AbortSignal,
  ): Promise<AgentRunResult>
}
```

The `run()` method:

1. **Builds system prompt** via `buildSystemPrompt()` — 2 blocks with `cache_control: ephemeral`.
2. **Builds tool list** — merges built-in tools (filtered by allowlist) with MCP tools discovered from the pool.
3. **Builds user preamble** via `buildUserMessagePreamble()` — skill manifest + memory summaries injected as `<system-reminder>` blocks in the first user message.
4. **Reconstructs messages** from `existingMessages` (stored as JSON strings) into Anthropic `ContentBlock[]`.
5. **Agent loop** (max 25 iterations):
   - Calls `anthropic.messages.create({ stream: true, ... })`
   - Accumulates assistant content blocks from the stream
   - If `tool_use` blocks are present:
     - Special-case `AskUserQuestion`: emits `input_required` + `message_paused` SSE events, then either pauses (non-streaming) or waits for user input (streaming)
     - All other tools: dispatches through `executeTool()`
     - Appends tool results, continues loop
   - If no tool calls: loop ends (`end_turn`)
6. **Token budget check** after each iteration — triggers compaction if estimate exceeds `COMPACTION_THRESHOLD`.
7. **MCP cleanup** — closes per-request transient connections.

### Context Builder (`src/agent/context-builder.ts`)

Assembles the three-layer prompt structure:

```
System Prompt Block 0: CORE_SYSTEM_PROMPT (~4KB, cached)
  - Identity and role definition
  - Tool usage instructions (Skill, WebSearch, WebFetch, Memory, etc.)
  - Behavior rules and output style
  - Safety constraints
  - Environment variables (time, timezone, assistant name)

System Prompt Block 1: Org Instructions (optional, cached)
  - Loaded from ORG_INSTRUCTIONS_PATH
  - Template variables replaced (assistant_name, user_id, etc.)

User Message Preamble (per-turn, dynamic):
  - <system-reminder> skill manifest (available skills list)
  - <system-reminder> memory summaries (key + description, no values)
  - Actual user message text
```

Both system blocks use `cache_control: { type: 'ephemeral' }` for Anthropic prompt caching.

### Tool System (`src/tools/`)

**Registration** (`index.ts`): Seven built-in tools registered in a `Map`:

| Tool              | Source File            | Purpose                           |
| ----------------- | ---------------------- | --------------------------------- |
| `Skill`           | `skill.ts`             | Load skill instructions           |
| `WebSearch`       | `web-search.ts`        | DuckDuckGo search                 |
| `WebFetch`        | `web-fetch.ts`         | Fetch HTTP/HTTPS URLs             |
| `Memory`          | `memory.ts`            | User memory CRUD + search         |
| `TodoWrite`       | `todo-write.ts`        | In-memory per-conversation tasks  |
| `SendMessage`     | `send-message.ts`      | Emit intermediate SSE message     |
| `AskUserQuestion` | `ask-user-question.ts` | Structured questions with options |

**Allowlisting**: Two-layer filter — server-level `ALLOWED_TOOLS` env var (comma-separated or `*`) and per-request `allowed_tools` array. A tool must pass both layers to be visible to the model.

**Execution** (`executor.ts`): Three-step dispatch:

```
1. Try built-in tool (getToolByName)
   |-- found --> call tool.execute(input, context) --> wrap as ToolResultBlock
   |
2. Try MCP tool (parseMcpToolName extracts server + tool from mcp__server__tool)
   |-- found --> call mcpClientPool.callTool(server, tool, input) --> map result
   |
3. Neither --> return { is_error: true, content: "Unknown tool" }
```

### Skill System (`src/skills/`)

**Loading** (`loader.ts`): Reads `SKILL.md` files from directories, parses YAML frontmatter for metadata (name, description, triggers, aliases, whenToUse).

**Three-tier merge** (`manager.ts`):

```
1. Built-in skills (BUILTIN_SKILLS_DIR)     -- base layer
2. Org skills (ORG_SKILLS_URL)              -- overrides builtin by name
3. User skills (USER_SKILLS_DIR)            -- additive only, cannot override
```

**Safety analysis** (`safety.ts`): Scans skill content for dangerous patterns (shell commands, filesystem access, destructive operations) and attaches warnings. The Skill tool prepends safety reminders to loaded content.

### MCP Integration (`src/mcp/`)

**Client Pool** (`client-pool.ts`): Manages two categories of MCP connections:

| Category   | Lifecycle                | Storage                     |
| ---------- | ------------------------ | --------------------------- |
| Managed    | Connected at startup     | `managedServers` Map        |
| Transient  | Connected per-request    | `transientServers` Map      |

**Server merge**: `mergeMcpServers()` combines managed + per-request servers. The reserved name `femtoclaw` cannot be overridden. Per-request servers can shadow managed servers but not reserved names.

**Context overlay**: `mcp_context` injects per-user authentication (headers, env, args) into server configs without exposing credentials in logs.

**Tool mapping** (`tool-mapper.ts`): MCP tools are exposed as `mcp__<serverName>__<toolName>` to Anthropic.

**Transports**: HTTP (with SSE fallback), SSE, and stdio.

### Conversation Storage (`src/conversation/`)

**Interface** (`store.ts`): `ConversationStore` with methods for create, get, list, delete, updateConversation, appendMessages, getMessages, replaceMessages.

**Backends**:
- `SqliteConversationStore` — default, uses better-sqlite3/bun:sqlite via compat layer. WAL mode, foreign keys, cascade delete.
- `ApiConversationStore` — delegates to external REST API with Bearer auth.

**Factory** (`store-factory.ts`): Selects backend based on `CONVERSATION_STORE_TYPE` (`sqlite` | `api`).

**Lock** (`lock.ts`): In-process `ConversationLock` — per-conversation mutex with optional queue. Same conversation serialized; different conversations fully parallel.

**Manager** (`manager.ts`): Combines store + lock. Also manages `AskUserQuestion` state:
- `pendingInputs`: active Promise-based waits (streaming mode)
- `pausedInputs`: registered questions with expiry (non-streaming mode)

### Memory Service (`src/memory/`)

**Interface** (`service.ts`): `MemoryServiceInterface` with listMemories, readMemory, writeMemory, deleteMemory, searchMemory. All methods take `userId` as the first argument.

**Backends**:
- `SqliteMemoryService` — composite primary key `(user_id, key)`. Enforces `MAX_MEMORY_ENTRIES_PER_USER` and `MAX_MEMORY_VALUE_LENGTH`. List/search return summaries (no value field).
- `ApiMemoryService` — REST API backend.
- `McpMemoryService` — delegates to MCP `list_memories`, `read_memory`, `write_memory`, `delete_memory`, `search_memory` tools.

**Four memory types**: `user`, `feedback`, `project`, `reference`. Key naming convention: `type.topic` (e.g., `user.role`, `feedback.no_emoji`).

---

## External Service Contracts

Femtoclaw is designed as a stateless service. In single-instance mode it uses a local SQLite file for both conversation and memory storage. In multi-instance mode these backends must be replaced with shared external services that implement the REST contracts described below.

The codebase ships two reference implementations as runnable microservices under `examples/`.

### Dependency Graph

```
                        Femtoclaw
                           |
          +----------------+----------------+
          |                |                |
  Conversation Store  Memory Service   Anthropic API
  (sqlite | api)     (sqlite|api|mcp)  (required)
          |                |
          v                v
     External REST    External REST     MCP Servers
     or local SQLite  or local SQLite   (managed / per-request)
                      or MCP server
```

### Conversation Store API Contract

When `CONVERSATION_STORE_TYPE=api`, the `ApiConversationStore` delegates to an external REST service at `CONVERSATION_STORE_URL`. All requests carry `Authorization: Bearer <CONVERSATION_STORE_API_KEY>`.

#### Data Model

```typescript
interface Conversation {
  id: string;              // "conv-{uuid}"
  userId: string;
  status: 'idle' | 'running';
  messageCount: number;
  createdAt: string;       // ISO 8601
  lastActivity: string;    // ISO 8601
  metadata?: Record<string, unknown>;
}

interface ConversationMessage {
  id: string;              // "msg-{uuid}"
  conversationId: string;
  role: 'user' | 'assistant';
  sender?: string;
  senderName?: string;
  content: string;         // JSON-serialized ContentBlock[]
  createdAt: string;       // ISO 8601
}
```

#### Endpoints

| Method   | Path                                | Request Body                          | Response              | Notes                      |
| -------- | ----------------------------------- | ------------------------------------- | --------------------- | -------------------------- |
| `POST`   | `/conversations`                    | `{ userId, conversationId? }`         | `Conversation`        | Create new conversation    |
| `GET`    | `/conversations?userId=&limit=&offset=` | —                                 | `Conversation[]`      | List by user, desc by time |
| `GET`    | `/conversations/:id?userId=`        | —                                     | `Conversation \| 404` | Enforces userId ownership  |
| `PATCH`  | `/conversations/:id`                | `{ status?, metadata? }`             | `{ ok: true }`        | Update status / metadata   |
| `DELETE` | `/conversations/:id?userId=`        | —                                     | `{ ok: true } \| 404` | Cascade-deletes messages   |
| `GET`    | `/conversations/:id/messages?limit=&afterId=` | —                            | `ConversationMessage[]` | Ascending by createdAt   |
| `POST`   | `/conversations/:id/messages`       | `{ messages: [...] }`                | `{ ids: [...] }`      | Batch append               |
| `PUT`    | `/conversations/:id/messages`       | `{ messages: [...] }`                | `{ ok: true }`        | Full replace (compaction)  |

**Key semantics**:
- `GET /conversations/:id` must return 404 when the `userId` query parameter does not match the conversation owner. This enforces user isolation at the store level.
- `PUT /conversations/:id/messages` atomically replaces all messages in a conversation. Used after compaction to swap the summarized history.
- `POST /conversations/:id/messages` appends messages and increments the conversation's `messageCount` and `lastActivity`.

**Reference implementation**: `examples/conversation-store-server.ts` — a standalone Express + SQLite microservice. Start with `npx tsx examples/conversation-store-server.ts`.

### Memory Service API Contract

When `MEMORY_SERVICE_TYPE=api`, the `ApiMemoryService` delegates to an external REST service at `MEMORY_SERVICE_URL`. All requests carry `Authorization: Bearer <MEMORY_SERVICE_API_KEY>`.

#### Data Model

```typescript
type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

interface MemoryEntry {
  key: string;          // Naming convention: "type.topic" (e.g. "user.role")
  type: MemoryType;
  description: string;  // ~100 chars, used for relevance matching
  value: string;        // Full content, max 2000 chars
  tags?: string[];
  updatedAt: string;    // ISO 8601
  source: 'agent' | 'user';
}

// Summary view (returned by list/search, omits value to save tokens)
type MemoryEntrySummary = Omit<MemoryEntry, 'value'>;
```

#### Endpoints

| Method   | Path                                    | Request Body                                     | Response                | Notes                       |
| -------- | --------------------------------------- | ------------------------------------------------ | ----------------------- | --------------------------- |
| `GET`    | `/memory/:userId?category=`             | —                                                | `MemoryEntrySummary[]`  | List summaries (no value)   |
| `GET`    | `/memory/:userId/all`                   | —                                                | `MemoryEntry[]`         | Read all with full values   |
| `GET`    | `/memory/:userId/:key`                  | —                                                | `MemoryEntry`           | Read single entry           |
| `GET`    | `/memory/:userId/search?q=&category=`   | —                                                | `MemoryEntrySummary[]`  | Keyword search              |
| `PUT`    | `/memory/:userId/:key`                  | `{ value, type, description, tags?, source? }`   | `{ ok: true }`          | Upsert by (userId, key)     |
| `DELETE` | `/memory/:userId/:key`                  | —                                                | `{ ok: true } \| 404`   | Delete single entry         |

**Key semantics**:
- All endpoints are scoped by `:userId` in the URL path. The store must not allow cross-user access.
- `GET /memory/:userId` returns summaries (no `value` field) to keep prompt injection token-efficient. The agent uses `GET /memory/:userId/:key` to fetch full content on demand.
- `PUT` is an upsert — creates if the key does not exist, updates if it does.
- The store should enforce a per-user entry limit (suggested: 200) and value length cap (suggested: 2000 chars).

**Reference implementation**: `examples/memory-store-server.ts` — a standalone Express + SQLite microservice. Start with `npx tsx examples/memory-store-server.ts`.

### Memory Service MCP Contract

When `MEMORY_SERVICE_TYPE=mcp`, the `McpMemoryService` delegates to the MCP server named by `MEMORY_MCP_SERVER` (default: `memory`). The MCP server must expose these tools:

| MCP Tool           | Parameters                                        | Returns                          |
| ------------------ | ------------------------------------------------- | -------------------------------- |
| `list_memories`    | `{ user_id, category? }`                          | `MemoryEntrySummary[]` (JSON)    |
| `read_memory`      | `{ user_id, key? }`                               | `MemoryEntry \| MemoryEntry[]`   |
| `write_memory`     | `{ user_id, key, value, type, description, tags?, source? }` | `{ ok: true }`        |
| `delete_memory`    | `{ user_id, key }`                                | `{ ok: true }`                   |
| `search_memory`    | `{ user_id, query, category? }`                   | `MemoryEntrySummary[]` (JSON)    |

The MCP server must be declared in `config/managed-mcp.json` under the name matching `MEMORY_MCP_SERVER`.

### Backend Selection Summary

```
                   CONVERSATION_STORE_TYPE
                   /                     \
              "sqlite"                  "api"
              (default)
                 |                        |
     SqliteConversationStore     ApiConversationStore
     local file, single-writer   REST API, shared

                   MEMORY_SERVICE_TYPE
                /         |          \
          "sqlite"      "api"       "mcp"
          (default)
             |            |            |
   SqliteMemoryService  ApiMem...   McpMem...
   local file           REST API    MCP tools
```

### SQLite Compatibility (`src/utils/sqlite-compat.ts`)

Abstracts the SQLite driver behind a unified `Database` interface:

```
createDatabase(path) --> Database { pragma, exec, prepare, close, transaction }
                           |
                    runtime detection
                     /            \
              Node.js              Bun
          better-sqlite3        bun:sqlite
```

Both conversation store and memory service import `createDatabase` instead of a specific SQLite library. The detection is automatic via `'Bun' in globalThis`.

---

## Concurrency Model

```
User A, Conv 1  ──────► Lock(conv-1) ──► Agent Loop (serial)
User A, Conv 2  ──────► Lock(conv-2) ──► Agent Loop (parallel with conv-1)
User B, Conv 3  ──────► Lock(conv-3) ──► Agent Loop (parallel with above)
User A, Conv 1  ──────► Lock(conv-1) ──► 409 Conflict (conv-1 is busy)
```

- Same conversation: serialized by `ConversationLock`. Second request waits or gets 409.
- Different conversations: fully parallel, no lock contention.
- Rate limiting: per-user, in-memory counter with 1-minute sliding window.

For multi-instance deployments, session affinity (by `conversation_id`) at the load balancer is required because locks are in-process.

---

## Data Flow: Message Persistence

```
Client sends: { message: "Hello", conversation_id: "conv-1" }

     +-- chat route reads existing messages from ConversationStore
     |
     +-- AgentEngine.run() rebuilds Anthropic messages[] from stored JSON
     |     |
     |     +-- agent loop runs (may add assistant + tool_result messages)
     |     |
     |     +-- returns newMessages: ApiMessage[]
     |
     +-- persistMessages() serializes ContentBlock[] to JSON strings
     |   and calls store.appendMessages()
     |
     +-- response sent to client
```

Messages are stored with `content` as a JSON string (`JSON.stringify(contentBlocks)`). On reload, they are parsed back into `ContentBlock[]`. Legacy plain-text messages (no JSON) are wrapped in a single `TextBlock`.

### Compaction

When `estimateTokenCount(messages) > COMPACTION_THRESHOLD`:

1. Split messages into `old` (to summarize) and `recent` (keep intact, last 6).
2. Call Claude Haiku to summarize old messages.
3. Replace stored messages with `[summary, ack, ...recent]` via `replaceMessages()`.
4. Continue the conversation with the compacted history.

---

## AskUserQuestion Flow

Two modes depending on `stream` setting:

### Streaming Mode

```
Agent calls AskUserQuestion
  --> engine emits SSE: input_required
  --> engine emits SSE: message_paused
  --> engine calls waitForUserInput() (Promise)
  --> SSE connection stays open

Client sends POST /chat { input_response }
  --> chat route calls manager.submitUserInput()
  --> Promise resolves
  --> engine continues loop with tool_result
  --> remaining SSE events flow on the original connection
```

### Non-Streaming Mode

```
Agent calls AskUserQuestion
  --> engine sets pauseOnInput flag
  --> engine returns awaiting_input result
  --> chat route responds HTTP 202 with question data
  --> manager.registerPausedInput() stores state with timeout

Client sends POST /chat { input_response }
  --> chat route calls manager.consumePausedInput()
  --> constructs tool_result from answers
  --> starts new AgentEngine.run() with resumeInputResponse
  --> responds with final result
```

Pending questions expire after `INPUT_TIMEOUT_MS` (default 5 minutes).

---

## Trace Sink (`src/trace/`)

Trace emission is asynchronous and non-blocking for the main request path.

- `createTraceSink()` returns:
  - `NoopTraceSink` when `TRACE_ENABLED=false` or `TRACE_ENDPOINT` is empty
  - `AsyncHttpTraceSink` otherwise
- `AsyncHttpTraceSink` buffers events in memory, flushes by `TRACE_BATCH_SIZE` or `TRACE_FLUSH_INTERVAL_MS`, and drops on overflow (`TRACE_QUEUE_MAX`) with warning logs.
- Network send timeout is controlled by `TRACE_TIMEOUT_MS`.
- Ingestion auth uses optional `TRACE_API_KEY` via `x-api-key` header.

Event payload contract:

```typescript
interface TraceEvent {
  trace_id: string;                // required
  event_type: string;              // required
  service?: string;                // default: "femtoclaw"
  ts?: string;                     // default: ISO timestamp at emit-time
  request_id?: string;
  conversation_id?: string;
  user_id?: string;
  message_id?: string;
  payload?: Record<string, unknown>;
}
```

Thinking capture behavior is controlled by `TRACE_INCLUDE_THINKING` and `TRACE_THINKING_MAX_CHARS` in `AgentEngine`.

---

## File Map

```
src/
  index.ts                  boot + dependency wiring (70 lines)
  server.ts                 Express app assembly (86 lines)
  config.ts                 environment variable parsing (135 lines)
  types.ts                  shared interfaces (228 lines)

  agent/
    engine.ts               Anthropic loop + tool dispatch (530 lines)
    context-builder.ts      system prompt + preamble assembly (285 lines)
    compaction.ts           history summarization (72 lines)
    stream.ts               SseWriter + StreamCollector (64 lines)

  routes/
    chat.ts                 POST/GET /chat, resume protocol (364 lines)
    health.ts               GET /health (25 lines)
    admin.ts                POST /admin/reload-skills (22 lines)
    skills.ts               GET /skills (15 lines)

  middleware/
    auth.ts                 Bearer token + UserContext extraction (47 lines)
    rate-limit.ts           per-user RPM counter (56 lines)
    error-handler.ts        global error handler (13 lines)
    request-id.ts           X-Request-ID injection (9 lines)

  tools/
    index.ts                tool registry + allowlist (74 lines)
    executor.ts             builtin/MCP dispatch (98 lines)
    types.ts                re-exports from types.ts
    skill.ts                Skill tool with alias resolution
    web-search.ts           DuckDuckGo HTML search
    web-fetch.ts            HTTP/HTTPS content fetch
    memory.ts               Memory CRUD + search
    todo-write.ts           in-memory task list
    send-message.ts         SSE intermediate message
    ask-user-question.ts    structured questions

  skills/
    manager.ts              three-tier merge (82 lines)
    loader.ts               SKILL.md parser (100 lines)
    safety.ts               dangerous pattern analysis (48 lines)
    types.ts                re-exports

  mcp/
    client-pool.ts          managed + transient pool (324 lines)
    managed.ts              config/managed-mcp.json loader (94 lines)
    tool-mapper.ts          MCP <-> Anthropic tool mapping (44 lines)
    types.ts                MCP content types (40 lines)

  trace/
    sink.ts                 async HTTP trace sink + noop sink (157 lines)

  conversation/
    manager.ts              store + lock + input handling (196 lines)
    lock.ts                 per-conversation mutex (64 lines)
    store.ts                ConversationStore interface (32 lines)
    sqlite-store.ts         SQLite backend (217 lines)
    api-store.ts            REST API backend (102 lines)
    store-factory.ts        factory by config (30 lines)

  memory/
    service.ts              MemoryServiceInterface re-export
    sqlite-backend.ts       SQLite backend (178 lines)
    api-backend.ts          REST API backend (60 lines)
    mcp-backend.ts          MCP-delegated backend (103 lines)
    service-factory.ts      factory by config (32 lines)

  utils/
    logger.ts               pino structured logging
    template.ts             {{var}} template renderer
    token-counter.ts        CJK/ASCII token estimator
    sqlite-compat.ts        Node/Bun SQLite abstraction (115 lines)

config/
  managed-mcp.json          pre-configured MCP servers

skills/
  builtin/                  built-in skill definitions (SKILL.md)
```
