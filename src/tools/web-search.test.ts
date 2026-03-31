import { describe, expect, it } from 'vitest';
import { parseDuckDuckGoHtml } from './web-search.js';

describe('WebSearchTool', () => {
  it('should parse DuckDuckGo HTML results into structured entries', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">
          Example &amp; Guide
        </a>
        <div class="result__snippet">A concise &quot;snippet&quot; for the result.</div>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.org/second">Second Result</a>
        <a class="result__snippet">Another snippet.</a>
      </div>
    `;

    const results = parseDuckDuckGoHtml(html);

    expect(results).toEqual([
      {
        title: 'Example & Guide',
        url: 'https://example.com/doc',
        snippet: 'A concise "snippet" for the result.',
      },
      {
        title: 'Second Result',
        url: 'https://example.org/second',
        snippet: 'Another snippet.',
      },
    ]);
  });
});
