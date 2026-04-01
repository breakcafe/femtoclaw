# Deployment Guide

## Quick Start (Local Development)

```bash
cd code
npm install
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

npm run dev     # Development mode with auto-reload
npm run build   # Compile TypeScript
npm start       # Production mode
```

Verify:

```bash
curl http://localhost:9000/health
# Expected: {"status":"ok","version":"0.1.0",...}
```

---

## Docker Deployment

### Runtime Selection

The Dockerfile supports both Node.js and Bun via the `RUNTIME` build argument (default: `node`):

```bash
# Node.js (default, recommended for production)
docker build --platform linux/amd64 -t femtoclaw:node .

# Bun
docker build --platform linux/amd64 --build-arg RUNTIME=bun -t femtoclaw:bun .
```

The `FEMTOCLAW_RUNTIME` environment variable is set inside the container to indicate the active runtime.

| Property      | Node.js       | Bun            |
| ------------- | ------------- | -------------- |
| Startup speed | Faster (~7x)  | Slower         |
| HTTP latency  | ~2ms          | ~0.5ms         |
| Memory usage  | ~93MB         | ~113MB         |
| Compatibility | Native        | Needs compat layer |
| Recommendation| Production    | Experimental   |

### Build with Metadata

```bash
docker build --platform linux/amd64 \
  --build-arg RUNTIME=node \
  --build-arg BUILD_VERSION=$(node -p "require('./package.json').version") \
  --build-arg BUILD_COMMIT=$(git rev-parse --short HEAD) \
  --build-arg BUILD_TIME=$(date -u +%FT%TZ) \
  -t femtoclaw:node .
```

| Build Arg       | Default   | Description             |
| --------------- | --------- | ----------------------- |
| `RUNTIME`       | `node`    | Runtime: `node` or `bun`|
| `BUILD_VERSION` | `0.1.0`   | Version label           |
| `BUILD_COMMIT`  | `unknown` | Git commit hash         |
| `BUILD_TIME`    | `unknown` | Build timestamp         |

### Run

Basic:

```bash
docker run --rm -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  femtoclaw:node
```

With persistent data:

```bash
docker run -d --name femtoclaw \
  -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  -v femtoclaw-data:/data \
  femtoclaw:node
```

### One-Click Script

Use `femtoclaw.sh` for automated build, start, and test:

```bash
# Node.js (default)
./femtoclaw.sh up

# Bun
RUNTIME=bun ./femtoclaw.sh up

# Full cycle: build -> start -> test -> stop
./femtoclaw.sh

# Other commands
./femtoclaw.sh test      # Run tests against a running instance
./femtoclaw.sh stop      # Stop container
./femtoclaw.sh logs      # Tail logs
./femtoclaw.sh report    # Generate test report
```

### Health Check

Built-in health check (every 30 seconds):

```bash
curl -sf http://localhost:9000/health
```

---

## Architecture Modes

### Single Instance (Default)

```
Client --> Femtoclaw (Node.js) --> Anthropic API
                |
         +------+------+
         SQLite  MCP    Skills
         (local) Servers (local)
```

All state is local: SQLite for conversations + memory, skill files on disk, in-memory locks.

### Horizontal Scaling

```
              Load Balancer
           (session affinity)
                  |
        +---------+---------+
   Femtoclaw #1  #2         #3
   (stateless)  (stateless) (stateless)
        |         |          |
        +---------+----------+
                  |
        +---------+---------+
    Shared Store  Anthropic  MCP
    (API backend) API        Servers
```

Requirements for multi-instance deployment:

| Component          | Single Instance  | Multi Instance                          |
| ------------------ | ---------------- | --------------------------------------- |
| Conversation Store | `sqlite`         | `api` (shared REST backend)             |
| Memory Service     | `sqlite`         | `api` or `mcp` (shared backend)         |
| Conversation Lock  | In-memory        | Session affinity at LB, or Redis (future)|
| Rate Limiting      | In-memory        | API Gateway rate limiting               |
| Skills             | Local directories| Shared mount or registry                |

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

Per-conversation locks are in-memory, so the load balancer must route requests for the same `conversation_id` to the same instance:

- Nginx: `ip_hash` or cookie-based sticky sessions
- AWS ALB: Target group stickiness
- Kubernetes: Session affinity on Service

---

## MCP Server Configuration

### Managed Servers

Pre-configured MCP servers in `config/managed-mcp.json`:

```json
{
  "mcpServers": {
    "finance-api": {
      "type": "http",
      "url": "https://mcp.example.com/api"
    },
    "local-tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-everything"]
    },
    "legacy-service": {
      "type": "sse",
      "url": "https://sse.example.com/mcp"
    }
  }
}
```

| Transport | Description                           |
| --------- | ------------------------------------- |
| `http`    | Streamable HTTP (auto-fallback to SSE)|
| `sse`     | Server-Sent Events transport          |
| `stdio`   | Subprocess via stdin/stdout           |

### Per-Request Servers

Clients attach temporary MCP servers via `POST /chat`. See `docs/api.md` for details.

---

## Environment Variables

### Required

| Variable            | Description               |
| ------------------- | ------------------------- |
| `ANTHROPIC_API_KEY` | Anthropic-compatible key  |

### Key Deployment Variables

| Variable                 | Default                     | Description                |
| ------------------------ | --------------------------- | -------------------------- |
| `PORT`                   | `9000`                      | HTTP port                  |
| `API_TOKEN`              | empty (no auth)             | Bearer authentication      |
| `DEFAULT_MODEL`          | `claude-sonnet-4-20250514`  | Default model              |
| `ANTHROPIC_BASE_URL`     | `https://api.anthropic.com` | API proxy URL              |
| `ASSISTANT_NAME`         | `Femtoclaw`                 | Assistant display name     |
| `LOG_LEVEL`              | `info`                      | Log level                  |
| `REQUIRE_USER_ID`        | `false`                     | Enforce X-User-Id header   |
| `SQLITE_DB_PATH`         | `./data/femtoclaw.db`       | Database path              |

See `docs/configuration.md` for the full reference.

---

## Security

### Production Requirements

```bash
API_TOKEN=<strong-random-string>      # Must be set
REQUIRE_USER_ID=true                   # Enforce user identity
```

### Secrets Management

- Inject `ANTHROPIC_API_KEY` and `API_TOKEN` via environment variables or cloud secret managers.
- Never commit `.env` to version control.
- Rotate `API_TOKEN` periodically.

### Network

- Place Femtoclaw behind a reverse proxy (Nginx, ALB) with TLS termination.
- Restrict direct access to the container port.
- Use HTTPS for external MCP servers.

See `docs/security.md` for the full security model.

---

## Monitoring

### Logs

Structured JSON logs via pino. Control verbosity with `LOG_LEVEL`:

```bash
LOG_LEVEL=debug   # Development
LOG_LEVEL=info    # Production (default)
LOG_LEVEL=warn    # Warnings and errors only
```

### Key Metrics

| Metric              | Source                   | Description           |
| ------------------- | ------------------------ | --------------------- |
| Response latency    | Application logs         | Per-request duration  |
| Token usage         | `message_complete` event | Input/output tokens   |
| 429 rate            | HTTP status codes        | Rate limit hit rate   |
| MCP failures        | Application logs         | MCP availability      |
| Compaction triggers  | Application logs         | Long conversation rate|

### Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:

1. Stops accepting new connections
2. Waits for in-flight requests to complete
3. Closes MCP connections
4. Closes database connections

---

## Troubleshooting

**"ANTHROPIC_API_KEY is required"**: Set the environment variable before starting.

**MCP connection failures**: Check that managed MCP server URLs are accessible from the container. For `stdio` servers, ensure the command is in PATH.

**SQLite lock errors**: Ensure only one instance writes to the same SQLite file. Use `CONVERSATION_STORE_TYPE=api` for multi-instance deployments.

**Skill loading warnings**: Check that skill directories exist and contain valid `SKILL.md` files with YAML frontmatter.

**User data isolation**: Set `REQUIRE_USER_ID=true` in production to ensure every request carries an `X-User-Id` header.
