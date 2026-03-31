#!/usr/bin/env npx tsx
/**
 * MCP Test Server — standalone Streamable HTTP MCP server for local testing.
 *
 * Provides simple tools to verify femtoclaw's MCP integration without
 * external dependencies. Inspired by picoclaw's built-in MCP server.
 *
 * Usage:
 *   npx tsx examples/mcp-test-server.ts
 *   # → Listening on http://localhost:9100/mcp
 *
 * Then test with femtoclaw:
 *   curl -X POST http://localhost:9000/chat \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "message": "Use the echo tool to say hello",
 *       "mcp_servers": {
 *         "test": { "type": "http", "url": "http://localhost:9100/mcp" }
 *       }
 *     }'
 */
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.MCP_TEST_PORT ?? '9100', 10);
const app = express();
// NOTE: Do NOT use express.json() globally — the MCP transport needs raw body access.
// Only parse JSON for non-MCP routes.
app.use('/health', express.json());

// In-memory data store for the test tools
const notes = new Map<string, { content: string; createdAt: string }>();
const kvStore = new Map<string, string>();

/** Create a fresh MCP server instance (one per transport connection). */
function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'femtoclaw-test-mcp', version: '0.1.0' });

  server.tool(
    'echo',
    'Echo the input text back. Useful for testing MCP connectivity.',
    { text: z.string().describe('Text to echo back') },
    async ({ text }) => ({ content: [{ type: 'text', text: `Echo: ${text}` }] }),
  );

  server.tool(
    'get_time',
    'Get the current server time in ISO 8601 format.',
    {},
    async () => ({ content: [{ type: 'text', text: new Date().toISOString() }] }),
  );

  server.tool(
    'add_note',
    'Save a note. Returns the note ID.',
    { content: z.string().describe('Note content') },
    async ({ content }) => {
      const id = `note-${randomUUID().slice(0, 8)}`;
      notes.set(id, { content, createdAt: new Date().toISOString() });
      return { content: [{ type: 'text', text: `Note saved: ${id}` }] };
    },
  );

  server.tool('list_notes', 'List all saved notes.', {}, async () => {
    if (notes.size === 0) return { content: [{ type: 'text', text: 'No notes saved.' }] };
    const list = Array.from(notes.entries())
      .map(([id, n]) => `- ${id}: ${n.content} (${n.createdAt})`)
      .join('\n');
    return { content: [{ type: 'text', text: list }] };
  });

  server.tool(
    'kv_set',
    'Set a key-value pair in the store.',
    { key: z.string().describe('Key'), value: z.string().describe('Value') },
    async ({ key, value }) => {
      kvStore.set(key, value);
      return { content: [{ type: 'text', text: `Set ${key} = ${value}` }] };
    },
  );

  server.tool(
    'kv_get',
    'Get a value by key from the store.',
    { key: z.string().describe('Key to look up') },
    async ({ key }) => {
      const value = kvStore.get(key);
      return {
        content: [{ type: 'text', text: value ? `${key} = ${value}` : `Key "${key}" not found` }],
      };
    },
  );

  server.tool(
    'calculate',
    'Evaluate a simple math expression (e.g., "2 + 3 * 4").',
    { expression: z.string().describe('Math expression to evaluate') },
    async ({ expression }) => {
      try {
        if (!/^[\d\s+\-*/().]+$/.test(expression)) {
          return {
            content: [{ type: 'text', text: 'Invalid expression: only numbers and operators allowed' }],
            isError: true,
          };
        }
        const result = new Function(`return (${expression})`)();
        return { content: [{ type: 'text', text: `${expression} = ${result}` }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// Transport: Streamable HTTP (stateless — new server + transport per session)
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
    return;
  }

  // New session — create fresh server + transport
  try {
    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `test-${randomUUID()}`,
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);

    // Store for subsequent requests in same session
    const sid = (transport as any)._sessionId ?? (transport as any).sessionId;
    if (sid) sessions.set(sid, { transport, server: mcpServer });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tools: 6, sessions: transports.size });
});

app.listen(PORT, () => {
  console.log(`MCP Test Server listening on http://localhost:${PORT}/mcp`);
  console.log('Tools: echo, get_time, add_note, list_notes, kv_set, kv_get, calculate');
});
