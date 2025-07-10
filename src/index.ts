#!/usr/bin/env node

/**
 * 这是一个实现新闻获取系统的MCP服务器。
 * 它通过以下功能演示了MCP的核心概念，如资源和工具：
 * - 将新闻列为资源
 * - 读取单个新闻
 * - 获取不同分类的新闻
 * - 支持日期筛选功能
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { z } from "zod";
import fetch from "node-fetch";

/**
 * 新闻对象的类型别名
 */
type News = {
  id: number;
  title: string;
  content: string;
  category: number;
  news_time: string;
  source: string;
  url: string;
};

/**
 * 分页信息类型
 */
type Pagination = {
  current_page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
};

/**
 * API成功响应类型
 */
type ApiSuccessResponse = {
  code: number;
  data: News[];
  pagination: Pagination;
  params: {
    category: number;
    page: number;
    per_page: number;
  };
};

/**
 * API错误响应类型
 */
type ApiErrorResponse = {
  code: number;
  error: string;
  timestamp: string;
  path: string;
};

/**
 * API响应联合类型
 */
type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

/**
 * 分类名称映射
 */
const categoryMap: Record<number, string> = {
  1: "汽车行业",
  2: "AI技术",
  4: "热门新闻"
};

/**
 * 新闻API基础URL
 */
const API_BASE_URL = "http://116.62.41.253:6060/api/news";

/**
 * 获取新闻数据的函数
 */
async function fetchNews(category?: number, date?: string, retries = 3): Promise<ApiResponse> {
  let lastError: Error | null = null;
  let requestPath = '';
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let url = `${API_BASE_URL}`;
      
      if (category) {
        url += `?category=${category}`;
      }
      
      if (date) {
        url += category ? `&date=${date}` : `?date=${date}`;
      }
      
      requestPath = url.replace(API_BASE_URL, '');
      console.log(`尝试第 ${attempt} 次请求: ${url}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5秒超时
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Daily-News-Client/1.0',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache'
        }
      });
      
      clearTimeout(timeout);
      
      const data = await response.json() as any;
      
      if (!response.ok) {
        return {
          code: response.status,
          error: data.message || `API请求失败: ${response.status} ${response.statusText}`,
          timestamp: new Date().toISOString(),
          path: requestPath
        };
      }
      
      // 验证响应数据结构
      if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray((data as any).data)) {
        return {
          code: 500,
          error: 'API响应格式错误: 无效的数据结构',
          timestamp: new Date().toISOString(),
          path: requestPath
        };
      }
      
      return data as ApiSuccessResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`请求失败 (尝试 ${attempt}/${retries}):`, lastError.message);
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('请求超时');
      }
      
      // 如果不是最后一次尝试，等待后重试
      if (attempt < retries) {
        const delay = attempt * 1000; // 递增延迟
        console.log(`等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // 所有重试都失败后返回错误响应
  return {
    code: 500,
    error: lastError?.message || '未知错误',
    timestamp: new Date().toISOString(),
    path: requestPath
  };
}

/**
 * 检查API响应是否成功
 */
function isSuccessResponse(response: ApiResponse): response is ApiSuccessResponse {
  return 'data' in response && Array.isArray(response.data);
}

/**
 * 处理新闻列表的函数
 */
function processNewsData(response: ApiResponse): News[] {
  if (isSuccessResponse(response)) {
    return response.data;
  }
  return [];
}

/**
 * 创建MCP服务器
 */
const server = new McpServer({
  name: "daily-news",
  version: "0.1.0",
});

// 创建分类资源模板
const categoriesTemplate = new ResourceTemplate("news:///categories/{id}", {
  // 列出所有分类
  list: async () => ({
    resources: Object.entries(categoryMap).map(([id, name]) => ({
      uri: `news:///categories/${id}`,
      mimeType: "text/plain",
      name: name,
      description: `新闻分类: ${name}`
    })),
  }),
});

// 注册分类资源
server.registerResource(
  "categories",
  categoriesTemplate,
  {
    title: "新闻分类",
    description: "获取所有新闻分类信息"
  },
  // 读取指定分类的描述
  async (uri: URL, variables: Variables) => {
    const id = variables.id as string;
    const categoryId = Number(id);
    const categoryName = categoryMap[categoryId];
    
    if (!categoryName) {
      throw new Error(`分类 ${id} 未找到`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: `分类ID: ${id}, 名称: ${categoryName}`
      }]
    };
  }
);

// 创建新闻资源模板
const newsTemplate = new ResourceTemplate("news:///articles/{id}", {
  // 列出所有新闻资源（默认获取每个分类的最新条目）
  list: async () => {
    const allNews: { uri: string; mimeType: string; name: string; description: string }[] = [];
    
    // 获取每个分类的新闻
    for (const categoryId of Object.keys(categoryMap)) {
      try {
        const response = await fetchNews(Number(categoryId));
        const newsData = processNewsData(response);
        
        const categoryNews = newsData.slice(0, 5).map(news => ({
          uri: `news:///articles/${news.id}`,
          mimeType: "text/plain",
          name: news.title,
          description: `来源: ${news.source}, 时间: ${news.news_time}`
        }));
        
        allNews.push(...categoryNews);
      } catch (error) {
        console.error(`获取分类 ${categoryId} 的新闻失败:`, error);
      }
    }
    
    return { resources: allNews };
  },
});
// 注册新闻资源
server.registerResource(
  "news",
  newsTemplate,
  {
    title: "新闻文章",
    description: "获取所有新闻文章信息"
  },
  // 读取指定新闻内容
  async (uri: URL, variables: Variables) => {
    const id = variables.id as string;
    
    // 这里需要查询API获取特定ID的新闻
    // 由于API不支持按ID查询，我们需要遍历所有分类查找
    let targetNews: News | null = null;
    
    for (const categoryId of Object.keys(categoryMap)) {
      try {
        // 尝试获取数据以提高找到目标新闻的概率
        const response = await fetchNews(Number(categoryId));
        const newsData = processNewsData(response);
        
        const found = newsData.find(news => news.id === Number(id));
        if (found) {
          targetNews = found;
          break;
        }
      } catch (error) {
        console.error(`查找新闻ID ${id} 在分类 ${categoryId} 中失败:`, error);
      }
    }
    
    if (!targetNews) {
      throw new Error(`新闻 ${id} 未找到`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: `标题: ${targetNews.title}\n\n内容: ${targetNews.content}\n\n来源: ${targetNews.source}\n时间: ${targetNews.news_time}\n分类: ${categoryMap[targetNews.category]}\n原文链接: ${targetNews.url}`
      }]
    };
  }
);

/**
 * 注册获取指定分类和日期的新闻工具
 */
server.tool(
  "get_category_news",
  {
    category: z.number().default(1).describe("新闻分类ID: 1=汽车行业, 2=AI技术, 4=热门新闻"),
    date: z.string().optional().describe("日期格式 YYYY-MM-DD").default(() => {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }),
  },
  async ({ category, date }) => {
    try {
      const response = await fetchNews(category, date);
      const categoryName = categoryMap[category] || "未知分类";
      const newsData = processNewsData(response);
      
      if (!isSuccessResponse(response)) {
        return {
          content: [{
            type: "text",
            text: `查询失败: ${response.error}`
          }]
        };
      }
      
      const newsText = newsData.map(news => 
        `标题: ${news.title}\n内容: ${news.content}\n来源: ${news.source}\n时间: ${news.news_time}\n链接: ${news.url}\n`
      ).join("\n---\n\n");
      
      return {
        content: [{
          type: "text",
          text: `查询结果:\n\n分类: ${categoryName} (ID: ${category})\n日期: ${date}\n\n总条数: ${newsData.length}\n\n${newsText}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `查询失败: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
);
/**
 * 注册获取分类列表工具
 */
server.tool(
  "get_categories",
  {},
  async () => {
    const categories = Object.entries(categoryMap).map(([id, name]) => {
      return `- ID: ${id}, 名称: ${name}`;
    }).join("\n");
    
    return {
      content: [{
        type: "text",
        text: `可用的新闻分类:\n\n${categories}`
      }]
    };
  }
);

/**
 * 注册获取每个分类最新新闻的工具
 */
server.tool(
  "get_latest_news",
  {},
  async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const results = await Promise.all(
        Object.entries(categoryMap).map(async ([categoryId]) => {
          try {
            const response = await fetchNews(Number(categoryId), today);
            const newsData = processNewsData(response);
            
            if (!isSuccessResponse(response)) {
              return {
                categoryId: Number(categoryId),
                categoryName: categoryMap[Number(categoryId)],
                error: response.error
              };
            }
            
            return {
              categoryId: Number(categoryId),
              categoryName: categoryMap[Number(categoryId)],
              news: newsData
            };
          } catch (error) {
            return {
              categoryId: Number(categoryId),
              categoryName: categoryMap[Number(categoryId)],
              error: error instanceof Error ? error.message : String(error)
            };
          }
        })
      );
      
      let text = `各分类最新新闻:\n\n`;
      
      for (const result of results) {
        text += `${result.categoryName} (ID: ${result.categoryId}):\n\n`;
        
        if ('error' in result) {
          text += `获取失败 - ${result.error}\n\n`;
        } else if (result.news.length === 0) {
          text += `暂无新闻\n\n`;
        } else {
          result.news.forEach(news => {
            text += `标题: ${news.title}\n`;
            text += `内容: ${news.content}\n`;
            text += `来源: ${news.source}\n`;
            text += `时间: ${news.news_time}\n`;
            text += `链接: ${news.url}\n\n`;
          });
        }
        
        text += `---\n\n`;
      }
      
      return {
        content: [{
          type: "text",
          text: text.trim()
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `获取新闻失败: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
);

/**
 * 使用stdio传输启动服务器。
 * 这允许服务器通过标准输入/输出流进行通信。
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("服务器错误:", error);
  process.exit(1);
});
