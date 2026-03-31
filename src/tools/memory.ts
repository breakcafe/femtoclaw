import type { ToolDefinition } from '../types.js';

export const MemoryTool: ToolDefinition = {
  name: 'Memory',
  description: `Manage user's persistent memory. Memory persists across sessions.

Available actions:
- "list": List memory entries (key + summary, no full value). Optional category filter.
- "read": Read full content of a specific key.
- "write": Write or update a memory entry. Requires key, value, type, description.
- "delete": Delete a memory entry by key.
- "search": Search memories by keyword. Optional category filter.

Memory types (type field, required for write):
- user: User role, preferences, background
- feedback: User corrections or confirmations of assistant behavior
- project: Non-code project information
- reference: Pointers to external resources`,

  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'write', 'delete', 'search'],
        description: 'Operation type',
      },
      key: {
        type: 'string',
        description: 'Memory entry key. Format: type.topic (e.g., user.role, feedback.no_emoji)',
      },
      value: {
        type: 'string',
        description: 'Memory content (required for write)',
      },
      type: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description: 'Memory type (required for write)',
      },
      description: {
        type: 'string',
        description: 'One-line summary for relevance matching (required for write)',
      },
      query: {
        type: 'string',
        description: 'Search keywords (required for search)',
      },
      category: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description: 'Filter by memory type (optional for list/search)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Free tags (optional for write)',
      },
    },
    required: ['action'],
  },

  async execute(input, context) {
    const { userId, memoryService: ms } = context;
    const action = input.action as string;

    try {
      switch (action) {
        case 'list': {
          const entries = await ms.listMemories(userId, input.category as any);
          if (entries.length === 0) return { type: 'text', text: 'No memories found.' };
          const lines = entries.map(
            (e) => `- [${e.type}] ${e.key}: ${e.description} (${e.updatedAt})`,
          );
          return { type: 'text', text: lines.join('\n') };
        }

        case 'read': {
          if (!input.key) return { type: 'error', error: 'read requires key parameter' };
          const entry = await ms.readMemory(userId, input.key as string);
          if (Array.isArray(entry)) {
            return { type: 'text', text: JSON.stringify(entry, null, 2) };
          }
          return { type: 'text', text: `[${entry.type}] ${entry.key}\n${entry.value}` };
        }

        case 'write': {
          if (!input.key || !input.value || !input.type || !input.description) {
            return { type: 'error', error: 'write requires key, value, type, and description' };
          }
          await ms.writeMemory(userId, {
            key: input.key as string,
            value: input.value as string,
            type: input.type as any,
            description: input.description as string,
            tags: input.tags as string[] | undefined,
          });
          return { type: 'text', text: `Memory "${input.key}" saved.` };
        }

        case 'delete': {
          if (!input.key) return { type: 'error', error: 'delete requires key parameter' };
          await ms.deleteMemory(userId, input.key as string);
          return { type: 'text', text: `Memory "${input.key}" deleted.` };
        }

        case 'search': {
          if (!input.query) return { type: 'error', error: 'search requires query parameter' };
          const results = await ms.searchMemory(
            userId,
            input.query as string,
            input.category as any,
          );
          if (results.length === 0) return { type: 'text', text: 'No matching memories found.' };
          const lines = results.map(
            (e) => `- [${e.type}] ${e.key}: ${e.description}`,
          );
          return { type: 'text', text: lines.join('\n') };
        }

        default:
          return { type: 'error', error: `Unknown action: ${action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: 'error', error: message };
    }
  },
};
