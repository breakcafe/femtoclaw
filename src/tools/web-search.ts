import type { ToolDefinition } from '../types.js';

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DUCKDUCKGO_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const MAX_RESULTS = 5;

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(text: string): string {
  return decodeHtml(
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  if (!rawUrl) {
    return rawUrl;
  }

  const decoded = decodeHtml(rawUrl);

  try {
    const url = new URL(decoded, 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return decoded;
  }
}

export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const titles = Array.from(
    html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  );
  const snippets = Array.from(
    html.matchAll(
      /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi,
    ),
  );

  return titles.slice(0, MAX_RESULTS).map((match, index) => ({
    title: stripTags(match[2] ?? ''),
    url: normalizeDuckDuckGoUrl(match[1] ?? ''),
    snippet: stripTags(snippets[index]?.[1] ?? ''),
  }));
}

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
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  },

  async execute(input) {
    const query = String(input.query ?? '').trim();
    const requestedMax = Number(input.max_results ?? MAX_RESULTS);
    const maxResults = Number.isFinite(requestedMax)
      ? Math.min(Math.max(Math.trunc(requestedMax), 1), 10)
      : MAX_RESULTS;

    if (!query) {
      return { type: 'error', error: 'query is required' };
    }

    try {
      const params = new URLSearchParams({ q: query, kl: 'wt-wt' });
      const response = await fetch(`${DUCKDUCKGO_SEARCH_URL}?${params.toString()}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Femtoclaw/0.1; +https://github.com/kapiclaw/femtoclaw)',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          type: 'error',
          error: `Search request failed with HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const results = parseDuckDuckGoHtml(html)
        .filter((result) => result.title && result.url)
        .slice(0, maxResults);

      if (results.length === 0) {
        return {
          type: 'text',
          text: `No search results found for "${query}".`,
        };
      }

      const lines = [`Search results for "${query}":`, ''];
      for (const [index, result] of results.entries()) {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`URL: ${result.url}`);
        if (result.snippet) {
          lines.push(`Snippet: ${result.snippet}`);
        }
        lines.push('');
      }

      return {
        type: 'text',
        text: lines.join('\n').trim(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'error',
        error: `WebSearch failed: ${message}`,
      };
    }
  },
};
