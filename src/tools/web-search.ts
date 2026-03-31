import type { ToolDefinition } from '../types.js';

export const WebSearchTool: ToolDefinition = {
  name: 'WebSearch',
  description:
    'Search the internet for current information. Use when the user asks about current events, recent data, or information beyond your knowledge cutoff.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
    },
    required: ['query'],
  },

  async execute(input) {
    const query = input.query as string;
    // WebSearch is a proxy tool — in production, this would call an actual search API
    // For now, return a placeholder indicating the tool was invoked
    return {
      type: 'text',
      text: `[WebSearch] Query: "${query}"\n\nNote: WebSearch backend not configured. To enable, integrate a search API (e.g., Brave, SerpAPI, or Tavily).`,
    };
  },
};
