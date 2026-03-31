import type {
  MemoryEntry,
  MemoryEntrySummary,
  MemoryServiceInterface,
  MemoryType,
  WriteMemoryInput,
} from '../types.js';
import type { McpClientPool } from '../mcp/client-pool.js';
import type { McpCallToolResult } from '../mcp/types.js';

function readToolPayload(result: McpCallToolResult): unknown {
  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ensureSuccess(result: McpCallToolResult, fallbackMessage: string): unknown {
  if (result.isError) {
    const payload = readToolPayload(result);
    if (typeof payload === 'string' && payload) {
      throw new Error(payload);
    }
    throw new Error(fallbackMessage);
  }

  return readToolPayload(result);
}

export class McpMemoryService implements MemoryServiceInterface {
  constructor(
    private mcpClientPool: McpClientPool,
    private serverName: string,
  ) {}

  async listMemories(userId: string, category?: MemoryType): Promise<MemoryEntrySummary[]> {
    const result = await this.mcpClientPool.callTool(this.serverName, 'list_memories', {
      user_id: userId,
      category,
    });
    const payload = ensureSuccess(result, 'MCP memory list_memories failed');
    return Array.isArray(payload) ? (payload as MemoryEntrySummary[]) : [];
  }

  async readMemory(userId: string, key?: string): Promise<MemoryEntry | MemoryEntry[]> {
    const result = await this.mcpClientPool.callTool(this.serverName, 'read_memory', {
      user_id: userId,
      key,
    });
    const payload = ensureSuccess(result, 'MCP memory read_memory failed');
    if (!payload) {
      throw new Error(`Memory entry "${key}" not found`);
    }
    return payload as MemoryEntry | MemoryEntry[];
  }

  async writeMemory(userId: string, input: WriteMemoryInput): Promise<void> {
    const result = await this.mcpClientPool.callTool(this.serverName, 'write_memory', {
      user_id: userId,
      ...input,
      source: 'agent',
    });
    ensureSuccess(result, 'MCP memory write_memory failed');
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    const result = await this.mcpClientPool.callTool(this.serverName, 'delete_memory', {
      user_id: userId,
      key,
    });
    ensureSuccess(result, 'MCP memory delete_memory failed');
  }

  async searchMemory(
    userId: string,
    query: string,
    category?: MemoryType,
  ): Promise<MemoryEntrySummary[]> {
    const result = await this.mcpClientPool.callTool(this.serverName, 'search_memory', {
      user_id: userId,
      query,
      category,
    });
    const payload = ensureSuccess(result, 'MCP memory search_memory failed');
    return Array.isArray(payload) ? (payload as MemoryEntrySummary[]) : [];
  }
}
