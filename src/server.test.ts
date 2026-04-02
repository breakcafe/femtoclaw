import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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
import { AgentEngine } from './agent/engine.js';
import { NoopTraceSink } from './trace/sink.js';

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
      traceSink: new NoopTraceSink(),
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health should include engine, version, runtime, and model', async () => {
    const res = await request(app).get('/health');
    expect(res.body.engine).toBe('femtoclaw');
    expect(res.body.version).toBeDefined();
    expect(res.body.runtime).toMatch(/^(node|bun)$/);
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
    const res = await request(app).post('/chat').send({});
    expect(res.status).toBe(400);
  });

  it('POST /chat should return 202 awaiting_input when AskUserQuestion pauses a non-streaming turn', async () => {
    vi.spyOn(AgentEngine.prototype, 'run').mockResolvedValue({
      content: '',
      usage: { input_tokens: 12, output_tokens: 4 },
      stop_reason: 'awaiting_input',
      model: 'claude-sonnet-4-20250514',
      newMessages: [
        { role: 'user', content: JSON.stringify([{ type: 'text', text: '帮我做个报告' }]) },
        {
          role: 'assistant',
          content: JSON.stringify([
            {
              type: 'tool_use',
              id: 'toolu_ask',
              name: 'AskUserQuestion',
              input: { questions: [] },
            },
          ]),
        },
      ],
      awaiting_input: {
        type: 'ask_user_question',
        tool_use_id: 'toolu_ask',
        questions: [
          {
            question: '你希望包含哪些部分？',
            header: '报告范围',
            options: [
              { label: '消费', description: '消费汇总' },
              { label: '预算', description: '预算对比' },
            ],
          },
        ],
        timeout_ms: 300000,
      },
    } as any);

    const res = await request(app).post('/chat').send({
      message: '帮我做个报告',
      stream: false,
    });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('awaiting_input');
    expect(res.body.input_required.tool_use_id).toBe('toolu_ask');
  });

  it('POST /chat should resume a paused AskUserQuestion conversation on input_response', async () => {
    const runSpy = vi.spyOn(AgentEngine.prototype, 'run');

    runSpy.mockResolvedValueOnce({
      content: '',
      usage: { input_tokens: 10, output_tokens: 3 },
      stop_reason: 'awaiting_input',
      model: 'claude-sonnet-4-20250514',
      newMessages: [
        { role: 'user', content: JSON.stringify([{ type: 'text', text: '帮我做个报告' }]) },
        {
          role: 'assistant',
          content: JSON.stringify([
            {
              type: 'tool_use',
              id: 'toolu_resume',
              name: 'AskUserQuestion',
              input: { questions: [] },
            },
          ]),
        },
      ],
      awaiting_input: {
        type: 'ask_user_question',
        tool_use_id: 'toolu_resume',
        questions: [
          {
            question: '你希望包含哪些部分？',
            header: '报告范围',
            options: [
              { label: '消费', description: '消费汇总' },
              { label: '预算', description: '预算对比' },
            ],
          },
        ],
        timeout_ms: 300000,
      },
    } as any);

    runSpy.mockResolvedValueOnce({
      content: '已根据你的选择继续执行。',
      usage: { input_tokens: 15, output_tokens: 9 },
      stop_reason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      newMessages: [
        {
          role: 'user',
          content: JSON.stringify([
            {
              type: 'tool_result',
              tool_use_id: 'toolu_resume',
              content: 'User answered:\n"你希望包含哪些部分？" = "消费, 预算"',
            },
          ]),
        },
        {
          role: 'assistant',
          content: JSON.stringify([{ type: 'text', text: '已根据你的选择继续执行。' }]),
        },
      ],
    } as any);

    const first = await request(app).post('/chat').send({
      message: '帮我做个报告',
      stream: false,
    });

    expect(first.status).toBe(202);

    const second = await request(app)
      .post('/chat')
      .send({
        conversation_id: first.body.conversation_id,
        stream: false,
        input_response: {
          tool_use_id: 'toolu_resume',
          answers: {
            '你希望包含哪些部分？': '消费, 预算',
          },
        },
      });

    expect(second.status).toBe(200);
    expect(second.body.status).toBe('success');
    expect(second.body.content).toBe('已根据你的选择继续执行。');
    expect(runSpy.mock.calls[1]?.[0]).toMatchObject({
      resumeInputResponse: {
        tool_use_id: 'toolu_resume',
        answers: {
          '你希望包含哪些部分？': '消费, 预算',
        },
      },
      pauseOnInput: true,
    });
  });

  it('should include X-Request-ID header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
