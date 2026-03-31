import type { ConversationStore } from './store.js';
import { ConversationLock, ConversationBusyError } from './lock.js';
import type { Conversation, ConversationMessage, InputResponse } from '../types.js';
import { config } from '../config.js';

interface PendingInput {
  toolUseId: string;
  resolve: (response: InputResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export { ConversationBusyError };

export class ConversationManager {
  private pendingInputs = new Map<string, PendingInput>();

  constructor(
    private store: ConversationStore,
    private lock: ConversationLock,
  ) {}

  async getOrCreateConversation(userId: string, conversationId?: string): Promise<Conversation> {
    if (conversationId) {
      const existing = await this.store.getConversation(conversationId, userId);
      if (!existing) throw new ConversationNotFoundError(conversationId);
      return existing;
    }
    return this.store.createConversation(userId);
  }

  async acquireLock(conversationId: string): Promise<() => void> {
    return this.lock.acquire(conversationId, { wait: false });
  }

  async setStatus(conversationId: string, status: 'idle' | 'running'): Promise<void> {
    await this.store.updateConversation(conversationId, { status });
  }

  async appendMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<string[]> {
    return this.store.appendMessages(conversationId, messages);
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number },
  ): Promise<ConversationMessage[]> {
    return this.store.getMessages(conversationId, options);
  }

  async replaceMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<void> {
    return this.store.replaceMessages(conversationId, messages);
  }

  async listConversations(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    return this.store.listConversations(userId, options);
  }

  async getConversation(conversationId: string, userId: string): Promise<Conversation | null> {
    return this.store.getConversation(conversationId, userId);
  }

  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    return this.store.deleteConversation(conversationId, userId);
  }

  async updateMetadata(conversationId: string, metadata: Record<string, unknown>): Promise<void> {
    return this.store.updateConversation(conversationId, { metadata });
  }

  // ─── AskUserQuestion Support ───

  async waitForUserInput(conversationId: string, toolUseId: string): Promise<InputResponse> {
    return new Promise<InputResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingInputs.delete(conversationId);
        reject(new Error('User input timeout'));
      }, config.INPUT_TIMEOUT_MS);

      this.pendingInputs.set(conversationId, { toolUseId, resolve, reject, timeoutId });
    });
  }

  submitUserInput(conversationId: string, response: InputResponse): void {
    const pending = this.pendingInputs.get(conversationId);
    if (!pending) throw new Error('No pending input request for this conversation');
    if (pending.toolUseId !== response.tool_use_id) throw new Error('tool_use_id mismatch');

    clearTimeout(pending.timeoutId);
    this.pendingInputs.delete(conversationId);
    pending.resolve(response);
  }

  hasPendingInput(conversationId: string): boolean {
    return this.pendingInputs.has(conversationId);
  }
}

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} not found`);
    this.name = 'ConversationNotFoundError';
  }
}
