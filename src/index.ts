import 'dotenv/config';
import { runStdioMode, runSSEMode, runStreamableHTTPMode } from './transport.js';

type TransportMode = 'stdio' | 'sse' | 'streamable-http' | undefined;

// 环境变量配置
const TRANSPORT_MODE = (process.env.TRANSPORT_MODE as TransportMode) || 'stdio';
const PORT = parseInt(process.env.PORT || '3000');
const MODELWHALE_TOKEN = process.env.MODELWHALE_TOKEN;

// 主函数 - 根据环境变量选择传输模式
async function main() {
  // stdio 模式下，不能用 console.log，因为 stdout 会用于 MCP 协议通信
  // console.error(`传输模式: ${TRANSPORT_MODE}`);

  try {
    if (!MODELWHALE_TOKEN) {
      throw new Error('环境变量 MODELWHALE_TOKEN 未设置');
    }

    switch (TRANSPORT_MODE.toLowerCase()) {
      case 'sse':
        await runSSEMode(PORT);
        break;
      case 'streamable-http':
        await runStreamableHTTPMode(PORT);
        break;
      case 'stdio':
      default:
        await runStdioMode();
        break;
    }
  } catch (error) {
    console.error('启动服务器时发生错误:', error);
    process.exit(1);
  }
}

// 启动应用
main();
