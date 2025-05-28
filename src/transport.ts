import express from 'express';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

// 存储传输实例的映射
const sseTransports: Map<string, SSEServerTransport> = new Map();
const streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

// stdio 模式运行器
export async function runStdioMode() {
  // stdio 模式下，不能用 console.log，因为 stdout 会用于 MCP 协议通信
  // console.error('启动 MCP ModelWhale服务器 (stdio 模式)');

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // console.error('ModelWhale MCP 服务器正在通过 stdio 运行');
}

// SSE 模式运行器
export async function runSSEMode(port: number) {
  console.log(`启动 MCP ModelWhale服务器 (SSE 模式) - 端口 ${port}`);

  const app = express();
  app.use(express.json());

  // 处理 SSE 连接建立 (GET 请求)
  app.get('/sse', async (req, res) => {
    console.log('建立新的 SSE 连接');

    try {
      // 创建 SSE 传输
      const transport = new SSEServerTransport('/messages', res);

      // 存储传输实例
      sseTransports.set(transport.sessionId, transport);

      // 创建并连接服务器（这会自动调用 transport.start()）
      const server = createMcpServer();
      await server.connect(transport);

      console.log(`SSE 会话已建立，会话 ID: ${transport.sessionId}`);

      // 处理连接关闭
      transport.onclose = () => {
        console.log(`SSE 连接已关闭，会话 ID: ${transport.sessionId}`);
        sseTransports.delete(transport.sessionId);
      };

      // 处理错误
      transport.onerror = (error) => {
        console.error('SSE 传输错误:', error);
        sseTransports.delete(transport.sessionId);
      };
    } catch (error) {
      console.error('建立 SSE 连接时出错:', error);
      if (!res.headersSent) {
        res.status(500).end('服务器内部错误');
      }
    }
  });

  // 处理消息接收 (POST 请求)
  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: '缺少会话 ID' });
      return;
    }

    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: '会话未找到' });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('处理消息时出错:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: '处理消息失败' });
      }
    }
  });

  // 健康检查端点
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      transport: 'SSE',
      activeConnections: sseTransports.size,
      port: port,
    });
  });

  // 启动 Express 服务器
  app.listen(port, () => {
    console.log(`ModelWhale MCP 服务器正在通过 SSE 在端口 ${port} 上运行`);
    console.log(`SSE 端点: http://localhost:${port}/sse`);
    console.log(`消息端点: http://localhost:${port}/messages`);
    console.log(`健康检查: http://localhost:${port}/health`);
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('正在关闭 SSE 服务器...');
    // 关闭所有活动的传输
    for (const transport of sseTransports.values()) {
      transport.close();
    }
    process.exit(0);
  });
}

// StreamableHTTP 模式运行器
export async function runStreamableHTTPMode(port: number) {
  console.log(`启动 MCP ModelWhale服务器 (StreamableHTTP 模式) - 端口 ${port}`);

  const app = express();
  app.use(express.json());

  // 处理所有 MCP StreamableHTTP 请求 (GET, POST, DELETE)
  app.all('/mcp', async (req, res) => {
    console.log(`收到 ${req.method} 请求到 /mcp`);

    try {
      // 检查现有会话 ID
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && streamableTransports.has(sessionId)) {
        // 重用现有传输
        transport = streamableTransports.get(sessionId)!;
        console.log(`重用现有 StreamableHTTP 会话: ${sessionId}`);
      } else {
        // 创建新的传输实例
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId: string) => {
            console.log(`StreamableHTTP 会话已初始化，会话 ID: ${sessionId}`);
            streamableTransports.set(sessionId, transport);
          },
          enableJsonResponse: false, // 使用 SSE 流模式
        });

        // 创建并连接服务器
        const server = createMcpServer();
        await server.connect(transport);

        // 处理连接关闭
        transport.onclose = () => {
          console.log(`StreamableHTTP 连接已关闭，会话 ID: ${transport.sessionId}`);
          if (transport.sessionId) {
            streamableTransports.delete(transport.sessionId);
          }
        };

        // 处理错误
        transport.onerror = (error) => {
          console.error('StreamableHTTP 传输错误:', error);
          if (transport.sessionId) {
            streamableTransports.delete(transport.sessionId);
          }
        };
      }

      // 处理请求
      await transport.handleRequest(req, res, req.body);

      // 处理连接关闭
      res.on('close', () => {
        console.log('请求连接已关闭');
      });
    } catch (error) {
      console.error('处理 StreamableHTTP 请求时出错:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: '服务器内部错误',
          },
          id: null,
        });
      }
    }
  });

  // 健康检查端点
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      transport: 'StreamableHTTP',
      activeConnections: streamableTransports.size,
      port: port,
    });
  });

  // 启动 Express 服务器
  app.listen(port, () => {
    console.log(`ModelWhale MCP 服务器正在通过 StreamableHTTP 在端口 ${port} 上运行`);
    console.log(`MCP 端点: http://localhost:${port}/mcp`);
    console.log(`健康检查: http://localhost:${port}/health`);
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('正在关闭 StreamableHTTP 服务器...');
    // 关闭所有活动的传输
    for (const transport of streamableTransports.values()) {
      transport.close();
    }
    process.exit(0);
  });
}
