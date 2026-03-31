import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const KEEP_RECENT = 6;

export interface CompactableMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Compact conversation messages by summarizing old messages
 * and keeping recent ones intact.
 */
export async function compactMessages(
  messages: CompactableMessage[],
  anthropicClient: Anthropic,
): Promise<CompactableMessage[]> {
  if (messages.length <= KEEP_RECENT + 2) {
    return messages;
  }

  const oldMessages = messages.slice(0, -KEEP_RECENT);
  const recentMessages = messages.slice(-KEEP_RECENT);

  logger.info(
    { totalMessages: messages.length, compacting: oldMessages.length, keeping: recentMessages.length },
    'Compacting conversation history',
  );

  try {
    const summary = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: 'Summarize the following conversation history concisely. Preserve key information, user preferences, decisions made, and pending action items.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(
            oldMessages.map((m) => ({ role: m.role, content: m.content })),
          ),
        },
      ],
    });

    const summaryText =
      summary.content[0].type === 'text' ? summary.content[0].text : '';

    const compacted: CompactableMessage[] = [
      {
        role: 'user',
        content: `[Conversation history summary]\n${summaryText}`,
      },
      {
        role: 'assistant',
        content: 'Understood, I have the context from our previous conversation.',
      },
      ...recentMessages,
    ];

    logger.info(
      { before: messages.length, after: compacted.length },
      'Compaction complete',
    );

    return compacted;
  } catch (err) {
    logger.error({ err }, 'Compaction failed, keeping original messages');
    return messages;
  }
}
