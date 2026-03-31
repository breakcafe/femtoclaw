# Architecture

## Overview

Femtoclaw is a lightweight multi-user conversational agent service built directly on the Anthropic Messages API.

Core properties:

- conversation isolation by `userId`
- per-conversation serialization with an in-process lock
- built-in Skills mechanism
- MCP integration for external tools
- no shell or filesystem tools exposed to the model

## Main Flow

1. Request enters Express through `src/server.ts`.
2. Middleware assigns request ID, authenticates the user, and applies rate limiting.
3. `src/routes/chat.ts` resolves or creates the conversation and acquires the per-conversation lock.
4. `src/agent/engine.ts` builds system prompt, user preamble, tool list, and runs the Anthropic loop.
5. Tool calls are dispatched through `src/tools/executor.ts` to built-in tools or MCP servers.
6. New messages are persisted through the conversation store.
7. The lock is released in `finally`.

## Key Modules

| Area            | Files                           | Responsibility                                      |
| --------------- | ------------------------------- | --------------------------------------------------- |
| HTTP server     | `src/server.ts`, `src/index.ts` | app assembly and startup                            |
| Chat protocol   | `src/routes/chat.ts`            | chat, resume, SSE, CRUD                             |
| Agent loop      | `src/agent/engine.ts`           | Anthropic loop, tool execution, pause/resume        |
| Prompt assembly | `src/agent/context-builder.ts`  | core prompt, org prompt, skill and memory reminders |
| Conversations   | `src/conversation/*`            | store backends, lock, manager                       |
| Memory          | `src/memory/*`                  | `sqlite`, `api`, `mcp` memory backends              |
| Skills          | `src/skills/*`                  | skill loading, safety scanning, tier merge          |
| MCP             | `src/mcp/*`                     | managed config, transports, tool mapping            |
| Tools           | `src/tools/*`                   | built-in tool definitions                           |

## Skills

Current tier order:

1. built-in skills from `BUILTIN_SKILLS_DIR`
2. org skills from `ORG_SKILLS_URL` as a local directory
3. user skills from `USER_SKILLS_DIR`

## MCP

Supported server sources:

- managed servers from `config/managed-mcp.json`
- per-request servers from `POST /chat`

Supported transports:

- `http` with automatic SSE fallback
- `sse`
- `stdio`

## Interactive Pause/Resume

`AskUserQuestion` pauses the turn instead of blocking the HTTP request indefinitely.

- non-streaming requests return `202` with `status: "awaiting_input"`
- streaming requests emit `input_required` and `message_paused`
- the client resumes with another `POST /chat` carrying `input_response`

Paused questions expire after `INPUT_TIMEOUT_MS`. Expiration invalidates the pending question; this build does not auto-continue the conversation in the background.
