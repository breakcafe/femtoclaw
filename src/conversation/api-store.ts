import type { ConversationStore } from './store.js';
import type { Conversation, ConversationMessage } from '../types.js';

export class ApiConversationStore implements ConversationStore {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!resp.ok) {
      throw new Error(`ConversationStore API error: ${resp.status} ${await resp.text()}`);
    }
    return resp.json() as Promise<T>;
  }

  async createConversation(userId: string, conversationId?: string): Promise<Conversation> {
    return this.request<Conversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ userId, conversationId }),
    });
  }

  async getConversation(conversationId: string, userId: string): Promise<Conversation | null> {
    try {
      return await this.request<Conversation>(`/conversations/${conversationId}?userId=${userId}`);
    } catch {
      return null;
    }
  }

  async listConversations(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    const params = new URLSearchParams({ userId });
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    return this.request<Conversation[]>(`/conversations?${params}`);
  }

  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    await this.request(`/conversations/${conversationId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async updateConversation(
    conversationId: string,
    updates: { status?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async appendMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<string[]> {
    const result = await this.request<{ ids: string[] }>(
      `/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ messages }),
      },
    );
    return result.ids;
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; afterId?: string },
  ): Promise<ConversationMessage[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.afterId) params.set('afterId', options.afterId);
    return this.request<ConversationMessage[]>(
      `/conversations/${conversationId}/messages?${params}`,
    );
  }

  async replaceMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/messages`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    });
  }
}
