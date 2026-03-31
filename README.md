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

- `docs/architecture.md`
- `docs/api.md`
- `docs/configuration.md`

Internal notes, prompt dumps, and test reports live in the outer workspace `../docs/` and are not part of the public code docs set.

## Quick Start

```bash
npm install
cp .env.example .env
ANTHROPIC_API_KEY=sk-ant-xxx npm run dev
```

Production:

```bash
npm run build
ANTHROPIC_API_KEY=sk-ant-xxx npm start
```

## Docker

```bash
docker build --platform linux/amd64 -t femtoclaw .
docker run --rm -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  femtoclaw
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

Managed MCP servers are loaded from `config/managed-mcp.json`.

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

| Variable                  | Default                     | Description                                       |
| ------------------------- | --------------------------- | ------------------------------------------------- |
| `PORT`                    | `9000`                      | HTTP port                                         |
| `API_TOKEN`               | empty                       | Bearer token auth                                 |
| `DEFAULT_MODEL`           | `claude-sonnet-4-20250514`  | Default Anthropic model                           |
| `SQLITE_DB_PATH`          | `./data/femtoclaw.db`       | Shared SQLite path for conversation + memory      |
| `CONVERSATION_STORE_TYPE` | `sqlite`                    | `sqlite` or `api`                                 |
| `MEMORY_SERVICE_TYPE`     | `sqlite`                    | `sqlite`, `api`, or `mcp`                         |
| `MEMORY_MCP_SERVER`       | `memory`                    | MCP server name used by `MEMORY_SERVICE_TYPE=mcp` |
| `ORG_SKILLS_URL`          | empty                       | Local org skills directory                        |
| `USER_SKILLS_DIR`         | `./skills/user`             | Optional user skill directory                     |
| `MANAGED_MCP_CONFIG`      | `./config/managed-mcp.json` | Managed MCP config file                           |
| `INPUT_TIMEOUT_MS`        | `300000`                    | Pending question expiration                       |
| `ALLOWED_TOOLS`           | `*`                         | Built-in tool allowlist                           |

Full configuration reference: `docs/configuration.md`

## Verification

Latest local verification:

```bash
npm run build
npm test
npm run format:check
```

At the time of the latest update these commands passed with 49 tests.

## Notes

- Non-streaming `AskUserQuestion` returns HTTP `202` with `status: "awaiting_input"`.
- Streaming `AskUserQuestion` emits `input_required`, then `message_paused`, and the client resumes with a new `POST /chat`.
- Pending paused questions expire after `INPUT_TIMEOUT_MS`; this build does not auto-run a background continuation after expiry.

## Architecture

See `docs/architecture.md` for the implementation-facing architecture summary.
