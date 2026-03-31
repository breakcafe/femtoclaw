import type { ToolDefinition } from '../types.js';

export const AskUserQuestionTool: ToolDefinition = {
  name: 'AskUserQuestion',
  description: `Ask the user structured questions and wait for answers. Use when:
- The user's intent is ambiguous and needs clarification
- The user needs to choose between multiple options
- You need to collect parameters or preferences for a task
- Confirmation is needed before an important operation

Each call can ask 1-4 questions. Each question has 2-4 options. The user can also type a free-form answer.`,

  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Questions to ask (1-4)',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question text, clear and specific',
            },
            header: {
              type: 'string',
              description: 'Short label (max 12 chars)',
            },
            options: {
              type: 'array',
              description: 'Available choices (2-4)',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Option text (1-5 words)' },
                  description: { type: 'string', description: 'Option explanation' },
                },
                required: ['label', 'description'],
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Allow multiple selections (default: false)',
            },
          },
          required: ['question', 'header', 'options'],
        },
      },
    },
    required: ['questions'],
  },

  requiresUserInteraction: true,

  async execute(_input, _context) {
    // This tool is handled by the Agent Engine's interaction layer.
    // It should never reach this execute function directly.
    throw new Error('AskUserQuestion should be handled by the interaction layer');
  },
};
