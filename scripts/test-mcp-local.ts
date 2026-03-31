#!/usr/bin/env npx tsx
/**
 * Test the local MCP test server via femtoclaw's MCP client pool.
 * Start examples/mcp-test-server.ts first.
 */
import { McpClientPool } from '../src/mcp/client-pool.js';

async function main() {
  const pool = new McpClientPool();

  console.log('=== Connecting to local MCP test server ===');
  const { tools } = await pool.getAnthropicTools({
    test: { type: 'http', url: 'http://localhost:9100/mcp' },
  });
  console.log(`Tools found: ${tools.length}`);
  for (const t of tools) console.log(`  - ${t.name}: ${t.description.slice(0, 60)}`);

  console.log('\n=== Tool Calls ===');
  const r1 = await pool.callTool('test', 'echo', { text: 'Hello from femtoclaw!' });
  console.log(`echo: ${r1.content[0].text}`);

  const r2 = await pool.callTool('test', 'get_time', {});
  console.log(`get_time: ${r2.content[0].text}`);

  const r3 = await pool.callTool('test', 'calculate', { expression: '2 + 3 * 4' });
  console.log(`calculate: ${r3.content[0].text}`);

  await pool.callTool('test', 'kv_set', { key: 'greeting', value: 'hello world' });
  const r4 = await pool.callTool('test', 'kv_get', { key: 'greeting' });
  console.log(`kv_get: ${r4.content[0].text}`);

  await pool.callTool('test', 'add_note', { content: 'Test note from MCP client' });
  const r5 = await pool.callTool('test', 'list_notes', {});
  console.log(`list_notes: ${r5.content[0].text}`);

  console.log('\nAll tests passed!');
  await pool.shutdown();
}

main().catch(console.error);
