# Security Model

## Trust Model

| Entity | Trust Level | Rationale |
|---|---|---|
| HTTP caller (valid token) | Trusted | Bearer token authenticates the caller |
| HTTP caller (no token, auth enabled) | Untrusted | Only `/health` is accessible |
| HTTP caller (auth disabled) | Trusted | All endpoints accessible when `API_TOKEN` is unset |
| Agent (Messages API loop) | Constrained | No shell, no filesystem; limited to safe built-in tools + MCP |
| MCP Server (managed) | Semi-trusted | Pre-configured by operator; shares tool namespace |
| MCP Server (per-request) | Untrusted | Client-supplied; cannot override reserved names or builtins |

## Security Boundaries

### 1. HTTP API Authentication

When `API_TOKEN` is set, all endpoints except `/health` require a Bearer token:

```http
Authorization: Bearer <API_TOKEN>
```

Missing or invalid tokens receive `401 Unauthorized`.

**Auth-free mode:** When `API_TOKEN` is empty or unset, authentication is disabled. This is intended for local development or deployments behind a trusted network boundary (VPC, API Gateway with its own auth layer). The user identity falls back to `X-User-Id` header or `anonymous`.

**User identity enforcement:** Set `REQUIRE_USER_ID=true` in production to reject requests that do not carry an `X-User-Id` header. Without this, all requests without the header share a single `anonymous` user space, which breaks data isolation.

### 2. No Shell or Filesystem Exposure

Unlike picoclaw (which exposes a full Claude Code CLI inside a container), femtoclaw's agent has **no access to**:

- Bash / shell commands
- File read/write/delete operations
- Process execution
- System-level operations

The built-in tool set is restricted to:

| Tool | Risk Level | Notes |
|---|---|---|
| Skill | Read-only | Loads pre-approved skill text |
| WebSearch | Read-only | DuckDuckGo HTML search |
| WebFetch | Read-only | HTTP/HTTPS only; no `file://` or `data://` |
| Memory | Controlled | User-scoped; per-userId isolation |
| TodoWrite | Session-scoped | In-memory; lost on restart |
| SendMessage | Safe | Emits SSE event to client |
| AskUserQuestion | Interactive | Pauses agent; no server-side side effects |

### 3. User Data Isolation

All data operations are scoped by `userId`:

- **Conversations**: Queries include `user_id` in WHERE clauses; `getConversation()` requires matching userId.
- **Memory**: All memory backends filter by userId; cross-user access is impossible through the API.
- **Skills**: Org skills are shared; user skills are per-user directory (additive only).
- **MCP tools**: `mcp_context` allows per-user credential injection without exposing credentials in logs.

### 4. MCP Security

- **Reserved name protection**: The name `femtoclaw` is reserved and cannot be overridden by per-request MCP servers.
- **Context overlay**: `mcp_context` headers (Authorization, Cookie, X-Api-Key) are used for per-user MCP authentication.
- **Transport validation**: Managed MCP configs are validated at startup for required fields per transport type.
- **Cleanup**: Per-request (transient) MCP connections are closed after each request completes.

### 5. Input Validation

- All `POST /chat` request bodies are validated with Zod schemas before processing.
- Invalid inputs receive `400 Bad Request` with specific error details.
- URL validation in WebFetch rejects non-HTTP protocols.
- Skill content is analyzed for dangerous patterns (shell commands, filesystem access) and tagged with safety warnings.

### 6. Rate Limiting

- Per-user rate limiting via `RATE_LIMIT_RPM` (default: 60 requests/minute).
- Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in responses.
- Exceeding the limit returns `429 Too Many Requests`.

### 7. Request Controls

- `MAX_EXECUTION_MS` (default: 300s) limits total request duration.
- Agent loop has a hard cap of 25 iterations to prevent runaway tool-call cycles.
- `COMPACTION_THRESHOLD` prevents unbounded context growth.
- `INPUT_TIMEOUT_MS` expires pending AskUserQuestion interactions.

## Attack Surface Comparison

| Vector | Picoclaw | Femtoclaw | Mitigation |
|---|---|---|---|
| Command injection | High (Bash tool) | **None** | No shell tools |
| File traversal | Medium (container FS) | **None** | No filesystem access |
| Prompt injection | Medium | Medium | Safety instructions in system prompt |
| MCP tool abuse | Medium | Medium | Tool allowlist + user auth passthrough |
| Cross-user data leak | Low (container isolation) | Medium (business isolation) | Strict userId checks at every data layer |
| Resource exhaustion | Medium | Medium | Rate limiting + timeouts + token budgets |

## Deployment Recommendations

### Network

- Place femtoclaw behind a reverse proxy or API Gateway with TLS termination.
- Restrict direct access to the container port.
- Use session affinity (by `conversation_id`) if running multiple instances.

### Secrets

- Inject `ANTHROPIC_API_KEY` and `API_TOKEN` via environment variables or secret managers.
- Never commit `.env` to version control.
- Rotate `API_TOKEN` periodically.

### Monitoring

- Monitor `429` and `500` response rates.
- Track token usage via `message_complete` events.
- Alert on unexpected `401` patterns.

### Container

- Run as non-root user (configured in Dockerfile).
- Set memory and CPU limits at the orchestration layer.
- Use `--platform linux/amd64` for Docker builds.

## Known Limitations

1. **In-memory rate limiting**: Only works for single-instance deployments. Use API Gateway rate limiting for horizontal scaling.
2. **In-memory conversation lock**: Same-conversation serialization requires session affinity or distributed locking (Redis) in multi-instance setups.
3. **SQLite single-writer**: Local SQLite backends do not support multi-instance writes. Use API-backed stores for horizontal scaling.
