import type { ToolDefinition } from '../types.js';

export const WebFetchTool: ToolDefinition = {
  name: 'WebFetch',
  description:
    'Fetch and extract content from a specified URL. Use when the user provides a URL or you need to read a web page.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      prompt: {
        type: 'string',
        description: 'What information to extract from the page',
      },
    },
    required: ['url'],
  },

  async execute(input) {
    const url = input.url as string;
    const MAX_CONTENT_LENGTH = 50000;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Femtoclaw/0.1; +https://github.com/femtoclaw)',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          type: 'error',
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text') && !contentType.includes('json')) {
        return {
          type: 'text',
          text: `Fetched ${url} (${contentType}). Binary content cannot be displayed.`,
        };
      }

      let text = await response.text();
      if (text.length > MAX_CONTENT_LENGTH) {
        text = text.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated]';
      }

      // Simple HTML tag stripping for readability
      if (contentType.includes('html')) {
        text = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }

      return {
        type: 'text',
        text: `Content from ${url}:\n\n${text}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'error',
        error: `Failed to fetch ${url}: ${message}`,
      };
    }
  },
};
