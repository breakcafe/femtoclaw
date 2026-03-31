# Femtoclaw

Lightweight conversational Agent service with multi-user isolation, Skills, and MCP support.
Direct Anthropic Messages API (no Claude Agent SDK), no Docker isolation — business-layer isolation only.

## Code Style

- ESM modules with explicit `.js` extensions in imports: `import { foo } from './bar.js'`
- Single quotes, 2-space indentation (Prettier enforced, see `.prettierrc`)
- Named exports only, no default exports
- TypeScript strict mode; interfaces for data types (not type aliases)
- File naming: `kebab-case.ts`, tests colocated as `kebab-case.test.ts`
- Logger: `logger.info({ context }, 'message')` — structured pino, context object first
- Route pattern: factory function returning `Router` (see `src/routes/health.ts` for minimal example)

## Development Commands

```bash
npm run build              # tsc compile to dist/
npm run typecheck          # type check only (no emit)
npm test                   # run all tests (vitest)
npm run dev                # dev mode with tsx (no build needed)
npm run format:check       # check formatting
npm run format             # fix formatting
```

## Architecture

```
src/index.ts                → process boot, shutdown signals
src/server.ts               → Express app: middleware → health → auth → chat/skills/admin
src/config.ts               → all env var defaults
src/types.ts                → shared interfaces

src/routes/chat.ts          → POST/GET/DELETE /chat (SSE streaming + non-streaming)
src/routes/skills.ts        → GET /skills
src/routes/admin.ts         → POST /admin/reload-skills
src/routes/health.ts        → GET /health

src/agent/engine.ts         → Core Agent loop (Anthropic Messages API → tool dispatch → loop)
src/agent/context-builder.ts → System prompt + user message preamble assembly
src/agent/compaction.ts     → Context compaction (Haiku summary + replaceMessages)
src/agent/stream.ts         → SSE writer + stream collector

src/tools/                  → Built-in tools: Skill, WebSearch, WebFetch, Memory, TodoWrite,
                              SendMessage, AskUserQuestion
src/tools/executor.ts       → Unified tool execution (built-in + MCP)

src/conversation/           → ConversationStore interface + SQLite/API backends,
                              per-conversation lock, manager with waitForUserInput
src/memory/                 → MemoryService interface + SQLite/API backends
src/skills/                 → Skill loader (SKILL.md + frontmatter) + 3-tier manager
src/mcp/                    → MCP client pool, managed server loader, tool mapper

src/middleware/              → auth, rate-limit, error-handler, request-id
src/utils/                  → logger, template renderer, token counter
```

### Key Differences from Picoclaw

| Aspect | Picoclaw | Femtoclaw |
|--------|----------|-----------|
| Agent runtime | Claude Agent SDK (`query()`) | Direct `@anthropic-ai/sdk` Messages API |
| Isolation | Docker container per session | Business-layer (userId-scoped stores) |
| Tools | Full Claude Code (Bash, Read, Write...) | Limited safe set (WebSearch, Memory, MCP...) |
| System prompt | ~32KB (Claude Code built-in) | ~6-8KB (custom, lean) |
| Session resume | SDK session files | Conversation history in SQLite/API |

### Request lifecycle

1. HTTP → Express router → `authMiddleware` validates Bearer token
2. Route resolves/creates conversation in store
3. `ConversationLock.acquire()` prevents concurrent execution (409 if busy)
4. `AgentEngine.run()` builds prompt, calls Anthropic API in a loop
5. Tool calls dispatched to built-in tools or MCP servers
6. Messages persisted to ConversationStore after completion
7. Lock released in `finally` block

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | API base URL |
| `API_TOKEN` | (empty) | Bearer token auth; empty = no auth |
| `PORT` | `9000` | HTTP port |
| `DEFAULT_MODEL` | `claude-sonnet-4-20250514` | Default model |
| `ASSISTANT_NAME` | `Femtoclaw` | Agent display name |
| `LOG_LEVEL` | `info` | pino log level |
| `SQLITE_DB_PATH` | `./data/femtoclaw.db` | SQLite database path |
| `CONVERSATION_STORE_TYPE` | `sqlite` | `sqlite` or `api` |
| `MEMORY_SERVICE_TYPE` | `sqlite` | `sqlite`, `api`, or `mcp` |
| `MAX_EXECUTION_MS` | `300000` | Agent timeout (ms) |
| `RATE_LIMIT_RPM` | `60` | Per-user requests per minute |

## Change Guardrails

After any code change:

```bash
npm run build && npm test   # must pass
npm run format:check        # must pass
```
