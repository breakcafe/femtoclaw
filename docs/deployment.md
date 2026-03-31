# Deployment Guide

## Quick Start (Local Development)

```bash
cd code
npm install
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

npm run dev   # Development with auto-reload
npm start     # Production mode (requires prior build)
```

## Docker Deployment

### Build

```bash
docker build --platform linux/amd64 -t femtoclaw .
```

With build metadata:

```bash
docker build --platform linux/amd64 \
  --build-arg BUILD_VERSION=$(node -p "require('./package.json').version") \
  --build-arg BUILD_COMMIT=$(git rev-parse --short HEAD) \
  --build-arg BUILD_TIME=$(date -u +%FT%TZ) \
  -t femtoclaw .
```

### Run

```bash
docker run --rm -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  femtoclaw
```

With persistent data:

```bash
docker run -d --name femtoclaw \
  -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  -v femtoclaw-data:/data \
  femtoclaw
```

### Health Check

The container includes a built-in health check:

```bash
curl http://localhost:9000/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "model": "claude-sonnet-4-20250514"
}
```

## Architecture Modes

### Single Instance (Default)

```
Client → Femtoclaw (Node.js) → Anthropic API
                │
         ┌──────┼──────┐
         SQLite  MCP    Skills
         (local) Servers (local)
```

All state is local: SQLite for conversations + memory, skill files on disk, in-memory locks.

### Horizontal Scaling

```
              Load Balancer
              (session affinity)
                   │
         ┌─────────┼─────────┐
    Femtoclaw #1  Femtoclaw #2  Femtoclaw #3
         │              │              │
         └──────────────┼──────────────┘
                        │
              Shared Storage
              (API backends)
```

Requirements for multi-instance:

| Component | Single Instance | Multi Instance |
|---|---|---|
| Conversation Store | `sqlite` (default) | `api` (shared REST backend) |
| Memory Service | `sqlite` (default) | `api` or `mcp` (shared backend) |
| Conversation Lock | In-memory (default) | Session affinity at LB, or Redis (future) |
| Rate Limiting | In-memory (default) | API Gateway rate limiting |
| Skills | Local directories | Shared mount or registry |

Configure with:

```bash
CONVERSATION_STORE_TYPE=api
CONVERSATION_STORE_URL=https://store.internal/api
CONVERSATION_STORE_API_KEY=xxx

MEMORY_SERVICE_TYPE=api
MEMORY_SERVICE_URL=https://memory.internal/api
MEMORY_SERVICE_API_KEY=xxx
```

### Session Affinity

Since per-conversation locks are in-memory, the load balancer must route requests for the same `conversation_id` to the same instance. Options:

- Nginx: `ip_hash` or cookie-based sticky sessions
- AWS ALB: Target group stickiness
- Kubernetes: Session affinity on service

## MCP Server Configuration

### Managed Servers

Configure pre-connected MCP servers in `config/managed-mcp.json`:

```json
{
  "mcpServers": {
    "finance-api": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    },
    "local-tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-everything"]
    }
  }
}
```

### Per-Request Servers

Clients can attach temporary MCP servers via `POST /chat`:

```json
{
  "message": "Query my data",
  "mcp_servers": {
    "user-api": {
      "type": "http",
      "url": "https://user-service.example.com/mcp"
    }
  },
  "mcp_context": {
    "user-api": {
      "headers": {
        "Authorization": "Bearer user-token-xxx"
      }
    }
  }
}
```

## Environment Variables

See `docs/configuration.md` for the complete reference.

Key deployment variables:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `API_TOKEN` | Recommended | Bearer auth token |
| `PORT` | No (9000) | HTTP port |
| `ANTHROPIC_BASE_URL` | No | API proxy URL |
| `DEFAULT_MODEL` | No | Model override |
| `SQLITE_DB_PATH` | No | Database path |

## Monitoring

### Logs

Structured JSON logs via pino. Control verbosity with `LOG_LEVEL`:

```bash
LOG_LEVEL=debug  # debug, info, warn, error
```

### Metrics to Watch

- Response times (SSE first-byte latency)
- Token usage per request (from `message_complete` events)
- Rate limit hits (429 responses)
- MCP connection failures
- Compaction frequency

### Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` for graceful shutdown:

1. Stops accepting new connections
2. Waits for in-flight requests to complete
3. Closes MCP connections
4. Closes database connections

## Troubleshooting

### Common Issues

**"ANTHROPIC_API_KEY is required"**: Set the environment variable before starting.

**MCP connection failures**: Check that managed MCP server URLs are accessible from the container. For `stdio` servers, ensure the command is available in PATH.

**SQLite lock errors**: Ensure only one instance writes to the same SQLite file. Use `CONVERSATION_STORE_TYPE=api` for multi-instance deployments.

**Skill loading warnings**: Check that skill directories exist and contain valid `SKILL.md` files with YAML frontmatter.
