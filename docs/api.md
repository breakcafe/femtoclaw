# API

## Endpoints

| Method   | Path                   | Description                                |
| -------- | ---------------------- | ------------------------------------------ |
| `GET`    | `/health`              | health check                               |
| `POST`   | `/chat`                | send a message or resume a paused question |
| `GET`    | `/chat`                | list current user's conversations          |
| `GET`    | `/chat/:id`            | conversation metadata                      |
| `GET`    | `/chat/:id/messages`   | conversation history                       |
| `DELETE` | `/chat/:id`            | delete a conversation                      |
| `GET`    | `/skills`              | effective skill manifest                   |
| `POST`   | `/admin/reload-skills` | reload skills from disk                    |

## POST /chat

Basic request body:

```json
{
  "message": "你好",
  "conversation_id": "optional",
  "stream": false
}
```

Conversation history semantics:

- The client API is incremental: send only the new user message plus optional `conversation_id`.
- The current femtoclaw server then reloads the persisted conversation history for that conversation and sends the reconstructed full `messages[]` context to the Anthropic Messages API on each turn.
- This is different from picoclaw's runtime internals, which also accept incremental client requests but can additionally use Claude Agent SDK session resume metadata.

Optional fields include:

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

## Non-Streaming Success Response

```json
{
  "status": "success",
  "conversation_id": "conv_xxx",
  "message_id": "msg_xxx",
  "content": "你好",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 45
  },
  "stop_reason": "end_turn",
  "model": "claude-sonnet-4-20250514"
}
```

## AskUserQuestion Resume Protocol

When the model asks a structured question in non-streaming mode, the server returns:

```json
{
  "status": "awaiting_input",
  "conversation_id": "conv_xxx",
  "message_id": "msg_xxx",
  "input_required": {
    "type": "ask_user_question",
    "tool_use_id": "toolu_xxx",
    "questions": [
      {
        "question": "你希望包含哪些部分？",
        "header": "报告范围",
        "options": [
          { "label": "消费", "description": "消费汇总" },
          { "label": "预算", "description": "预算对比" }
        ]
      }
    ],
    "timeout_ms": 300000
  }
}
```

Resume with:

```json
{
  "conversation_id": "conv_xxx",
  "stream": false,
  "input_response": {
    "tool_use_id": "toolu_xxx",
    "answers": {
      "你希望包含哪些部分？": "消费, 预算"
    }
  }
}
```

## SSE Events

Streaming `/chat` emits these events:

- `message_start`
- `text_delta`
- `thinking_delta`
- `tool_use`
- `tool_result`
- `input_required`
- `message_paused`
- `message_complete`
- `error`

`AskUserQuestion` in streaming mode emits:

1. `input_required`
2. `message_paused`

The client then resumes with a new `POST /chat`.
