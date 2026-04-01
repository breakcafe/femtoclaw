# Femtoclaw API 调用指南

本文档面向客户端开发者和集成方，说明如何通过 HTTP API 与 Femtoclaw 对话 Agent 交互。

## 概览

Femtoclaw 提供 RESTful HTTP API，支持流式（SSE）和非流式两种模式。客户端只需发送当前轮消息，服务端自动管理完整对话上下文。

### 端点列表

| 方法     | 路径                   | 说明                 |
| -------- | ---------------------- | -------------------- |
| `GET`    | `/health`              | 健康检查             |
| `POST`   | `/chat`                | 发送消息或恢复暂停   |
| `GET`    | `/chat`                | 列出当前用户的会话   |
| `GET`    | `/chat/:id`            | 获取会话元数据       |
| `GET`    | `/chat/:id/messages`   | 获取会话消息历史     |
| `DELETE` | `/chat/:id`            | 删除会话             |
| `GET`    | `/skills`              | 获取可用技能列表     |
| `POST`   | `/admin/reload-skills` | 重新加载技能（管理） |

### 认证

当服务端配置了 `API_TOKEN` 时，除 `/health` 外所有请求需要携带 Bearer Token：

```
Authorization: Bearer <API_TOKEN>
```

用户身份通过请求头传递：

| 请求头        | 必须 | 说明             |
| ------------- | ---- | ---------------- |
| `X-User-Id`   | 推荐 | 用户唯一标识     |
| `X-User-Name` | 否   | 用户展示名称     |
| `X-Timezone`   | 否   | 用户时区         |
| `X-Locale`    | 否   | 语言偏好（如 zh-CN） |

当 `REQUIRE_USER_ID=true` 时，`X-User-Id` 为必填项，缺失将返回 400。

---

## 核心流程：发送消息

### 基本请求

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d '{
    "message": "你好，帮我查一下最近的消费",
    "stream": false
  }'
```

### 请求参数

```json
{
  "message": "用户消息文本",
  "conversation_id": "conv-xxx（可选，不传则新建会话）",
  "stream": true,

  "model": "claude-sonnet-4-20250514",
  "thinking": false,
  "max_thinking_tokens": 8192,

  "mcp_servers": { ... },
  "mcp_context": { ... },

  "timezone": "Asia/Shanghai",
  "locale": "zh-CN",
  "device_type": "mobile",
  "metadata": { "source": "app" }
}
```

| 字段                 | 类型     | 默认值                     | 说明                        |
| -------------------- | -------- | -------------------------- | --------------------------- |
| `message`            | string   | —                          | 用户消息（与 input_response 二选一） |
| `conversation_id`    | string   | 自动生成                   | 继续已有会话                |
| `stream`             | boolean  | `true`                     | 是否使用 SSE 流式响应       |
| `model`              | string   | `claude-sonnet-4-20250514` | 覆盖默认模型                |
| `thinking`           | boolean  | `false`                    | 启用 Extended Thinking      |
| `max_thinking_tokens` | number  | —                          | 思考过程最大 token 数       |
| `mcp_servers`        | object   | —                          | 请求级 MCP 服务器           |
| `mcp_context`        | object   | —                          | MCP 认证上下文覆盖          |
| `allowed_tools`      | string[] | —                          | 本次请求的工具白名单        |
| `timezone`           | string   | `UTC`                      | 用户时区                    |
| `locale`             | string   | —                          | 语言偏好                    |
| `device_type`        | string   | —                          | 设备类型                    |
| `metadata`           | object   | —                          | 自定义元数据                |

### 会话语义

- **增量协议**：客户端每次只发送当前轮新消息 + `conversation_id`，不需要回传完整对话历史。
- **服务端重建**：服务端从存储加载历史消息，重建完整的 Anthropic `messages[]` 上下文后发起 API 调用。
- **上下文压缩**：当消息历史超过 token 阈值时，服务端自动摘要压缩历史记录。

---

## 非流式响应

### 成功响应 (200)

```json
{
  "status": "success",
  "conversation_id": "conv-abc123",
  "message_id": "msg-def456",
  "content": "根据查询结果，您本周消费 ¥2,345，主要集中在餐饮和交通。",
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

### 等待用户输入 (202)

当 Agent 调用 `AskUserQuestion` 工具时，返回 HTTP 202：

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
        "question": "您希望查看哪个时间范围？",
        "header": "时间范围",
        "options": [
          { "label": "本周", "description": "最近 7 天" },
          { "label": "本月", "description": "当月至今" },
          { "label": "上月", "description": "上个完整月" }
        ]
      }
    ],
    "timeout_ms": 300000
  }
}
```

### 恢复暂停的对话

收到 `awaiting_input` 后，提交用户的选择来恢复：

```bash
curl -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d '{
    "conversation_id": "conv-abc123",
    "stream": false,
    "input_response": {
      "tool_use_id": "toolu_xxx",
      "answers": {
        "您希望查看哪个时间范围？": "本周"
      }
    }
  }'
```

暂停的问题在 `INPUT_TIMEOUT_MS`（默认 5 分钟）后自动失效。

---

## 流式响应（SSE）

设置 `stream: true` 时，响应为 Server-Sent Events 流：

### SSE 事件类型

| 事件               | 触发时机                   | data 内容                               |
| ------------------ | -------------------------- | --------------------------------------- |
| `message_start`    | 对话循环开始               | `{ conversation_id, message_id }`       |
| `text_delta`       | 增量文本输出               | `{ text }`                              |
| `thinking_delta`   | Extended Thinking 输出     | `{ thinking }`                          |
| `tool_use`         | Agent 调用工具             | `{ tool, input }`                       |
| `tool_result`      | 工具返回结果               | `{ tool, content }`                     |
| `input_required`   | 需要用户输入               | `{ type, tool_use_id, questions }`      |
| `message_paused`   | Agent 循环暂停             | `{ reason }`                            |
| `message_complete` | 对话循环结束               | `{ usage, stop_reason }`                |
| `error`            | 出错                       | `{ error, code }`                       |

### 流式示例

```bash
curl -N -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d '{"message":"帮我搜索一下最近的科技新闻","stream":true}'
```

响应：

```
event: message_start
data: {"conversation_id":"conv-abc","message_id":"msg-001"}

event: text_delta
data: {"text":"让我"}

event: text_delta
data: {"text":"搜索一下"}

event: tool_use
data: {"tool":"WebSearch","input":{"query":"最新科技新闻 2026"}}

event: tool_result
data: {"tool":"WebSearch","content":"1. Apple 发布..."}

event: text_delta
data: {"text":"根据搜索结果，最近的科技新闻有：..."}

event: message_complete
data: {"usage":{"input_tokens":1234,"output_tokens":567},"stop_reason":"end_turn"}
```

### 流式模式下的 AskUserQuestion

```
event: input_required
data: {"type":"ask_user_question","tool_use_id":"toolu_xxx","questions":[...]}

event: message_paused
data: {"reason":"waiting_for_user_input"}
```

收到 `message_paused` 后，客户端通过新的 `POST /chat`（携带 `input_response`）恢复。

---

## 会话管理

### 列出会话

```bash
curl http://localhost:9000/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```

响应：会话列表数组，按 `lastActivity` 降序排列。

支持分页参数：`?limit=50&offset=0`

### 获取会话详情

```bash
curl http://localhost:9000/chat/conv-abc123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```

返回会话元数据（id、状态、消息数、创建时间等）。用户只能访问自己的会话，否则返回 404。

### 获取消息历史

```bash
curl http://localhost:9000/chat/conv-abc123/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```

返回 `{ messages: [...] }`，按时间升序。

### 删除会话

```bash
curl -X DELETE http://localhost:9000/chat/conv-abc123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```

级联删除所有消息。正在运行的会话不可删除。

---

## MCP 服务接入

### 请求级 MCP 服务器

在 `POST /chat` 中动态注入外部 MCP 服务器：

```json
{
  "message": "查询我的消费数据",
  "mcp_servers": {
    "finance-api": {
      "type": "http",
      "url": "https://api.example.com/mcp"
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

- `mcp_servers`：定义 MCP 服务器（支持 `http`、`sse`、`stdio` 类型）
- `mcp_context`：为已有服务器注入认证信息（headers、env、args）

请求级服务器在请求结束后自动断开。

### 预配置 MCP 服务器

运维通过 `config/managed-mcp.json` 预配置始终可用的 MCP 服务器，客户端无需显式传入。

---

## 技能系统

### 获取可用技能

```bash
curl http://localhost:9000/skills \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```

返回当前用户可用的技能清单。Agent 会在对话中自动识别匹配的技能并加载使用。

---

## 错误处理

### HTTP 状态码

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | 成功                       |
| 202    | 等待用户输入（AskUserQuestion） |
| 400    | 请求参数错误               |
| 401    | 认证失败                   |
| 404    | 资源不存在或无权访问       |
| 409    | 会话正忙（并发冲突）       |
| 429    | 请求频率超限               |
| 500    | 服务端内部错误             |

### 错误响应格式

```json
{
  "error": "错误描述",
  "details": [...]
}
```

### 频率限制

默认每用户每分钟 60 次请求。响应头包含：

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1711929600
```

---

## 完整调用示例

### 新建会话 → 多轮对话 → 删除

```bash
# 1. 新建会话
RESP=$(curl -s -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d '{"message":"你好","stream":false}')

CONV_ID=$(echo $RESP | python3 -c "import sys,json; print(json.load(sys.stdin)['conversation_id'])")
echo "会话ID: $CONV_ID"

# 2. 继续对话
curl -s -X POST http://localhost:9000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123" \
  -d "{\"message\":\"帮我查一下本周消费\",\"conversation_id\":\"$CONV_ID\",\"stream\":false}"

# 3. 查看历史
curl -s http://localhost:9000/chat/$CONV_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"

# 4. 删除会话
curl -s -X DELETE http://localhost:9000/chat/$CONV_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-User-Id: user-123"
```
