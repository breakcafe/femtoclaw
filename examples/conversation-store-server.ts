#!/usr/bin/env npx tsx
/**
 * Standalone Conversation Store REST API Server.
 *
 * A minimal microservice that provides the ConversationStore REST API,
 * backed by SQLite. Use this when deploying multiple femtoclaw instances
 * that need to share conversation state.
 *
 * Usage:
 *   npx tsx examples/conversation-store-server.ts
 *   # → Listening on http://localhost:9001
 *
 * Then configure femtoclaw:
 *   CONVERSATION_STORE_TYPE=api
 *   CONVERSATION_STORE_URL=http://localhost:9001
 *   CONVERSATION_STORE_API_KEY=your-secret
 */
import express from 'express';
import { SqliteConversationStore } from '../src/conversation/sqlite-store.js';

const PORT = parseInt(process.env.PORT ?? '9001', 10);
const DB_PATH = process.env.DB_PATH ?? './data/conversations.db';
const API_TOKEN = process.env.API_TOKEN ?? '';

const app = express();
app.use(express.json({ limit: '5mb' }));

// Auth middleware
app.use((req, res, next) => {
  if (API_TOKEN) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== API_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }
  next();
});

const store = new SqliteConversationStore(DB_PATH);

// ─── Health ───
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: DB_PATH });
});

// ─── Conversations ───
app.post('/conversations', async (req, res) => {
  try {
    const conv = await store.createConversation(req.body.userId, req.body.conversationId);
    res.json(conv);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/conversations', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).json({ error: 'userId query param required' });
    return;
  }
  const convs = await store.listConversations(userId, {
    limit: Number(req.query.limit ?? 50),
    offset: Number(req.query.offset ?? 0),
  });
  res.json(convs);
});

app.get('/conversations/:id', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).json({ error: 'userId query param required' });
    return;
  }
  const conv = await store.getConversation(req.params.id, userId);
  conv ? res.json(conv) : res.status(404).json({ error: 'Not found' });
});

app.patch('/conversations/:id', async (req, res) => {
  try {
    await store.updateConversation(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/conversations/:id', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).json({ error: 'userId query param required' });
    return;
  }
  try {
    await store.deleteConversation(req.params.id, userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ─── Messages ───
app.get('/conversations/:id/messages', async (req, res) => {
  const messages = await store.getMessages(req.params.id, {
    limit: Number(req.query.limit ?? 100),
    afterId: req.query.afterId as string | undefined,
  });
  res.json(messages);
});

app.post('/conversations/:id/messages', async (req, res) => {
  try {
    const ids = await store.appendMessages(req.params.id, req.body.messages);
    res.json({ ids });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/conversations/:id/messages', async (req, res) => {
  try {
    await store.replaceMessages(req.params.id, req.body.messages);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Conversation Store Server listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
