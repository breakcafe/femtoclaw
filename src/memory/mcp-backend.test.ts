import { describe, expect, it, vi } from 'vitest';
import { McpMemoryService } from './mcp-backend.js';

describe('McpMemoryService', () => {
  it('should prefer structuredContent when reading list results', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: [
        {
          key: 'user.preference.language',
          type: 'user',
          description: 'User prefers Chinese',
          updatedAt: '2026-04-01T00:00:00.000Z',
          source: 'agent',
        },
      ],
    });

    const service = new McpMemoryService({ callTool } as any, 'memory');
    const results = await service.listMemories('user-1');

    expect(callTool).toHaveBeenCalledWith('memory', 'list_memories', {
      user_id: 'user-1',
      category: undefined,
    });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('user.preference.language');
  });

  it('should parse JSON text payloads when structured content is absent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            key: 'project.deadline.q2',
            type: 'project',
            description: 'Q2 deadline',
            value: '2026-06-30',
            updatedAt: '2026-04-01T00:00:00.000Z',
            source: 'agent',
          }),
        },
      ],
    });

    const service = new McpMemoryService({ callTool } as any, 'memory');
    const result = await service.readMemory('user-1', 'project.deadline.q2');

    expect(result).toMatchObject({
      key: 'project.deadline.q2',
      value: '2026-06-30',
    });
  });

  it('should surface MCP errors as thrown exceptions', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'permission denied' }],
      isError: true,
    });

    const service = new McpMemoryService({ callTool } as any, 'memory');

    await expect(service.deleteMemory('user-1', 'feedback.no_table')).rejects.toThrow(
      'permission denied',
    );
  });
});
