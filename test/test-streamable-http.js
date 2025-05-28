#!/usr/bin/env node

/**
 * StreamableHTTP 客户端测试脚本
 * 用于测试 MCP StreamableHTTP 服务器的基本功能
 */

const SERVER_URL = 'http://localhost:3000';

async function testStreamableHTTPServer() {
  console.log('开始测试 StreamableHTTP 服务器...\n');

  // 1. 测试健康检查
  console.log('1. 测试健康检查端点...');
  try {
    const healthResponse = await fetch(`${SERVER_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ 健康检查成功:', healthData);
  } catch (error) {
    console.error('❌ 健康检查失败:', error.message);
    return;
  }

  console.log('\n2. 测试初始化请求 (POST)...');

  // 2. 发送初始化请求
  try {
    const initMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    const initResponse = await fetch(`${SERVER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(initMessage),
    });

    console.log('📊 初始化响应状态:', initResponse.status);
    console.log('📋 响应头:', Object.fromEntries(initResponse.headers.entries()));

    if (initResponse.ok) {
      console.log('✅ 初始化请求发送成功');

      // 检查是否返回了会话 ID
      const sessionId = initResponse.headers.get('mcp-session-id');
      if (sessionId) {
        console.log('🆔 会话 ID:', sessionId);

        // 读取 stream 流
        if (initResponse.headers.get('content-type')?.includes('text/event-stream')) {
          console.log('📡 开始读取 stream 流...');

          const reader = initResponse.body.getReader();
          const decoder = new TextDecoder();

          // 读取几个事件
          let eventCount = 0;
          const maxEvents = 5;

          while (eventCount < maxEvents) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            if (chunk.trim()) {
              console.log(`📥 收到事件 ${eventCount + 1}:`, chunk);
              eventCount++;
            }
          }

          reader.releaseLock();

          console.log('\n3. 测试后续请求...');

          // 3. 发送工具列表请求
          const toolsMessage = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          };

          const toolsResponse = await fetch(`${SERVER_URL}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'mcp-session-id': sessionId,
              Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify(toolsMessage),
          });

          if (toolsResponse.ok) {
            console.log('✅ 工具列表请求发送成功');
            console.log('📊 响应状态:', toolsResponse.status);
          } else {
            console.error('❌ 工具列表请求失败:', toolsResponse.status);
          }
        } else {
          // 处理 JSON 响应
          const data = await initResponse.json();
          console.log('📄 收到 JSON 响应:', data);
        }
      } else {
        console.log('⚠️  未收到会话 ID，可能是无状态模式');
      }
    } else {
      console.error('❌ 初始化请求失败:', initResponse.status);
      const errorText = await initResponse.text();
      console.error('❌ 错误响应:', errorText);
    }
  } catch (error) {
    console.error('❌ StreamableHTTP 测试失败:', error.message);
  }

  console.log('\n🏁 测试完成！');
}

// 检查服务器是否运行
async function checkServerRunning() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// 主函数
async function main() {
  console.log('🚀 MCP StreamableHTTP 服务器测试工具\n');

  const isRunning = await checkServerRunning();
  if (!isRunning) {
    console.error('❌ 服务器未运行或无法访问');
    console.log('💡 请先启动服务器：npm run start:streamable');
    process.exit(1);
  }

  await testStreamableHTTPServer();
}

// 处理未捕获的错误
process.on('unhandledRejection', (error) => {
  console.error('未处理的错误:', error);
  process.exit(1);
});

// 运行测试
main();
