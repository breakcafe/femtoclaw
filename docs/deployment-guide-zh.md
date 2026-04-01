# Femtoclaw 部署指南

本文档说明如何在不同环境中部署和运行 Femtoclaw 对话 Agent 服务。

## 前置要求

| 依赖           | 版本要求   | 说明                         |
| -------------- | ---------- | ---------------------------- |
| Node.js        | ≥ 20       | 默认运行时                   |
| Bun（可选）    | ≥ 1.3      | 可选运行时                   |
| Docker         | ≥ 24       | 容器化部署                   |
| Anthropic API  | —          | 必须有可用的 API Key         |

## 本地开发

```bash
cd code
npm install
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

npm run dev     # 开发模式（自动重载）
npm run build   # 编译 TypeScript
npm start       # 生产模式运行
```

验证：

```bash
curl http://localhost:9000/health
# 预期输出：{"status":"ok","version":"0.1.0",...}
```

---

## Docker 部署

### 运行时选择

Dockerfile 内置了 Node.js 和 Bun 两种运行时，通过 `RUNTIME` 构建参数切换：

```bash
# Node.js（默认，推荐生产使用）
docker build --platform linux/amd64 -t femtoclaw:node .

# Bun
docker build --platform linux/amd64 --build-arg RUNTIME=bun -t femtoclaw:bun .
```

两者的差异（详见 `docs/bun-migration-report.md`）：

| 维度       | Node.js      | Bun           |
| ---------- | ------------ | ------------- |
| 启动速度   | 更快（~7x）  | 较慢          |
| HTTP 延迟  | ~2ms         | ~0.5ms        |
| 内存占用   | ~93MB        | ~113MB        |
| 兼容性     | 原生支持     | 需 SQLite 适配层 |
| 推荐场景   | 生产环境     | 实验/评估     |

### 构建镜像

带完整元数据的构建命令：

```bash
docker build --platform linux/amd64 \
  --build-arg RUNTIME=node \
  --build-arg BUILD_VERSION=$(node -p "require('./package.json').version") \
  --build-arg BUILD_COMMIT=$(git rev-parse --short HEAD) \
  --build-arg BUILD_TIME=$(date -u +%FT%TZ) \
  -t femtoclaw:node .
```

构建参数：

| 参数            | 默认值    | 说明                    |
| --------------- | --------- | ----------------------- |
| `RUNTIME`       | `node`    | 运行时：`node` 或 `bun` |
| `BUILD_VERSION` | `0.1.0`   | 版本号                  |
| `BUILD_COMMIT`  | `unknown` | Git 提交哈希            |
| `BUILD_TIME`    | `unknown` | 构建时间戳              |

### 启动容器

基本启动：

```bash
docker run --rm -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  femtoclaw:node
```

带持久化数据：

```bash
docker run -d --name femtoclaw \
  -p 9000:9000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e API_TOKEN=your-secret-token \
  -v femtoclaw-data:/data \
  femtoclaw:node
```

### 一键脚本

使用 `femtoclaw.sh` 自动完成构建、启动和测试：

```bash
# Node.js（默认）
./femtoclaw.sh up

# Bun
RUNTIME=bun ./femtoclaw.sh up

# 完整流程：构建 → 启动 → 测试 → 停止
./femtoclaw.sh

# 其他命令
./femtoclaw.sh test      # 对运行中的实例执行测试
./femtoclaw.sh stop      # 停止容器
./femtoclaw.sh logs      # 查看日志
./femtoclaw.sh report    # 生成测试报告
```

### 健康检查

容器内置健康检查，每 30 秒探测一次：

```bash
curl -sf http://localhost:9000/health
```

预期响应：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "model": "claude-sonnet-4-20250514"
}
```

---

## 环境变量

### 必需

| 变量              | 说明                    |
| ----------------- | ----------------------- |
| `ANTHROPIC_API_KEY` | Anthropic 兼容的 API Key |

### 常用

| 变量                    | 默认值                     | 说明                     |
| ----------------------- | -------------------------- | ------------------------ |
| `PORT`                  | `9000`                     | HTTP 端口                |
| `API_TOKEN`             | 空（不鉴权）               | Bearer 认证 Token        |
| `DEFAULT_MODEL`         | `claude-sonnet-4-20250514` | 默认模型                 |
| `ANTHROPIC_BASE_URL`    | `https://api.anthropic.com` | API 代理地址            |
| `ASSISTANT_NAME`        | `Femtoclaw`                | 助手名称                 |
| `LOG_LEVEL`             | `info`                     | 日志级别                 |
| `REQUIRE_USER_ID`       | `false`                    | 是否强制要求 X-User-Id   |

### 存储

| 变量                       | 默认值                | 说明                         |
| -------------------------- | --------------------- | ---------------------------- |
| `SQLITE_DB_PATH`           | `./data/femtoclaw.db` | SQLite 数据库路径            |
| `CONVERSATION_STORE_TYPE`  | `sqlite`              | 会话存储：`sqlite` 或 `api`  |
| `CONVERSATION_STORE_URL`   | 空                    | 外部会话存储 API 地址        |
| `MEMORY_SERVICE_TYPE`      | `sqlite`              | 记忆服务：`sqlite`/`api`/`mcp` |
| `MEMORY_SERVICE_URL`       | 空                    | 外部记忆服务 API 地址        |

### 技能与 MCP

| 变量                 | 默认值                     | 说明                  |
| -------------------- | -------------------------- | --------------------- |
| `BUILTIN_SKILLS_DIR` | `./skills/builtin`         | 内置技能目录          |
| `ORG_SKILLS_URL`     | 空                         | 组织技能目录路径      |
| `USER_SKILLS_DIR`    | `./skills/user`            | 用户技能目录          |
| `MANAGED_MCP_CONFIG` | `./config/managed-mcp.json` | 预配置 MCP 服务器     |
| `ENABLE_MCP`         | `true`                     | MCP 总开关            |

完整变量列表见 `docs/configuration.md`。

---

## MCP 服务器配置

### 预配置 MCP 服务器

在 `config/managed-mcp.json` 中定义启动时自动连接的 MCP 服务器：

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

支持的传输协议：

| 类型    | 说明                                |
| ------- | ----------------------------------- |
| `http`  | Streamable HTTP（自动降级到 SSE）   |
| `sse`   | Server-Sent Events 传输             |
| `stdio` | 标准输入输出子进程（本地命令行工具） |

### 请求级 MCP 服务器

客户端在 `POST /chat` 请求中动态注入 MCP 服务器，请求结束后自动断开：

```json
{
  "mcp_servers": { "user-api": { "type": "http", "url": "..." } },
  "mcp_context": { "user-api": { "headers": { "Authorization": "Bearer ..." } } }
}
```

---

## 架构选型

### 单实例部署

适用于开发环境和低并发场景：

```
客户端 → Femtoclaw → Anthropic API
              │
        ┌─────┼─────┐
        SQLite MCP   技能
        (本地) 服务器 (本地)
```

所有状态存储在本地 SQLite，无外部依赖。

### 水平扩展部署

适用于生产环境：

```
             负载均衡器
          (会话亲和性)
               │
      ┌────────┼────────┐
  Femtoclaw  Femtoclaw  Femtoclaw
  (无状态)   (无状态)   (无状态)
      │          │          │
      └──────────┼──────────┘
                 │
        ┌────────┼────────┐
    共享存储    Anthropic  MCP
    (API 后端)  API       服务器
```

关键配置：

```bash
# 使用外部会话存储
CONVERSATION_STORE_TYPE=api
CONVERSATION_STORE_URL=https://store.internal/api

# 使用外部记忆服务
MEMORY_SERVICE_TYPE=api
MEMORY_SERVICE_URL=https://memory.internal/api
```

多实例部署的注意事项：

- **会话亲和性**：同一 `conversation_id` 的请求需路由到同一实例（因会话锁为进程内实现），通过负载均衡器的会话亲和性配置实现
- **频率限制**：进程内频率限制不跨实例共享，应在 API 网关层实现
- **SQLite 限制**：SQLite 不支持多写入者，多实例必须使用 API 后端

---

## 安全配置

### 生产环境必须

```bash
API_TOKEN=<强随机字符串>        # 必须设置
REQUIRE_USER_ID=true            # 强制用户标识
```

### 敏感信息

- 通过环境变量或云密钥管理服务注入 `ANTHROPIC_API_KEY` 和 `API_TOKEN`
- 切勿将 `.env` 文件提交到版本控制
- 定期轮换 `API_TOKEN`

### 网络

- 在 Femtoclaw 前端放置反向代理（Nginx/ALB）并配置 TLS
- 限制对容器端口的直接访问
- 对外部 MCP 服务器使用 HTTPS

详细安全模型见 `docs/security.md`。

---

## 日志与监控

### 日志

使用 pino 结构化日志，通过 `LOG_LEVEL` 控制级别：

```bash
LOG_LEVEL=debug   # 开发调试
LOG_LEVEL=info    # 生产默认
LOG_LEVEL=warn    # 仅警告和错误
```

### 关键指标

| 指标                   | 来源                    | 说明               |
| ---------------------- | ----------------------- | ------------------ |
| 请求延迟               | 应用日志                | 每请求 duration_ms |
| Token 消耗             | `message_complete` 事件 | input/output 分别  |
| 429 频率               | HTTP 状态码             | 频率限制命中率     |
| MCP 连接失败           | 应用日志                | MCP 可用性         |
| Compaction 触发次数     | 应用日志                | 长对话频率         |

### 优雅关闭

服务处理 `SIGTERM` 和 `SIGINT`：

1. 停止接受新连接
2. 等待进行中的请求完成
3. 关闭 MCP 连接
4. 关闭数据库连接

---

## 故障排除

### 常见问题

**启动失败："ANTHROPIC_API_KEY is required"**
→ 检查环境变量是否正确设置。

**MCP 连接超时**
→ 确认 `managed-mcp.json` 中的 URL 可从容器内部访问。对 `stdio` 类型，确认命令在 PATH 中可用。

**SQLite 锁定错误**
→ 确保只有一个实例写同一个 SQLite 文件。多实例部署需切换到 `CONVERSATION_STORE_TYPE=api`。

**技能加载警告**
→ 检查技能目录存在且包含有效的 `SKILL.md` 文件（需 YAML frontmatter）。

**用户数据隔离问题**
→ 生产环境务必设置 `REQUIRE_USER_ID=true`，确保每个请求携带 `X-User-Id`。
