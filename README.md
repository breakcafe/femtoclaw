# Femtoclaw

Lightweight conversational Agent service with multi-user isolation, Skills mechanism, and MCP (Model Context Protocol) support.

## Overview

Femtoclaw is a consumer-facing Agent service built directly on the Anthropic Messages API. Unlike picoclaw, it does **not** use the Claude Agent SDK or Docker for isolation — instead it implements business-layer isolation with a minimal, safe tool set.

### Key Features

- **Multi-user session isolation** — each user's conversations, memories, and skills are fully isolated
- **Skills system** — 3-tier skill loading (builtin > org > user) with runtime injection
- **MCP support** — managed MCP servers + per-request dynamic servers + auth context overlay
- **Streaming** — SSE streaming with text deltas, thinking, tool use events
- **Memory** — persistent cross-session memory with 4 types (user/feedback/project/reference)
- **Interactive tools** — AskUserQuestion with pause/resume mechanism
- **Picoclaw-compatible API** — `POST /chat`, `GET /chat`, SSE events

## Quick Start

```bash
# Install
npm install

# Development
ANTHROPIC_API_KEY=sk-ant-xxx npm run dev

# Production
npm run build
ANTHROPIC_API_KEY=sk-ant-xxx npm start
```

### Docker

```bash
docker build --platform linux/amd64 -t femtoclaw .
docker run --rm -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  femtoclaw
```

## API

### Send a message

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

### Streaming

```bash
curl -N -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "stream": true}'
```

### With authentication

```bash
# Set API_TOKEN env var on the server, then:
curl -X POST http://localhost:9000/chat \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

### With MCP servers

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Query my data",
    "mcp_servers": {
      "my-api": {
        "type": "http",
        "url": "http://example.com/mcp"
      }
    }
  }'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/chat` | Send message / continue conversation |
| `GET` | `/chat` | List conversations |
| `GET` | `/chat/:id` | Get conversation metadata |
| `GET` | `/chat/:id/messages` | Get message history |
| `DELETE` | `/chat/:id` | Delete conversation |
| `GET` | `/skills` | List available skills |
| `POST` | `/admin/reload-skills` | Reload skills |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `PORT` | `9000` | HTTP server port |
| `API_TOKEN` | (empty) | Bearer token; empty = no auth |
| `DEFAULT_MODEL` | `claude-sonnet-4-20250514` | Default Claude model |
| `ASSISTANT_NAME` | `Femtoclaw` | Agent display name |
| `SQLITE_DB_PATH` | `./data/femtoclaw.db` | Database path |
| `LOG_LEVEL` | `info` | Log level |
| `MAX_EXECUTION_MS` | `300000` | Request timeout |
| `RATE_LIMIT_RPM` | `60` | Per-user rate limit |

See `CLAUDE.md` for full configuration reference.

## Architecture

See `docs/architecture-design.md` for the complete architecture document.

## License

MIT
