# API Reference

## Endpoints

| Method   | Path                   | Description                            |
| -------- | ---------------------- | -------------------------------------- |
| `GET`    | `/health`              | Health check                           |
| `POST`   | `/chat`                | Send a message or resume a paused turn |
| `GET`    | `/chat`                | List current user's conversations      |
| `GET`    | `/chat/:id`            | Conversation metadata                  |
| `GET`    | `/chat/:id/messages`   | Conversation history                   |
| `DELETE` | `/chat/:id`            | Delete a conversation                  |
| `GET`    | `/skills`              | Available skill manifest               |
| `POST`   | `/admin/reload-skills` | Reload skills from disk                |

## Authentication

When `API_TOKEN` is configured, all endpoints except `/health` require a Bearer token:

```
Authorization: Bearer <API_TOKEN>
```

User identity is passed via request headers:

| Header        | Required                        | Description          |
| ------------- | ------------------------------- | -------------------- |
| `X-User-Id`   | Required when `REQUIRE_USER_ID=true` | Unique user identifier |
| `X-User-Name` | No                              | Display name         |
| `X-Timezone`  | No                              | User timezone        |
| `X-Locale`    | No                              | Language preference   |

---

## POST /chat

### Request Body

```json
{
  "message": "Hello",
  "conversation_id": "optional — omit to create a new conversation",
  "stream": true
}
```

| Field                | Type     | Default                    | Description                         |
| -------------------- | -------- | -------------------------- | ----------------------------------- |
| `message`            | string   | —                          | User message (or `input_response`)  |
| `conversation_id`    | string   | auto-generated             | Continue an existing conversation   |
| `stream`             | boolean  | `true`                     | Enable SSE streaming                |
| `model`              | string   | `claude-sonnet-4-20250514` | Override default model              |
| `thinking`           | boolean  | `false`                    | Enable Extended Thinking            |
| `max_thinking_tokens`| number   | —                          | Max thinking tokens                 |
| `mcp_servers`        | object   | —                          | Per-request MCP server definitions  |
| `mcp_context`        | object   | —                          | MCP auth context overlay            |
| `allowed_tools`      | string[] | —                          | Tool allowlist for this request     |
| `timezone`           | string   | `UTC`                      | User timezone                       |
| `locale`             | string   | —                          | Language preference                 |
| `device_type`        | string   | —                          | Device type                         |
| `metadata`           | object   | —                          | Custom metadata                     |
| `input_response`     | object   | —                          | Resume after AskUserQuestion        |

### Conversation Semantics

- **Incremental client protocol**: send only the new user message plus optional `conversation_id`.
- The server reloads persisted conversation history and rebuilds Anthropic `messages[]` context on each turn.
- To reduce stale intent carry-over in long sessions, only a recent message window is included in model context.
- History growth is controlled by automatic compaction, not by session resume handles.

---

## Non-Streaming Responses

### Success (200)

```json
{
  "status": "success",
  "conversation_id": "conv-abc123",
  "message_id": "msg-def456",
  "content": "Here is your spending summary for this week...",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "cache_read_tokens": 800,
    "cache_creation_tokens": 200
  },
  "stop_reason": "end_turn",
  "model": "claude-sonnet-4-20250514",
  "duration_ms": 3200
}
```

### Awaiting Input (202)

When the agent calls `AskUserQuestion`, the server returns HTTP 202:

```json
{
  "status": "awaiting_input",
  "conversation_id": "conv-abc123",
  "message_id": "msg-def456",
  "input_required": {
    "type": "ask_user_question",
    "tool_use_id": "toolu_xxx",
    "questions": [
      {
        "question": "What time range would you like?",
        "header": "Time Range",
        "options": [
          { "label": "This week", "description": "Last 7 days" },
          { "label": "This month", "description": "Current month to date" },
          { "label": "Last month", "description": "Previous full month" }
        ]
      }
    ],
    "timeout_ms": 300000
  }
}
```

### Resuming After AskUserQuestion

Submit the user's answer to resume the paused conversation:

```json
{
  "conversation_id": "conv-abc123",
  "stream": false,
  "input_response": {
    "tool_use_id": "toolu_xxx",
    "answers": {
      "What time range would you like?": "This week"
    }
  }
}
```

Pending questions expire after `INPUT_TIMEOUT_MS` (default: 5 minutes).

---

## SSE Streaming

When `stream: true`, the response is a Server-Sent Events stream.

### Event Types

| Event              | Trigger                        | Data                                    |
| ------------------ | ------------------------------ | --------------------------------------- |
| `message_start`    | Conversation loop begins       | `{ conversation_id, message_id }`       |
| `text_delta`       | Incremental text output        | `{ text }`                              |
| `thinking_delta`   | Extended Thinking output       | `{ thinking }`                          |
| `tool_use`         | Agent calls a tool             | `{ tool, input }`                       |
| `tool_result`      | Tool returns a result          | `{ tool, content }`                     |
| `input_required`   | User input needed              | `{ type, tool_use_id, questions }`      |
| `message_paused`   | Agent loop paused              | `{ reason }`                            |
| `message_complete` | Conversation loop ends         | `{ usage, stop_reason }`                |
| `error`            | Error occurred                 | `{ error, code }`                       |

### Example Stream

```
event: message_start
data: {"conversation_id":"conv-abc","message_id":"msg-001"}

event: text_delta
data: {"text":"Let me"}

event: text_delta
data: {"text":" search for that"}

event: tool_use
data: {"tool":"WebSearch","input":{"query":"latest tech news 2026"}}

event: tool_result
data: {"tool":"WebSearch","content":"1. Apple announced..."}

event: text_delta
data: {"text":"Based on the search results..."}

event: message_complete
data: {"usage":{"input_tokens":1234,"output_tokens":567},"stop_reason":"end_turn"}
```

### AskUserQuestion in Streaming Mode

```
event: input_required
data: {"type":"ask_user_question","tool_use_id":"toolu_xxx","questions":[...]}

event: message_paused
data: {"reason":"waiting_for_user_input"}
```

The client resumes with a new `POST /chat` carrying `input_response`.

---

## Conversation Management

### List Conversations

```
GET /chat?limit=50&offset=0
```

Returns conversations ordered by `lastActivity` descending.

### Get Conversation

```
GET /chat/:id
```

Returns conversation metadata. Users can only access their own conversations (404 otherwise).

### Get Messages

```
GET /chat/:id/messages
```

Returns `{ messages: [...] }` ordered by creation time ascending.

### Delete Conversation

```
DELETE /chat/:id
```

Cascade-deletes all messages. Running conversations cannot be deleted.

---

## MCP Integration

### Per-Request MCP Servers

Attach temporary MCP servers in the `POST /chat` body:

```json
{
  "message": "Query my data",
  "mcp_servers": {
    "finance-api": {
      "type": "http",
      "url": "https://mcp.example.com/api"
    }
  },
  "mcp_context": {
    "finance-api": {
      "headers": {
        "Authorization": "Bearer user-specific-token"
      }
    }
  }
}
```

Supported transport types: `http`, `sse`, `stdio`.

Per-request servers are disconnected after the request completes.

---

## Error Handling

### HTTP Status Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 200  | Success                              |
| 202  | Awaiting user input (AskUserQuestion)|
| 400  | Invalid request parameters           |
| 401  | Authentication failed                |
| 404  | Resource not found or access denied  |
| 409  | Conversation busy (concurrent conflict) |
| 429  | Rate limit exceeded                  |
| 500  | Internal server error                |

### Error Response Format

```json
{
  "error": "Description of the error",
  "details": [...]
}
```

### Rate Limiting

Default: 60 requests per user per minute. Response headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1711929600
```

---

## Complete Example

```bash
# 1. Create a new conversation
RESP=$(curl -s -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d '{"message":"Hello","stream":false}')

CONV_ID=$(echo $RESP | python3 -c "import sys,json; print(json.load(sys.stdin)['conversation_id'])")

# 2. Continue the conversation
curl -s -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d "{\"message\":\"What was my last message?\",\"conversation_id\":\"$CONV_ID\",\"stream\":false}"

# 3. View history
curl -s http://localhost:9000/chat/$CONV_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"

# 4. Delete conversation
curl -s -X DELETE http://localhost:9000/chat/$CONV_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```
