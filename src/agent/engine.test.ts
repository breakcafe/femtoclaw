import { describe, it, expect } from 'vitest';
import type { ApiMessage, ContentBlock } from './engine.js';

/**
 * Tests that verify the message format used in the agent engine
 * matches Anthropic Messages API requirements for multi-turn tool calling.
 */
describe('Agent Engine message format', () => {
  it('should serialize user message with preamble as ContentBlock[]', () => {
    const userContent: ContentBlock[] = [
      { type: 'text', text: '<system-reminder>\nskills list\n</system-reminder>' },
      { type: 'text', text: '<system-reminder>\nmemory\n</system-reminder>' },
      { type: 'text', text: '帮我查一下支出' },
    ];

    const serialized = JSON.stringify(userContent);
    const restored: ContentBlock[] = JSON.parse(serialized);

    expect(restored).toHaveLength(3);
    expect(restored[0].type).toBe('text');
    expect(restored[2]).toEqual({ type: 'text', text: '帮我查一下支出' });
  });

  it('should serialize assistant message with text + tool_use blocks', () => {
    const assistantContent: ContentBlock[] = [
      { type: 'text', text: '让我帮你查询一下最近的支出情况。' },
      {
        type: 'tool_use',
        id: 'toolu_01ABC',
        name: 'mcp__kapii__query_expenses',
        input: { user_id: 'USER1', start_date: '2026-03-24', end_date: '2026-03-31' },
      },
    ];

    const serialized = JSON.stringify(assistantContent);
    const restored: ContentBlock[] = JSON.parse(serialized);

    expect(restored).toHaveLength(2);
    expect(restored[0].type).toBe('text');
    expect(restored[1].type).toBe('tool_use');
    if (restored[1].type === 'tool_use') {
      expect(restored[1].id).toBe('toolu_01ABC');
      expect(restored[1].name).toBe('mcp__kapii__query_expenses');
      expect(restored[1].input).toEqual({
        user_id: 'USER1',
        start_date: '2026-03-24',
        end_date: '2026-03-31',
      });
    }
  });

  it('should serialize tool_result message', () => {
    const toolResultContent: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01ABC',
        content: '{"expenses":[{"amount":50,"category":"餐饮"}]}',
      },
    ];

    const serialized = JSON.stringify(toolResultContent);
    const restored: ContentBlock[] = JSON.parse(serialized);

    expect(restored).toHaveLength(1);
    expect(restored[0].type).toBe('tool_result');
    if (restored[0].type === 'tool_result') {
      expect(restored[0].tool_use_id).toBe('toolu_01ABC');
      expect(restored[0].content).toContain('餐饮');
    }
  });

  it('should preserve full multi-turn tool conversation for restoration', () => {
    // Simulate a complete tool-calling conversation
    const conversation: ApiMessage[] = [
      // Turn 1: User asks
      {
        role: 'user',
        content: [{ type: 'text', text: '帮我查一下支出' }],
      },
      // Turn 2: Assistant calls tool
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '好的，让我查询一下。' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'mcp__kapii__query_expenses',
            input: { user_id: 'U1' },
          },
        ],
      },
      // Turn 3: Tool result
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: '{"expenses":[{"amount":100}]}',
          },
        ],
      },
      // Turn 4: Assistant final answer
      {
        role: 'assistant',
        content: [{ type: 'text', text: '你最近支出了100元。' }],
      },
    ];

    // Serialize each message (as we do in storage)
    const stored = conversation.map((m) => ({
      role: m.role,
      content: JSON.stringify(m.content),
    }));

    // Restore (as we do in engine.run)
    const restored: ApiMessage[] = stored.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: JSON.parse(m.content),
    }));

    expect(restored).toHaveLength(4);
    expect(restored[0].content[0].type).toBe('text');
    expect(restored[1].content[1].type).toBe('tool_use');
    expect(restored[2].content[0].type).toBe('tool_result');
    expect(restored[3].content[0].type).toBe('text');

    // Verify tool_use.id matches tool_result.tool_use_id
    const toolUse = restored[1].content[1];
    const toolResult = restored[2].content[0];
    if (toolUse.type === 'tool_use' && toolResult.type === 'tool_result') {
      expect(toolResult.tool_use_id).toBe(toolUse.id);
    }
  });

  it('should handle legacy plain-text content gracefully', () => {
    // Old messages stored as plain text (before this fix)
    const legacy = { role: 'user' as const, content: '你好' };

    let parsed: ContentBlock[];
    try {
      parsed = JSON.parse(legacy.content);
    } catch {
      parsed = [{ type: 'text', text: legacy.content }];
    }

    expect(parsed).toEqual([{ type: 'text', text: '你好' }]);
  });
});
