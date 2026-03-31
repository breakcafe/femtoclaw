# Configuration Reference

This document lists every configuration surface used by the current `code/` implementation.

## Environment Variables

### Required

| Variable            | Purpose                      |
| ------------------- | ---------------------------- |
| `ANTHROPIC_API_KEY` | Anthropic-compatible API key |

### Server

| Variable           | Default | Purpose                                           |
| ------------------ | ------- | ------------------------------------------------- |
| `PORT`             | `9000`  | HTTP port                                         |
| `API_TOKEN`        | empty   | Bearer auth token for all routes except `/health` |
| `LOG_LEVEL`        | `info`  | Pino log level                                    |
| `DEFAULT_TIMEZONE` | `UTC`   | Fallback timezone injected into prompts           |

### Anthropic Runtime

| Variable             | Default                     | Purpose                                                           |
| -------------------- | --------------------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Anthropic-compatible API base URL                                 |
| `DEFAULT_MODEL`      | `claude-sonnet-4-20250514`  | Default model for `/chat`                                         |
| `FALLBACK_MODEL`     | empty                       | Reserved fallback model field; not actively used in the main loop |
| `MAX_OUTPUT_TOKENS`  | `16384`                     | Max tokens for a single Anthropic response                        |
| `MAX_EXECUTION_MS`   | `300000`                    | Request timeout ceiling                                           |

### Agent

| Variable               | Default     | Purpose                                         |
| ---------------------- | ----------- | ----------------------------------------------- |
| `ASSISTANT_NAME`       | `Femtoclaw` | Assistant display name                          |
| `COMPACTION_THRESHOLD` | `160000`    | Message token estimate threshold for compaction |

### Memory

| Variable                      | Default  | Purpose                                             |
| ----------------------------- | -------- | --------------------------------------------------- |
| `MEMORY_SERVICE_TYPE`         | `sqlite` | `sqlite`, `api`, or `mcp`                           |
| `MEMORY_SERVICE_URL`          | empty    | Base URL for API memory backend                     |
| `MEMORY_SERVICE_API_KEY`      | empty    | API token for API memory backend                    |
| `MEMORY_MCP_SERVER`           | `memory` | MCP server name used when `MEMORY_SERVICE_TYPE=mcp` |
| `MAX_MEMORY_ENTRIES_PER_USER` | `200`    | SQLite memory entry cap per user                    |
| `MAX_MEMORY_VALUE_LENGTH`     | `2000`   | Max stored memory value length                      |
| `MAX_MEMORY_INDEX_IN_PROMPT`  | `50`     | Max memory summary entries injected into prompt     |
| `MEMORY_TOKEN_BUDGET`         | `6000`   | Soft budget for memory prompt injection             |

### Conversation Store

| Variable                     | Default               | Purpose                                                           |
| ---------------------------- | --------------------- | ----------------------------------------------------------------- |
| `CONVERSATION_STORE_TYPE`    | `sqlite`              | `sqlite` or `api`                                                 |
| `CONVERSATION_STORE_URL`     | empty                 | Base URL for API conversation store                               |
| `CONVERSATION_STORE_API_KEY` | empty                 | API token for API conversation store                              |
| `SQLITE_DB_PATH`             | `./data/femtoclaw.db` | Shared SQLite file used by local conversation and memory backends |

### Skills

| Variable             | Default            | Purpose                    |
| -------------------- | ------------------ | -------------------------- |
| `BUILTIN_SKILLS_DIR` | `./skills/builtin` | Built-in skills directory  |
| `ORG_SKILLS_URL`     | empty              | Org skills directory path  |
| `USER_SKILLS_DIR`    | `./skills/user`    | User skills directory path |

Notes:

- `ORG_SKILLS_URL` is a historical name in the current implementation; it is treated as a local directory path.
- Skills are merged in this order: builtin, org override, user additive.

### Org Prompt

| Variable                | Default | Purpose                             |
| ----------------------- | ------- | ----------------------------------- |
| `ORG_INSTRUCTIONS_PATH` | empty   | Optional org instructions file path |

### MCP

| Variable             | Default                     | Purpose                          |
| -------------------- | --------------------------- | -------------------------------- |
| `MANAGED_MCP_CONFIG` | `./config/managed-mcp.json` | Managed MCP config JSON file     |
| `ENABLE_MCP`         | `true`                      | Global MCP enable/disable switch |

### Request Shaping

| Variable           | Default  | Purpose                                                  |
| ------------------ | -------- | -------------------------------------------------------- |
| `RATE_LIMIT_RPM`   | `60`     | Per-user request rate limit                              |
| `INPUT_TIMEOUT_MS` | `300000` | Pending `AskUserQuestion` expiry                         |
| `REQUIRE_USER_ID`  | `false`  | When `true`, reject requests without `X-User-Id` header  |
| `ALLOWED_TOOLS`    | `*`      | Comma-separated built-in tool allowlist                  |

## Files And Directories

### Public Config Files

| Path                         | Purpose                               |
| ---------------------------- | ------------------------------------- |
| `config/managed-mcp.json`    | Managed MCP server definitions        |
| `config/org-instructions.md` | Optional org prompt content           |
| `skills/builtin/`            | Built-in skills shipped with the repo |
| `skills/user/`               | Optional local user skill directory   |

### Internal Runtime Data

| Path                | Purpose                        |
| ------------------- | ------------------------------ |
| `data/femtoclaw.db` | Default SQLite database output |

## Managed MCP Config Format

`config/managed-mcp.json`:

```json
{
  "mcpServers": {
    "example-http": {
      "type": "http",
      "url": "http://localhost:9100/mcp"
    },
    "example-stdio": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "examples/mcp-test-server.ts"]
    }
  }
}
```

Supported server types:

- `http`
- `sse`
- `stdio`

## Chat-Level Overrides

`POST /chat` can override some runtime behavior per request:

- `model`
- `thinking`
- `max_thinking_tokens`
- `mcp_servers`
- `mcp_context`
- `allowed_tools`
- `timezone`
- `locale`
- `device_type`
- `metadata`

## Verification Rule

When config behavior changes:

1. update this document
2. update `README.md` and `CLAUDE.md` if the change affects normal usage
3. run `npm run build && npm test && npm run format:check`
