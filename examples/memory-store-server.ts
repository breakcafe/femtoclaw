#!/usr/bin/env npx tsx
/**
 * Standalone Memory Store REST API Server.
 *
 * A minimal microservice that provides the MemoryService REST API,
 * backed by SQLite. Use this when deploying multiple femtoclaw instances
 * that need to share user memory.
 *
 * Usage:
 *   npx tsx examples/memory-store-server.ts
 *   # → Listening on http://localhost:9002
 *
 * Then configure femtoclaw:
 *   MEMORY_SERVICE_TYPE=api
 *   MEMORY_SERVICE_URL=http://localhost:9002
 *   MEMORY_SERVICE_API_KEY=your-secret
 */
import express from 'express';
import { SqliteMemoryService } from '../src/memory/sqlite-backend.js';

const PORT = parseInt(process.env.PORT ?? '9002', 10);
const DB_PATH = process.env.DB_PATH ?? './data/memory.db';
const API_TOKEN = process.env.API_TOKEN ?? '';

const app = express();
app.use(express.json({ limit: '1mb' }));

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

const service = new SqliteMemoryService(DB_PATH);

// ─── Health ───
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: DB_PATH });
});

// ─── List ───
app.get('/memory/:userId', async (req, res) => {
  try {
    const category = req.query.category as string | undefined;
    const entries = await service.listMemories(req.params.userId, category as any);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Read ───
app.get('/memory/:userId/all', async (req, res) => {
  try {
    const entries = await service.readMemory(req.params.userId);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/memory/:userId/:key', async (req, res) => {
  try {
    const entry = await service.readMemory(req.params.userId, req.params.key);
    res.json(entry);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ─── Write ───
app.put('/memory/:userId/:key', async (req, res) => {
  try {
    await service.writeMemory(req.params.userId, {
      key: req.params.key,
      ...req.body,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Delete ───
app.delete('/memory/:userId/:key', async (req, res) => {
  try {
    await service.deleteMemory(req.params.userId, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ─── Search ───
app.get('/memory/:userId/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    const category = req.query.category as string | undefined;
    if (!query) {
      res.status(400).json({ error: 'q query param required' });
      return;
    }
    const results = await service.searchMemory(req.params.userId, query, category as any);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Memory Store Server listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
