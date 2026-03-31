# Femtoclaw

Lightweight conversational agent service built on the Anthropic Messages API.

## Code Style

- TypeScript strict mode
- ESM imports with explicit `.js` extensions
- Named exports only
- Single quotes, 2-space indentation
- Prefer interfaces for shared data contracts

## Commands

```bash
npm run build
npm test
npm run format:check
npm run dev
```

## Documentation Boundary

- Treat `docs/` inside this repository as the primary public documentation set for code work.
- Treat the outer workspace `../docs/` as internal notes, reports, and working material unless the task explicitly asks for it.
- When updating implementation docs, prefer changing `code/docs/*.md` first, then sync any internal follow-up notes separately.
- Config changes should be reflected in `code/docs/configuration.md`.

## Main Architecture

```text
src/index.ts                  boot + dependency wiring
src/server.ts                 Express app assembly
src/routes/chat.ts            chat + resume protocol
src/agent/engine.ts           Anthropic loop + tool dispatch
src/conversation/             store, lock, manager
src/memory/                   sqlite/api/mcp backends
src/skills/                   loader, manager, safety
src/mcp/                      managed config, pool, tool mapper
src/tools/                    built-in tools
```

## Important Behaviors

- Conversation isolation is keyed by `userId`.
- Same conversation is serialized by `ConversationLock`.
- `POST /chat` is incremental at the client boundary, but the server currently reloads persisted history and rebuilds full Anthropic `messages[]` on each turn.
- `AskUserQuestion` pauses a turn and resumes through a later `POST /chat`.
- Skills are loaded from builtin, optional org, and optional user directories.
- MCP supports `http`, `sse`, and `stdio`.

## Environment Variables

| Variable              | Default                     | Purpose                         |
| --------------------- | --------------------------- | ------------------------------- |
| `PORT`                | `9000`                      | HTTP port                       |
| `API_TOKEN`           | empty                       | Bearer auth token               |
| `ANTHROPIC_API_KEY`   | required                    | Anthropic API key               |
| `DEFAULT_MODEL`       | `claude-sonnet-4-20250514`  | Default model                   |
| `SQLITE_DB_PATH`      | `./data/femtoclaw.db`       | SQLite path                     |
| `MEMORY_SERVICE_TYPE` | `sqlite`                    | `sqlite`, `api`, `mcp`          |
| `MEMORY_MCP_SERVER`   | `memory`                    | MCP memory server name          |
| `ORG_SKILLS_URL`      | empty                       | Local org skills directory path |
| `USER_SKILLS_DIR`     | `./skills/user`             | Optional user skills path       |
| `MANAGED_MCP_CONFIG`  | `./config/managed-mcp.json` | Managed MCP config              |
| `INPUT_TIMEOUT_MS`    | `300000`                    | Question expiry                 |
| `ALLOWED_TOOLS`       | `*`                         | Built-in tool allowlist         |

## Guardrails

- Keep docs consistent with the actual implementation, especially around chat resume, skills, and MCP.
- Prefer `code/docs/` over outer docs when you need code-adjacent reference material.
- Use `apply_patch` for code edits.
- Run `npm run build && npm test && npm run format:check` before finishing.
- Do not claim live Anthropic or external MCP integration was verified unless it was actually run.
