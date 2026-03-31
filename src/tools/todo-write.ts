import type { ToolDefinition } from '../types.js';

interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// In-memory per-conversation todo lists
const todoLists = new Map<string, TodoItem[]>();

export const TodoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  description:
    'Manage a task list for the current conversation. Useful for tracking multi-step tasks.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'update', 'list', 'clear'],
        description: 'Operation: add, update, list, or clear',
      },
      text: {
        type: 'string',
        description: 'Task text (for add)',
      },
      id: {
        type: 'string',
        description: 'Task ID (for update)',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'New status (for update)',
      },
    },
    required: ['action'],
  },

  async execute(input, context) {
    const { conversationId } = context;
    const action = input.action as string;

    if (!todoLists.has(conversationId)) {
      todoLists.set(conversationId, []);
    }
    const todos = todoLists.get(conversationId)!;

    switch (action) {
      case 'add': {
        if (!input.text) return { type: 'error', error: 'add requires text' };
        const id = `todo-${Date.now()}`;
        todos.push({ id, text: input.text as string, status: 'pending' });
        return { type: 'text', text: `Added task ${id}: ${input.text}` };
      }

      case 'update': {
        if (!input.id || !input.status) {
          return { type: 'error', error: 'update requires id and status' };
        }
        const todo = todos.find((t) => t.id === input.id);
        if (!todo) return { type: 'error', error: `Task ${input.id} not found` };
        todo.status = input.status as TodoItem['status'];
        return { type: 'text', text: `Updated ${input.id} to ${input.status}` };
      }

      case 'list': {
        if (todos.length === 0) return { type: 'text', text: 'No tasks.' };
        const lines = todos.map(
          (t) => `- [${t.status}] ${t.id}: ${t.text}`,
        );
        return { type: 'text', text: lines.join('\n') };
      }

      case 'clear': {
        todoLists.delete(conversationId);
        return { type: 'text', text: 'Task list cleared.' };
      }

      default:
        return { type: 'error', error: `Unknown action: ${action}` };
    }
  },
};
