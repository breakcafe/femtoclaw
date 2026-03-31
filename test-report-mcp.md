# Femtoclaw MCP Status

## Implemented

- Managed MCP config loading from `config/managed-mcp.json`
- Per-request MCP server injection through `/chat`
- MCP tool mapping to `mcp__<server>__<tool>`
- Request-scoped `mcp_context` overlay for headers, env, and args
- Transport support: `http`, `sse`, `stdio`
- Memory backend delegation through MCP via `MEMORY_SERVICE_TYPE=mcp`

## Locally Verified In This Pass

- TypeScript build compiles with MCP `stdio` transport support
- Unit tests pass with MCP-backed memory service parsing logic

## Not Verified In This Pass

- Live connectivity to external MCP servers
- End-to-end Anthropic tool-use over MCP in a real conversation

## Manual Smoke Paths

Available local helpers:

- `npx tsx examples/mcp-test-server.ts`
- `npx tsx scripts/test-mcp-local.ts`
