# Femtoclaw

Lightweight conversational Agent service with multi-user isolation, Skills, and MCP support.

## What Is Implemented

- Direct Anthropic Messages API runtime, no Claude Agent SDK
- Multi-user conversation isolation with per-conversation locking
- Skills loading from `builtin`, optional org, and optional user directories
- MCP support for managed servers, per-request servers, HTTP/SSE/stdio transports, and request-scoped context overlay
- Built-in tools: `Skill`, `WebSearch`, `WebFetch`, `Memory`, `TodoWrite`, `SendMessage`, `AskUserQuestion`
- `AskUserQuestion` pause/resume flow for both SSE and non-streaming `/chat`
- Memory backends: `sqlite`, `api`, `mcp`

## Docs

Public implementation docs live in `docs/` inside the code repository:

- `docs/api.md` — HTTP API reference, SSE events, pause/resume protocol
- `docs/deployment.md` — Docker, runtime selection (Node/Bun), horizontal scaling
- `docs/configuration.md` — environment variables, directories, config files
- `docs/architecture.md` — runtime architecture and module responsibilities
- `docs/skills-guide.md` — creating and using skills, three-tier system
- `docs/security.md` — trust model, attack surface, deployment hardening

Internal notes, prompt dumps, and test reports live in the outer workspace `../docs/` and are not part of the public code docs set.

## Quick Start

```bash
npm install
cp .env.example .env
ANTHROPIC_AUTH_TOKEN=token-xxx npm run dev
```

Production:

```bash
npm run build
ANTHROPIC_AUTH_TOKEN=token-xxx npm start
```

## Docker

```bash
# Build with Makefile (recommended)
make docker-build                       # Node.js (default)
make docker-build RUNTIME=bun           # Bun runtime
make docker-build-bun                   # Shorthand for Bun

# Or directly
docker build --platform linux/amd64 -t femtoclaw .
docker build --platform linux/amd64 --build-arg RUNTIME=bun -t femtoclaw:bun .

# Run
docker run --rm -p 9000:9000 -e ANTHROPIC_API_KEY=sk-ant-xxx femtoclaw:latest
```

Optional local prepackaged assets can be supplied from `dev-data/assets/` at build time:

- `dev-data/assets/org/**` -> `/app/org/`
- `dev-data/assets/skills/**` -> `/app/skills/`

If the directory is absent, build continues normally.

Pre-built images are available from GHCR:

```bash
docker pull ghcr.io/breakcafe/femtoclaw:latest
docker run --rm -p 9000:9000 -e ANTHROPIC_API_KEY=sk-ant-xxx ghcr.io/breakcafe/femtoclaw:latest
```

## Chat API

Basic request:

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","stream":false}'
```

Streaming:

```bash
curl -N -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我查一下最近的新闻","stream":true}'
```

Conversation history behavior:

- Clients use an incremental protocol: each `POST /chat` sends only the new message plus optional `conversation_id`.
- The current femtoclaw runtime reloads persisted conversation history and replays reconstructed Anthropic `messages[]` on each turn.
- To reduce stale-intent carry-over, only the most recent 12 persisted messages are included in the model context.
- This differs from picoclaw internals, which also expose an incremental client API but can additionally use Claude Agent SDK session resume metadata.

Resume an `AskUserQuestion` turn:

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id":"conv_xxx",
    "stream":false,
    "input_response":{
      "tool_use_id":"toolu_xxx",
      "answers":{"你希望包含哪些部分？":"消费, 预算"}
    }
  }'
```

## API Endpoints

| Method   | Path                   | Description                              |
| -------- | ---------------------- | ---------------------------------------- |
| `GET`    | `/health`              | Health check                             |
| `POST`   | `/chat`                | Send message or resume a paused question |
| `GET`    | `/chat`                | List current user's conversations        |
| `GET`    | `/chat/:id`            | Conversation metadata                    |
| `GET`    | `/chat/:id/messages`   | Conversation history                     |
| `DELETE` | `/chat/:id`            | Delete a conversation                    |
| `GET`    | `/skills`              | Effective skill manifest                 |
| `POST`   | `/admin/reload-skills` | Reload skills from disk                  |

## Skills

Current build supports three tiers through directories:

- Built-in: `BUILTIN_SKILLS_DIR`, default `./skills/builtin`
- Org: `ORG_SKILLS_URL`, interpreted as a local directory path
- User: `USER_SKILLS_DIR`, default `./skills/user`

## MCP

Managed MCP servers are loaded from `MANAGED_MCP_CONFIG` (default `/app/org/managed-mcp.json`).

Supported transports:

- `http` with automatic SSE fallback
- `sse`
- `stdio`

Per-request MCP servers can be attached through `POST /chat { mcp_servers, mcp_context }`.

## Web Tools

- `WebSearch` uses DuckDuckGo HTML search by default and returns parsed top results.
- `WebFetch` fetches `http`/`https` content only.

## Configuration

Important variables:

| Variable                     | Default                          | Description                                       |
| ---------------------------- | -------------------------------- | ------------------------------------------------- |
| `PORT`                       | `9000`                           | HTTP port                                         |
| `API_TOKEN`                  | empty                            | Bearer token auth                                 |
| `ANTHROPIC_BASE_URL`         | `https://api.minimaxi.com/anthropic` | Anthropic-compatible base URL                 |
| `ANTHROPIC_AUTH_TOKEN`       | empty                            | Preferred auth token for Anthropic-compatible APIs |
| `ANTHROPIC_API_KEY`          | empty                            | API key auth (fallback when auth token is empty)  |
| `DEFAULT_MODEL`              | `MiniMax-M2.7`                   | Default model                                     |
| `SQLITE_DB_PATH`             | `./data/femtoclaw.db`            | Shared SQLite path for conversation + memory      |
| `CONVERSATION_STORE_TYPE`    | `sqlite`                         | `sqlite` or `api`                                 |
| `MEMORY_SERVICE_TYPE`        | `sqlite`                         | `sqlite`, `api`, or `mcp`                         |
| `MEMORY_SERVICE_AUTH_HEADER` | `Authorization`                  | Auth header name for API memory backend           |
| `MEMORY_SERVICE_AUTH_SCHEME` | `Bearer`                         | Auth scheme prefix; empty means raw token mode    |
| `MEMORY_MCP_SERVER`          | `memory`                         | MCP server name used by `MEMORY_SERVICE_TYPE=mcp` |
| `ORG_SKILLS_URL`             | empty                            | Local org skills directory                        |
| `USER_SKILLS_DIR`            | `./skills/user`                  | Optional user skill directory                     |
| `ORG_INSTRUCTIONS_PATH`      | `/app/org/claude.md`             | Org instruction file path                         |
| `MANAGED_MCP_CONFIG`         | `/app/org/managed-mcp.json`      | Managed MCP config file                           |
| `TRACE_ENABLED`              | `true`                           | Enable async trace sink                           |
| `TRACE_ENDPOINT`             | `http://kapivault:80/trace/events` | Trace ingest endpoint                          |
| `INPUT_TIMEOUT_MS`           | `300000`                         | Pending question expiration                       |
| `ALLOWED_TOOLS`              | `*`                              | Built-in tool allowlist                           |

Full configuration reference: `docs/configuration.md`

For `MEMORY_SERVICE_TYPE=api`, URL/auth can also fall back to the managed MCP server entry named by `MEMORY_MCP_SERVER` (including optional `auth` fields in `managed-mcp.json`), while explicit env vars remain highest priority.

## Makefile

```bash
make help               # Show all available targets
make test               # Run unit tests
make docker-build       # Build Docker image
make docker-run         # Run container interactively
make ghcr-release       # Build and push to GHCR
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on pull requests — format check, typecheck, and tests.
- **Docker Publish** (`.github/workflows/docker-publish.yml`): Pushes to `ghcr.io/breakcafe/femtoclaw` on merge to main. Manual dispatch supports `RUNTIME=bun`.

## Verification

```bash
npm run build
npm test
npm run format:check
```

49 tests across 11 test files.

## Notes

- Non-streaming `AskUserQuestion` returns HTTP `202` with `status: "awaiting_input"`.
- Streaming `AskUserQuestion` emits `input_required`, then `message_paused`, and the client resumes with a new `POST /chat`.
- `conversation_id` gives the server enough information to reload history; clients do not send the full transcript back on every turn.
- Pending paused questions expire after `INPUT_TIMEOUT_MS`; this build does not auto-run a background continuation after expiry.

## Architecture

See `docs/architecture.md` for the implementation-facing architecture summary.
