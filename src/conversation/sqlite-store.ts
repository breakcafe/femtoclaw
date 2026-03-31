import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ConversationStore } from './store.js';
import type { Conversation, ConversationMessage } from '../types.js';

export class SqliteConversationStore implements ConversationStore {
  private db: Database.Database;

  constructor(dbPath: string = './data/femtoclaw.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, last_activity DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        sender TEXT,
        sender_name TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv_time ON messages(conversation_id, created_at);
    `);
  }

  async createConversation(userId: string, conversationId?: string): Promise<Conversation> {
    const id = conversationId ?? `conv-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, status, message_count, created_at, last_activity)
         VALUES (?, ?, 'idle', 0, ?, ?)`,
      )
      .run(id, userId, now, now);
    return { id, userId, status: 'idle', messageCount: 0, createdAt: now, lastActivity: now };
  }

  async getConversation(conversationId: string, userId: string): Promise<Conversation | null> {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId) as Record<string, unknown> | undefined;
    return row ? this.mapConversation(row) : null;
  }

  async listConversations(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    const { limit = 50, offset = 0 } = options ?? {};
    const rows = this.db
      .prepare(
        'SELECT * FROM conversations WHERE user_id = ? ORDER BY last_activity DESC LIMIT ? OFFSET ?',
      )
      .all(userId, limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.mapConversation(r));
  }

  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
      .run(conversationId, userId);
    if (result.changes === 0) throw new Error('Conversation not found or access denied');
  }

  async updateConversation(
    conversationId: string,
    updates: { status?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    if (sets.length > 0) {
      sets.push('last_activity = ?');
      params.push(new Date().toISOString());
      params.push(conversationId);
      this.db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
  }

  async appendMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<string[]> {
    const ids: string[] = [];
    const insertMsg = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, sender, sender_name, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateConv = this.db.prepare(`
      UPDATE conversations
      SET message_count = message_count + ?, last_activity = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction(() => {
      for (const msg of messages) {
        const id = `msg-${randomUUID()}`;
        ids.push(id);
        insertMsg.run(
          id,
          conversationId,
          msg.role,
          msg.sender ?? null,
          msg.senderName ?? null,
          msg.content,
          msg.createdAt,
        );
      }
      updateConv.run(messages.length, new Date().toISOString(), conversationId);
    });
    transaction();
    return ids;
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; afterId?: string },
  ): Promise<ConversationMessage[]> {
    let query = 'SELECT * FROM messages WHERE conversation_id = ?';
    const params: unknown[] = [conversationId];

    if (options?.afterId) {
      query += ' AND created_at > (SELECT created_at FROM messages WHERE id = ?)';
      params.push(options.afterId);
    }
    query += ' ORDER BY created_at ASC';
    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  async replaceMessages(
    conversationId: string,
    messages: Omit<ConversationMessage, 'id'>[],
  ): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
      const insert = this.db.prepare(`
        INSERT INTO messages (id, conversation_id, role, sender, sender_name, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const msg of messages) {
        insert.run(
          `msg-${randomUUID()}`,
          conversationId,
          msg.role,
          msg.sender ?? null,
          msg.senderName ?? null,
          msg.content,
          msg.createdAt,
        );
      }
      this.db
        .prepare('UPDATE conversations SET message_count = ?, last_activity = ? WHERE id = ?')
        .run(messages.length, new Date().toISOString(), conversationId);
    });
    transaction();
  }

  close(): void {
    this.db.close();
  }

  private mapConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      status: row.status as 'idle' | 'running',
      messageCount: row.message_count as number,
      createdAt: row.created_at as string,
      lastActivity: row.last_activity as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  private mapMessage(row: Record<string, unknown>): ConversationMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as 'user' | 'assistant',
      sender: row.sender as string | undefined,
      senderName: row.sender_name as string | undefined,
      content: row.content as string,
      createdAt: row.created_at as string,
    };
  }
}
