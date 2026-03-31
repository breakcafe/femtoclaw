import type { MemoryServiceInterface, MemoryEntry, MemoryEntrySummary, MemoryType, WriteMemoryInput } from '../types.js';

export class ApiMemoryService implements MemoryServiceInterface {
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
    if (!resp.ok) throw new Error(`Memory API error: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  async listMemories(userId: string, category?: MemoryType): Promise<MemoryEntrySummary[]> {
    const params = category ? `?category=${category}` : '';
    return this.request<MemoryEntrySummary[]>(`/memory/${userId}${params}`);
  }

  async readMemory(userId: string, key?: string): Promise<MemoryEntry | MemoryEntry[]> {
    return this.request<MemoryEntry | MemoryEntry[]>(
      `/memory/${userId}${key ? `/${encodeURIComponent(key)}` : '/all'}`,
    );
  }

  async writeMemory(userId: string, input: WriteMemoryInput): Promise<void> {
    await this.request(`/memory/${userId}/${encodeURIComponent(input.key)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, source: 'agent' }),
    });
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    await this.request(`/memory/${userId}/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  async searchMemory(
    userId: string,
    query: string,
    category?: MemoryType,
  ): Promise<MemoryEntrySummary[]> {
    const params = new URLSearchParams({ q: query });
    if (category) params.set('category', category);
    return this.request<MemoryEntrySummary[]>(`/memory/${userId}/search?${params}`);
  }
}
