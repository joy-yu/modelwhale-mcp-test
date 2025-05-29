# MCP ModelWhale 服务器

[![smithery badge](https://smithery.ai/badge/@joy-yu/modelwhale-mcp-test)](https://smithery.ai/server/@joy-yu/modelwhale-mcp-test)

这是一个模型上下文协议 (MCP) 服务器，可通过 User Token 访问 ModelWhale API 拿到相关信息。支持三种传输方式：stdio、SSE (Server-Sent Events) 和 StreamableHTTP，通过环境变量控制。

## 先决条件

- Node.js (v16 或更高版本)
- npm

## 设置

1. 克隆仓库
2. 安装依赖项：
   ```bash
   npm ci
   ```
3. 设置环境变量，具体环境变量解释可参考 `.env.example` 文件
     ```bash
     # 复制一份 .env 文件
     cp .env.example .env

     # 打开 .env 文件设置 token
     MODELWHALE_TOKEN=your_token
     ```



## 开发调试

开发时可以使用以下命令自动构建并启动：
- 已支持 dev 热更新，测试下来  **SSE 模式开发调试更方便**
- dev 默认开启 inspector，运行命令后打开 http://127.0.0.1:6274 访问即可

```bash
# 默认 stdio 开发模式
npm run dev

# stdio 开发模式
npm run dev:stdio

# SSE 开发模式(推荐)
npm run dev:sse

# StreamableHTTP 开发模式
npm run dev:streamable
```


## 运行服务器

服务器支持三种传输模式，通过环境变量 `TRANSPORT_MODE` 控制：

### 方式 1: stdio 传输方式（默认）

```bash
# 默认 stdio 传输方式
npm start

# 或者
TRANSPORT_MODE=stdio npm start

# 或者
npm run start:stdio
```

### 方式 2: SSE 传输方式

```bash
# 使用 SSE 传输方式
npm run start:sse

# 或者
TRANSPORT_MODE=sse npm start

# 自定义端口（默认为3000）
TRANSPORT_MODE=sse PORT=8080 npm start
```

SSE 服务器提供以下端点：
- `GET /sse` - 建立 SSE 连接
- `POST /messages` - 发送消息到服务器
- `GET /health` - 健康检查端点


### 方式 3: StreamableHTTP 传输方式（推荐）

```bash
# 使用 StreamableHTTP 传输方式
npm run start:streamable

# 或者
TRANSPORT_MODE=streamable-http npm start

# 自定义端口（默认为3000）
TRANSPORT_MODE=streamable-http PORT=8080 npm start
```

StreamableHTTP 服务器提供以下端点：
- `GET/POST/DELETE /mcp` - 处理所有 MCP 请求
- `GET /health` - 健康检查端点




## 传输方式对比

| 特性     | stdio        | SSE                       | StreamableHTTP       |
| -------- | ------------ | ------------------------- | -------------------- |
| 连接方式 | 标准输入输出 | HTTP + Server-Sent Events | HTTP + 流式响应      |
| 网络要求 | 无           | 需要HTTP连接              | 需要HTTP连接         |
| 调试难度 | 较难         | 较容易                    | 最容易               |
| 扩展性   | 限制较多     | 较灵活                    | 最灵活               |
| 会话管理 | 无           | 基于内存                  | 支持有状态/无状态    |
| 重连支持 | 无           | 有限                      | 支持断点续传         |
| 协议版本 | 2024-11-05   | 2024-11-05                | 2025-03-26（最新）   |
| 适用场景 | 本地集成     | 网络服务                  | 现代网络服务（推荐） |



## 测试服务器

### 测试 SSE 服务器

您可以使用以下命令测试 SSE 服务器的各个端点：

```bash
# 健康检查
curl http://localhost:3000/health

# 建立 SSE 连接（会保持连接打开）
curl -N http://localhost:3000/sse

# 发送测试消息（需要先建立 SSE 连接获取 sessionId）
curl -X POST http://localhost:3000/messages?sessionId=YOUR_SESSION_ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

或者使用项目中提供的测试脚本：

```bash
# 启动 SSE 服务器
npm run start:sse

# 在另一个终端运行测试
node test/test-sse.js
```

### 测试 StreamableHTTP 服务器

您可以使用以下命令测试 StreamableHTTP 服务器：

```bash
# 健康检查
curl http://localhost:3000/health

# 发送初始化请求
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# 获取工具列表（需要先获取会话ID）
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: YOUR_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

或者使用项目中提供的测试脚本：

```bash
# 启动 StreamableHTTP 服务器
npm run start:streamable

# 在另一个终端运行测试
node test/test-streamable-http.js
```

