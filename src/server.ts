import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools.js';

// 创建并配置服务器实例
export function createMcpServer(token?: string): McpServer {
  const server = new McpServer({
    name: 'modelwhale',
    version: '1.0.0',
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // 注册所有工具，传递 token
  registerAllTools(server, token);

  return server;
}
