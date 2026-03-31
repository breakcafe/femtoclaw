import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConversationStore } from './sqlite-store.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = '/tmp/femtoclaw-test-conv.db';

describe('SqliteConversationStore', () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new SqliteConversationStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  it('should create and get a conversation', async () => {
    const conv = await store.createConversation('user-1');
    expect(conv.id).toMatch(/^conv-/);
    expect(conv.userId).toBe('user-1');
    expect(conv.status).toBe('idle');

    const fetched = await store.getConversation(conv.id, 'user-1');
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(conv.id);
  });

  it('should enforce user isolation on get', async () => {
    const conv = await store.createConversation('user-1');
    const fetched = await store.getConversation(conv.id, 'user-2');
    expect(fetched).toBeNull();
  });

  it('should list conversations for a user', async () => {
    await store.createConversation('user-1');
    await store.createConversation('user-1');
    await store.createConversation('user-2');

    const list = await store.listConversations('user-1');
    expect(list.length).toBe(2);
  });

  it('should append and get messages', async () => {
    const conv = await store.createConversation('user-1');
    const ids = await store.appendMessages(conv.id, [
      {
        conversationId: conv.id,
        role: 'user',
        content: 'Hello',
        createdAt: new Date().toISOString(),
      },
      {
        conversationId: conv.id,
        role: 'assistant',
        content: 'Hi there',
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(ids.length).toBe(2);

    const messages = await store.getMessages(conv.id);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi there');

    // Message count should be updated
    const updated = await store.getConversation(conv.id, 'user-1');
    expect(updated!.messageCount).toBe(2);
  });

  it('should delete conversation and cascade messages', async () => {
    const conv = await store.createConversation('user-1');
    await store.appendMessages(conv.id, [
      {
        conversationId: conv.id,
        role: 'user',
        content: 'Test',
        createdAt: new Date().toISOString(),
      },
    ]);

    await store.deleteConversation(conv.id, 'user-1');

    const fetched = await store.getConversation(conv.id, 'user-1');
    expect(fetched).toBeNull();

    const messages = await store.getMessages(conv.id);
    expect(messages.length).toBe(0);
  });

  it('should replace messages', async () => {
    const conv = await store.createConversation('user-1');
    await store.appendMessages(conv.id, [
      {
        conversationId: conv.id,
        role: 'user',
        content: 'Old msg',
        createdAt: new Date().toISOString(),
      },
    ]);

    await store.replaceMessages(conv.id, [
      {
        conversationId: conv.id,
        role: 'user',
        content: 'Summary',
        createdAt: new Date().toISOString(),
      },
      {
        conversationId: conv.id,
        role: 'assistant',
        content: 'Acknowledged',
        createdAt: new Date().toISOString(),
      },
    ]);

    const messages = await store.getMessages(conv.id);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('Summary');
  });
});
