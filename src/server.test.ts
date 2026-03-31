import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, type ServerDeps } from './server.js';
import { ConversationManager } from './conversation/manager.js';
import { SqliteConversationStore } from './conversation/sqlite-store.js';
import { ConversationLock } from './conversation/lock.js';
import { SkillManager } from './skills/manager.js';
import { SqliteMemoryService } from './memory/sqlite-backend.js';
import { McpClientPool } from './mcp/client-pool.js';
import { unlinkSync, existsSync } from 'fs';
import type express from 'express';

const TEST_DB = '/tmp/femtoclaw-test-server.db';

describe('Server', () => {
  let app: express.Express;
  let store: SqliteConversationStore;
  let memService: SqliteMemoryService;

  beforeAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new SqliteConversationStore(TEST_DB);
    memService = new SqliteMemoryService(TEST_DB);
    const lock = new ConversationLock();
    const manager = new ConversationManager(store, lock);
    const skillManager = new SkillManager('/nonexistent');
    const mcpPool = new McpClientPool();

    const deps: ServerDeps = {
      conversationManager: manager,
      skillManager,
      memoryService: memService,
      mcpClientPool: mcpPool,
    };

    app = createApp(deps);
  });

  afterAll(() => {
    store.close();
    memService.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health should include version and model', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBeDefined();
    expect(res.body.model).toBeDefined();
  });

  it('GET /chat should return empty conversations list', async () => {
    const res = await request(app).get('/chat');
    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
  });

  it('GET /chat/:id should return 404 for non-existent conversation', async () => {
    const res = await request(app).get('/chat/nonexistent');
    expect(res.status).toBe(404);
  });

  it('DELETE /chat/:id should return 404 for non-existent conversation', async () => {
    const res = await request(app).delete('/chat/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /skills should return skills list', async () => {
    const res = await request(app).get('/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills).toBeDefined();
  });

  it('POST /chat without message should return 400', async () => {
    const res = await request(app)
      .post('/chat')
      .send({});
    expect(res.status).toBe(400);
  });

  it('should include X-Request-ID header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
