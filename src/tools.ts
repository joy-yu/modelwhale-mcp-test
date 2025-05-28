import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const MODELWHALE_BASE_URL = process.env.MODELWHALE_BASE_URL || 'https://www.heywhale.com';
const MODELWHALE_TOKEN = process.env.MODELWHALE_TOKEN!;
const USER_AGENT = 'modelwhale-app/1.0.0';

// API 请求辅助函数
async function request<T>(url: string, config?: RequestInit): Promise<T | null> {
  const method = config?.method || 'GET';
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'x-kesci-token': MODELWHALE_TOKEN,
    ...config?.headers,
  };

  try {
    const response = await fetch(url, { headers, method });
    console.log(response, headers);

    const data = (await response.json()) as T;

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${JSON.stringify(data)}`);
    }
    return data;
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

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

// 注册 ModelWhale 工具
function registerModelWhaleTool(server: McpServer) {
  server.tool(
    'get-lab-list',
    '获取我的项目列表',
    {
      // page: z.number().min(1).optional().default(1),
      // perPage: z.number().min(1).optional().default(10)
    },
    async ({}) => {
      const params = new URLSearchParams({
        // page: `${page}`,
        // perPage: `${perPage}`,
      });
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/user/labs?${params}`);
      if (!resp) {
        return getDefaultError();
      }

      return {
        content: resp.data.map((v) => ({
          type: 'text',
          text: `项目名称: ${v.Title}\n项目描述: ${v.Description || '无'}\n项目 ID: ${v._id}\n`,
        })),
      };
    }
  );

  server.tool(
    'get-notebooks-from-lab',
    '根据指定项目 ID 获取该项目下的 Notebook 列表',
    {
      id: z.string().describe('项目 ID'),
    },
    async ({ id }) => {
      const detailResp = await request<any>(`${MODELWHALE_BASE_URL}/api/labs/${id}`, { headers: { 'x-kesci-mod': '5', 'x-kesci-resource': id } });
      if (!detailResp) {
        return getDefaultError();
      }

      const params = new URLSearchParams({
        Lab: id,
      });
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/notebooks?${params}`, { headers: { authorization: detailResp.labToken } });

      return {
        content: [
          {
            type: 'text',
            text: resp.data.map((v) => `Notebook 名称: ${v.Name}\nNotebook ID: ${v._id}\n`).join('\n'),
          },
        ],
      };
    }
  );

  server.tool(
    'get-notebook-ipynb',
    '根据指定 Notebook ID 获取 Notebook ipynb 文件',
    {
      id: z.string().describe('Notebook ID'),
    },
    async ({ id }) => {
      const params = new URLSearchParams({});
      const resp = await request<any>(`${MODELWHALE_BASE_URL}/api/notebooks/${id}/file?${params}`);
      if (!resp) {
        return getDefaultError();
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resp, null, 2),
          },
        ],
      };
    }
  );
}

// 注册所有工具的主函数
export function registerAllTools(server: McpServer) {
  registerModelWhaleTool(server);
}
