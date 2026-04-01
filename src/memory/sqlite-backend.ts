import { createDatabase, type Database } from '../utils/sqlite-compat.js';
import type {
  MemoryServiceInterface,
  MemoryEntry,
  MemoryEntrySummary,
  MemoryType,
  WriteMemoryInput,
} from '../types.js';
import { config } from '../config.js';

export class SqliteMemoryService implements MemoryServiceInterface {
  private db: Database;

  constructor(dbPath: string) {
    this.db = createDatabase(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        value TEXT NOT NULL,
        tags TEXT,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'agent',
        PRIMARY KEY (user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_mem_user_type ON memories(user_id, type);
    `);
  }

  async listMemories(userId: string, category?: MemoryType): Promise<MemoryEntrySummary[]> {
    let query =
      'SELECT key, type, description, tags, updated_at, source FROM memories WHERE user_id = ?';
    const params: unknown[] = [userId];
    if (category) {
      query += ' AND type = ?';
      params.push(category);
    }
    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(config.MAX_MEMORY_INDEX_IN_PROMPT);

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      key: r.key as string,
      type: r.type as MemoryType,
      description: r.description as string,
      tags: r.tags ? JSON.parse(r.tags as string) : undefined,
      updatedAt: r.updated_at as string,
      source: r.source as 'agent' | 'user',
    }));
  }

  async readMemory(userId: string, key?: string): Promise<MemoryEntry | MemoryEntry[]> {
    if (key) {
      const row = this.db
        .prepare('SELECT * FROM memories WHERE user_id = ? AND key = ?')
        .get(userId, key) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Memory entry "${key}" not found`);
      return this.mapEntry(row);
    }
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapEntry(r));
  }

  async writeMemory(userId: string, input: WriteMemoryInput): Promise<void> {
    const value = input.value.slice(0, config.MAX_MEMORY_VALUE_LENGTH);
    const now = new Date().toISOString();

    // Check entry limit
    const count = this.db
      .prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?')
      .get(userId) as { cnt: number };
    const existing = this.db
      .prepare('SELECT key FROM memories WHERE user_id = ? AND key = ?')
      .get(userId, input.key);

    if (!existing && count.cnt >= config.MAX_MEMORY_ENTRIES_PER_USER) {
      throw new Error(
        `Memory limit reached (${config.MAX_MEMORY_ENTRIES_PER_USER}). Delete old entries first.`,
      );
    }

    this.db
      .prepare(
        `INSERT INTO memories (user_id, key, type, description, value, tags, updated_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'agent')
         ON CONFLICT(user_id, key) DO UPDATE SET
           type = excluded.type,
           description = excluded.description,
           value = excluded.value,
           tags = excluded.tags,
           updated_at = excluded.updated_at,
           source = excluded.source`,
      )
      .run(
        userId,
        input.key,
        input.type,
        input.description,
        value,
        input.tags ? JSON.stringify(input.tags) : null,
        now,
      );
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM memories WHERE user_id = ? AND key = ?')
      .run(userId, key);
    if (result.changes === 0) throw new Error(`Memory entry "${key}" not found`);
  }

  async searchMemory(
    userId: string,
    query: string,
    category?: MemoryType,
  ): Promise<MemoryEntrySummary[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (terms.length === 0) return [];

    let sql =
      'SELECT key, type, description, tags, updated_at, source FROM memories WHERE user_id = ?';
    const params: unknown[] = [userId];

    if (category) {
      sql += ' AND type = ?';
      params.push(category);
    }

    // Simple LIKE-based search across key, description, value
    const conditions = terms.map(() => "(LOWER(key || ' ' || description || ' ' || value) LIKE ?)");
    sql += ` AND (${conditions.join(' AND ')})`;
    for (const term of terms) {
      params.push(`%${term}%`);
    }

    sql += ' ORDER BY updated_at DESC LIMIT 20';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      key: r.key as string,
      type: r.type as MemoryType,
      description: r.description as string,
      tags: r.tags ? JSON.parse(r.tags as string) : undefined,
      updatedAt: r.updated_at as string,
      source: r.source as 'agent' | 'user',
    }));
  }

  close(): void {
    this.db.close();
  }

  private mapEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      key: row.key as string,
      type: row.type as MemoryType,
      description: row.description as string,
      value: row.value as string,
      tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      updatedAt: row.updated_at as string,
      source: row.source as 'agent' | 'user',
    };
  }
}
