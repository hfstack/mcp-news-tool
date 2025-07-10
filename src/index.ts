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
 * API响应类型
 */
type ApiResponse = {
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
async function fetchNews(category?: number, date?: string): Promise<ApiResponse> {
  let url = `${API_BASE_URL}`;
  
  if (category) {
    url += `?category=${category}`;
  }
  
  if (date) {
    url += category ? `&date=${date}` : `?date=${date}`;
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
  }
  
  return await response.json() as ApiResponse;
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
        
        const categoryNews = response.data.slice(0, 5).map(news => ({
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
        
        const found = response.data.find(news => news.id === Number(id));
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
      return {
        content: [{
          type: "json",
          json: response
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "json",
          json: {
            error: error instanceof Error ? error.message : String(error)
          }
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
            return {
              categoryId: Number(categoryId),
              categoryName: categoryMap[Number(categoryId)],
              news: response
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
      
      return {
        content: [{
          type: "json",
          json: {
            date: today,
            categories: results
          }
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "json",
          json: {
            error: error instanceof Error ? error.message : String(error)
          }
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
