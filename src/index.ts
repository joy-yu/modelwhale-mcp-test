import 'dotenv/config';
import { runStdioMode, runStreamableHTTPMode } from './transport.js';

type TransportMode = 'stdio' | 'streamable-http' | undefined;

// 环境变量配置
const TRANSPORT_MODE = (process.env.TRANSPORT_MODE as TransportMode) || 'streamable-http';
const PORT = parseInt(process.env.PORT || '3000');
const MODELWHALE_TOKEN = process.env.MODELWHALE_TOKEN;

// 主函数 - 根据环境变量选择传输模式
async function main() {
  // stdio 模式下，不能用 console.log，因为 stdout 会用于 MCP 协议通信
  // console.error(`传输模式: ${TRANSPORT_MODE}`);

  try {
    switch (TRANSPORT_MODE.toLowerCase()) {
      case 'stdio':
        await runStdioMode();
        break;
      case 'streamable-http':
      default:
        await runStreamableHTTPMode(PORT);
        break;
    }
  } catch (error) {
    console.error('启动服务器时发生错误:', error);
    process.exit(1);
  }
}

// 启动应用
main();
