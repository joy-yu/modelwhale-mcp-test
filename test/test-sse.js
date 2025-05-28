#!/usr/bin/env node

/**
 * 简单的 SSE 客户端测试脚本
 * 用于测试 MCP SSE 服务器的基本功能
 */

const SERVER_URL = 'http://localhost:3000';

async function testSSEServer() {
  console.log('开始测试 SSE 服务器...\n');

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

  console.log('\n2. 测试 SSE 连接...');

  // 2. 建立 SSE 连接
  try {
    const sseResponse = await fetch(`${SERVER_URL}/sse`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    if (!sseResponse.ok) {
      throw new Error(`SSE 连接失败: ${sseResponse.status}`);
    }

    console.log('✅ SSE 连接已建立');
    console.log('📡 等待服务器事件...');

    // 读取 SSE 流
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();

    let sessionId = null;
    let endpointUrl = null;

    // 读取第一个事件（应该是 endpoint 事件）
    const { value, done } = await reader.read();
    if (!done) {
      const chunk = decoder.decode(value);
      console.log('📥 收到数据:', chunk);

      // 解析 endpoint 事件
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('event: endpoint')) {
          console.log('🎯 检测到端点事件');
        } else if (line.startsWith('data: ')) {
          endpointUrl = line.substring(6);
          console.log('🔗 端点 URL:', endpointUrl);

          // 提取 sessionId
          const url = new URL(endpointUrl, SERVER_URL);
          sessionId = url.searchParams.get('sessionId');
          console.log('🆔 会话 ID:', sessionId);
        }
      }
    }

    // 关闭 SSE 连接
    reader.releaseLock();

    if (sessionId) {
      console.log('\n3. 测试消息发送...');

      // 3. 发送初始化消息
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

      const messageResponse = await fetch(`${SERVER_URL}/messages?sessionId=${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(initMessage),
      });

      if (messageResponse.ok) {
        console.log('✅ 初始化消息发送成功');
        console.log('📊 响应状态:', messageResponse.status);
      } else {
        console.error('❌ 初始化消息发送失败:', messageResponse.status);
      }
    }
  } catch (error) {
    console.error('❌ SSE 测试失败:', error.message);
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
  console.log('🚀 MCP SSE 服务器测试工具\n');

  const isRunning = await checkServerRunning();
  if (!isRunning) {
    console.error('❌ 服务器未运行或无法访问');
    console.log('💡 请先启动服务器：npm run start:sse');
    process.exit(1);
  }

  await testSSEServer();
}

// 处理未捕获的错误
process.on('unhandledRejection', (error) => {
  console.error('未处理的错误:', error);
  process.exit(1);
});

// 运行测试
main();
