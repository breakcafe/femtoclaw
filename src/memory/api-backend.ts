import type {
  MemoryServiceInterface,
  MemoryEntry,
  MemoryEntrySummary,
  MemoryType,
  WriteMemoryInput,
} from '../types.js';

export class ApiMemoryService implements MemoryServiceInterface {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private buildHeaders(extra?: RequestInit['headers']): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey?.trim()) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (!extra) {
      return headers;
    }
    return { ...headers, ...(extra as Record<string, string>) };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: this.buildHeaders(options?.headers),
    });
    if (!resp.ok) throw new Error(`Memory API error: ${resp.status}`);
    if (resp.status === 204) {
      return undefined as T;
    }
    const text = await resp.text();
    if (!text.trim()) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  async listMemories(userId: string, category?: MemoryType): Promise<MemoryEntrySummary[]> {
    const params = category ? `?category=${category}` : '';
    return this.request<MemoryEntrySummary[]>(`/memory/${encodeURIComponent(userId)}${params}`);
  }

  async readMemory(userId: string, key?: string): Promise<MemoryEntry | MemoryEntry[]> {
    return this.request<MemoryEntry | MemoryEntry[]>(
      `/memory/${encodeURIComponent(userId)}${key ? `/${encodeURIComponent(key)}` : '/all'}`,
    );
  }

  async writeMemory(userId: string, input: WriteMemoryInput): Promise<void> {
    await this.request(`/memory/${encodeURIComponent(userId)}/${encodeURIComponent(input.key)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, source: 'agent' }),
    });
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    await this.request(`/memory/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  async searchMemory(
    userId: string,
    query: string,
    category?: MemoryType,
  ): Promise<MemoryEntrySummary[]> {
    const params = new URLSearchParams({ q: query });
    if (category) params.set('category', category);
    return this.request<MemoryEntrySummary[]>(
      `/memory/${encodeURIComponent(userId)}/search?${params}`,
    );
  }
}
