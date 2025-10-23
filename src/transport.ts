import express from 'express';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { SessionManager } from './session-manager.js';

/**
 * stdio 模式运行器
 *
 * 通过标准输入/输出与 MCP 客户端通信
 * 适用于本地命令行工具或 VS Code 等编辑器集成
 *
 * @remarks
 * - stdio 模式下不能使用 console.log，因为 stdout 用于 MCP 协议通信
 * - 必须设置环境变量 MODELWHALE_TOKEN
 */
export async function runStdioMode() {
  const token = process.env.MODELWHALE_TOKEN;
  if (!token) {
    console.error('stdio 模式下环境变量 MODELWHALE_TOKEN 必须设置');
    process.exit(1);
  }

  const server = createMcpServer(token);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

/**
 * 会话管理器实例
 *
 * 管理所有 StreamableHTTP 会话的生命周期
 * 配置说明：
 * - maxSessions: Infinity - 不限制会话数量
 * - idleTimeout: 6小时 - 超过 6 小时未访问的会话会被清理
 * - cleanupInterval: 6小时 - 每 6 小时执行一次清理检查
 */
const sessionManager = new SessionManager({
  maxSessions: Infinity,
  idleTimeout: 6 * 60 * 60 * 1000,
  cleanupInterval: 6 * 60 * 60 * 1000,
});

/**
 * StreamableHTTP 模式运行器
 *
 * 通过 HTTP/SSE 与 MCP 客户端通信
 * 适用于 Web 应用、远程服务等场景
 *
 * @param port - HTTP 服务器监听端口
 *
 * @remarks
 * 支持通过以下方式提供 MODELWHALE_TOKEN：
 * 1. URL query 参数: ?token=xxx 或 ?MODELWHALE_TOKEN=xxx
 * 2. 环境变量: MODELWHALE_TOKEN
 *
 * 端点：
 * - POST/GET/DELETE /mcp - MCP 协议通信端点
 * - GET /health - 健康检查和会话统计
 */
export async function runStreamableHTTPMode(port: number) {
  console.log(`启动 MCP ModelWhale服务器 (StreamableHTTP 模式) - 端口 ${port}`);

  const app = express();
  app.use(express.json());

  /**
   * MCP 协议通信端点
   *
   * 处理所有 MCP StreamableHTTP 请求
   * - GET: 初始化会话，返回 SSE 流
   * - POST: 发送 MCP 请求消息
   * - DELETE: 关闭会话
   */
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

      // 检查现有会话 ID（MCP 客户端通过 header 传递）
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessionManager.has(sessionId)) {
        // 重用现有会话（get 方法会自动更新最后访问时间）
        transport = sessionManager.get(sessionId)!;
        console.log(`重用现有 StreamableHTTP 会话: ${sessionId}`);
      } else {
        // 创建新的 StreamableHTTP 传输实例
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId: string) => {
            console.log(`StreamableHTTP 会话已初始化，会话 ID: ${sessionId}`);
            sessionManager.add(sessionId, transport);
          },
          enableJsonResponse: false, // 使用 SSE 流模式
        });

        // 创建并连接 MCP 服务器实例
        const server = createMcpServer(token);
        await server.connect(transport);

        // 监听连接关闭事件，及时清理会话
        transport.onclose = () => {
          console.log(`StreamableHTTP 连接已关闭，会话 ID: ${transport.sessionId}`);
          if (transport.sessionId) {
            sessionManager.delete(transport.sessionId);
          }
        };

        // 处理错误
        transport.onerror = (error) => {
          console.error('StreamableHTTP 传输错误:', error);
          if (transport.sessionId) {
            sessionManager.delete(transport.sessionId);
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

    // 获取会话统计信息
    const stats = sessionManager.getStats();
    const config = sessionManager.getConfig();

    res.json({
      status: 'ok',
      transport: 'StreamableHTTP',
      activeConnections: stats.activeCount,
      maxConnections: stats.maxSessions,
      port: port,
      hasToken: hasToken,
      tokenSource: tokenSource,
      sessionConfig: config,
      sessions: stats.sessions,
    });
  });

  // 启动 Express 服务器
  app.listen(port, () => {
    console.log(`ModelWhale MCP 服务器正在通过 StreamableHTTP 在端口 ${port} 上运行`);
    console.log(`MCP 端点: http://localhost:${port}/mcp`);
    console.log(`健康检查: http://localhost:${port}/health`);
  });

  // 启动会话管理器的定期清理任务
  sessionManager.startCleanup();

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('正在关闭 StreamableHTTP 服务器...');
    sessionManager.closeAll();
    process.exit(0);
  });
}
