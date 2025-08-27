import express from 'express';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

// 存储传输实例的映射
const streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

// stdio 模式运行器
export async function runStdioMode() {
  // stdio 模式下，不能用 console.log，因为 stdout 会用于 MCP 协议通信
  // console.error('启动 MCP ModelWhale服务器 (stdio 模式)');

  const token = process.env.MODELWHALE_TOKEN;
  if (!token) {
    console.error('stdio 模式下环境变量 MODELWHALE_TOKEN 必须设置');
    process.exit(1);
  }

  const server = createMcpServer(token);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // console.error('ModelWhale MCP 服务器正在通过 stdio 运行');
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
      // 从 query 参数中获取 token
      const tokenFromQuery = req.query.token || req.query.MODELWHALE_TOKEN || req.query.Authorization;
      const token = (tokenFromQuery as string) || process.env.MODELWHALE_TOKEN;

      if (!token) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'MODELWHALE_TOKEN 必须通过 URL query 参数或环境变量提供',
          },
          id: null,
        });
        return;
      }

      console.log(`使用 token 来源: ${tokenFromQuery ? 'URL query' : 'environment variable'}`);

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
        const server = createMcpServer(token);
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
    const tokenFromQuery = req.query.token || req.query.MODELWHALE_TOKEN || req.query.Authorization;
    const hasToken = !!(tokenFromQuery || process.env.MODELWHALE_TOKEN);
    const tokenSource = tokenFromQuery ? 'query_parameter' : process.env.MODELWHALE_TOKEN ? 'environment' : 'none';

    res.json({
      status: 'ok',
      transport: 'StreamableHTTP',
      activeConnections: streamableTransports.size,
      port: port,
      hasToken: hasToken,
      tokenSource: tokenSource,
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
