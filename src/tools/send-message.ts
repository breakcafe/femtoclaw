import type { ToolDefinition } from '../types.js';

export const SendMessageTool: ToolDefinition = {
  name: 'SendMessage',
  description:
    'Send an intermediate status message to the user during long-running operations (e.g., "Searching for information...").',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Message text to send to the user',
      },
    },
    required: ['text'],
  },

  async execute(input, context) {
    const text = input.text as string;
    context.onStreamEvent({
      type: 'text_delta',
      data: { text: `\n${text}\n` },
    });
    return { type: 'text', text: 'Message sent.' };
  },
};
