import type { Conversation, ConversationMessage } from '../types.js';

export interface ConversationStore {
  createConversation(userId: string, conversationId?: string): Promise<Conversation>;
  getConversation(conversationId: string, userId: string): Promise<Conversation | null>;
  listConversations(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]>;
  deleteConversation(conversationId: string, userId: string): Promise<void>;
  updateConversation(
    conversationId: string,
    updates: {
      status?: 'idle' | 'running';
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  appendMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<string[]>;
  getMessages(
    conversationId: string,
    options?: { limit?: number; afterId?: string },
  ): Promise<ConversationMessage[]>;
  replaceMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<void>;
  close?(): void;
}
