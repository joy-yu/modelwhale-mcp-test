import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const MODELWHALE_BASE_URL = process.env.MODELWHALE_BASE_URL || 'https://www.heywhale.com';
const MODELWHALE_TOKEN = process.env.MODELWHALE_TOKEN!;
const USER_AGENT = 'modelwhale-app/1.0.0';

// API 请求辅助函数
async function request<T>(url: string, config?: RequestInit & { token?: string }): Promise<T | null> {
  const method = config?.method || 'GET';
  const token = config?.token || MODELWHALE_TOKEN;
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'x-kesci-token': token,
    ...config?.headers,
  };

  try {
    const response = await fetch(url, { headers, method });

    if (!response.ok) {
      // 对于错误响应，尝试获取文本内容
      const errorText = await response.text();
      throw new Error(`\nHTTP error! ${response.status} - ${errorText}`);
    }

    // 检查响应的 Content-Type 来决定如何解析
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      const data = (await response.json()) as T;
      return data;
    } else {
      // 如果不是 JSON，返回文本内容
      const textData = await response.text();
      return textData as T;
    }
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

// 默认错误响应格式
function getDefaultError(message?: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: message || '请求出错',
      },
    ],
  };
}

// 注册项目工具
function registerLabTool(server: McpServer, token: string) {
  server.tool(
    'get-lab-list',
    '获取我的项目列表',
    {
      // page: z.number().min(1).optional().default(1).describe('页码'),
      // perPage: z.number().min(1).optional().default(10).describe('每页返回的项目数量')
    },
    async ({}) => {
      const params = new URLSearchParams({
        // page: `${page}`,
        // perPage: `${perPage}`,
      });
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/user/labs?${params}`, { token });
      if (!resp) {
        return getDefaultError();
      }

      return {
        content: [
          {
            type: 'text',
            text: resp.data.map((v) => [`项目名称: ${v.Title}`, `项目描述: ${v.Description || '无'}`, `更新时间: ${v.UpdateDate}`, `项目 ID: ${v._id}`].join('\n')).join('\n\n'),
          },
        ],
      };
    }
  );

  server.tool(
    'get-notebooks-from-lab',
    '获取指定项目 ID 下的 Notebook 列表',
    {
      id: z.string().describe('项目 ID'),
    },
    async ({ id }) => {
      const detailResp = await request<any>(`${MODELWHALE_BASE_URL}/api/labs/${id}`, { token, headers: { 'x-kesci-mod': '5', 'x-kesci-resource': id } });
      if (!detailResp) {
        return getDefaultError();
      }

      const params = new URLSearchParams({
        Lab: id,
      });
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/notebooks?${params}`, { token, headers: { authorization: detailResp.labToken } });

      return {
        content: [
          {
            type: 'text',
            text: resp.data
              .filter((v) => !v.IsCanvas)
              .map((v) => [`Notebook 名称: ${v.Name}`, `Notebook ID: ${v._id}`].join('\n'))
              .join('\n\n'),
          },
        ],
      };
    }
  );

  // 只缓存最近一次获取的 ipynb 文件 { id: resp }
  const cachedIpynbFile = new Map<string, any>();
  server.tool(
    'get-notebook-ipynb',
    '根据指定 Notebook ID 获取 Notebook ipynb 文件内容',
    {
      id: z.string().describe('Notebook ID'),
      // ipynb 可能会很大，所以在 mcp 层做了分页处理，但是看起来有些 agent 好像比较傻，不太会用分页调用逻辑
      // page: z.number().min(1).optional().default(1).describe('页码'),
      // perPage: z.number().min(1).optional().default(1000).describe('每页返回的 cell 数量'),
    },
    async ({ id }) => {
      // page, perPage
      let resp;

      if (cachedIpynbFile.has(id)) {
        resp = cachedIpynbFile.get(id);
      } else {
        const params = new URLSearchParams({});
        resp = await request<any>(`${MODELWHALE_BASE_URL}/api/notebooks/${id}/file?${params}`, { token });

        cachedIpynbFile.clear();
        cachedIpynbFile.set(id, resp);
      }

      if (!resp) {
        return getDefaultError();
      }

      // 添加总页数
      // const total_page = Math.ceil(resp.cells.length / perPage);

      // 深拷贝，避免后续修改影响缓存
      // resp = JSON.parse(JSON.stringify(resp));

      // 限制返回的 cell 数量，避免过大
      // resp.cells = resp.cells.slice((page - 1) * perPage, page * perPage);

      return {
        content: [
          {
            type: 'text',
            text: resp,
            // text: [`当前页数: ${page}\n总页数: ${total_page}`, resp].join('\n\n'),
          },
        ],
      };
    }
  );
}

// 注册离线任务工具
function registerMpiJobTool(server: McpServer, token: string) {
  const statusMap = {
    '-4': '已停止',
    '-3': '暂停中',
    '-2': '运行失败',
    '-1': '获取资源中',
    0: '未开始',
    1: '运行中',
    2: '运行成功',
  };

  server.tool('get-mpijob-list', '获取我的离线任务列表', {}, async ({}) => {
    const params = new URLSearchParams({
      IsGroupJob: 'false',
      IsMainWorkflow: 'false',
    });
    const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/mpiJobs?${params}`, { token });
    if (!resp) {
      return getDefaultError();
    }

    return {
      content: [
        {
          type: 'text',
          text: resp.data.map((v) => [`任务名称: ${v.Name}`, `任务状态: ${statusMap[v.Status] || '未知状态'}`, `任务 ID: ${v._id}`].join('\n')).join('\n\n'),
        },
      ],
    };
  });

  server.tool(
    'get-mpijob-log',
    '获取指定 ID 离线任务的日志',
    {
      id: z.string().describe('离线任务 ID'),
    },
    async ({ id }) => {
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/mpiJobs/${id}/logs`, { token });
      if (!resp) {
        return getDefaultError();
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2),
          },
        ],
      };
    }
  );
}

// 注册模型服务工具
function registerModelServiceTool(server: McpServer, token: string) {
  const statusMap = {
    0: '启动中',
    1: '就绪',
    2: '删除中',
    3: '启动失败',
    5: '休眠中',
    '-2': '初始化中',
  };

  server.tool('get-model-service-list', '获取我的模型服务列表', {}, async ({}) => {
    const params = new URLSearchParams({
      type: '1',
    });
    const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/model/services?${params}`, { token });
    if (!resp) {
      return getDefaultError();
    }

    return {
      content: [
        {
          type: 'text',
          text: resp.data
            .filter((v) => v.Status !== -1)
            .map((v) => [`模型服务名称: ${v.Title}`, `模型服务状态: ${statusMap[v.Status] || '未知状态'}`, `模型服务 ID: ${v._id}`].join('\n'))
            .join('\n\n'),
        },
      ],
    };
  });

  server.tool(
    'get-model-service-log',
    '获取指定 ID 模型服务的日志',
    {
      id: z.string().describe('模型服务 ID'),
    },
    async ({ id }) => {
      const params = new URLSearchParams({
        start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 最近一天
        end: new Date().toISOString(),
        tail: '100',
        direction: 'backward',
      });
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/model/services/${id}/logs?${params}`, { token });
      if (!resp) {
        return getDefaultError();
      }

      return {
        content: [
          {
            type: 'text',
            text: resp.data.result
              .map((item) => item.values.map((v) => v[1]))
              .flat()
              .join(''),
          },
        ],
      };
    }
  );
}

// 注册其它工具
function registerOtherTool(server: McpServer, token: string) {
  server.tool('get-token-coin', '获取本人剩余代币数量', {}, async ({}) => {
    const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/wallets?Type=WHALECOIN`, { token });
    if (!resp) {
      return getDefaultError();
    }

    return {
      content: [
        {
          type: 'text',
          text: `${resp.WHALECOIN} 代币`,
        },
      ],
    };
  });
}

// 注册所有工具的主函数
export function registerAllTools(server: McpServer, token?: string) {
  // 如果没有提供 token，尝试从环境变量获取（向后兼容）
  const actualToken = token || process.env.MODELWHALE_TOKEN;

  if (!actualToken) {
    throw new Error('MODELWHALE_TOKEN 未设置，请通过参数或环境变量提供');
  }

  registerLabTool(server, actualToken);
  registerMpiJobTool(server, actualToken);
  registerModelServiceTool(server, actualToken);
  registerOtherTool(server, actualToken);
}
