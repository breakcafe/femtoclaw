#!/usr/bin/env npx tsx
/**
 * MCP Integration Test Suite
 *
 * Tests MCP client pool connectivity, tool discovery, and tool invocation
 * against real MCP servers. Measures timing for all operations.
 *
 * Usage: npx tsx scripts/test-mcp.ts
 */
import { McpClientPool } from '../src/mcp/client-pool.js';
import { parseMcpToolName } from '../src/mcp/tool-mapper.js';
import type { McpServerConfig } from '../src/types.js';

// ─── Config ───

const SERVERS: Record<string, McpServerConfig> = {
  'ms-learn': {
    type: 'http',
    url: 'https://learn.microsoft.com/api/mcp',
  },
};

// ─── Helpers ───

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  durationMs: number;
  detail?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`${CYAN}▸${NC} ${msg}`);
}
function ok(name: string, ms: number, detail?: string) {
  console.log(`  ${GREEN}✓${NC} ${name} ${DIM}[${ms}ms]${NC}${detail ? ` — ${detail}` : ''}`);
  results.push({ name, status: 'PASS', durationMs: ms, detail });
}
function fail(name: string, ms: number, detail?: string) {
  console.log(`  ${RED}✗${NC} ${name} ${DIM}[${ms}ms]${NC}${detail ? ` — ${detail}` : ''}`);
  results.push({ name, status: 'FAIL', durationMs: ms, detail });
}
function skip(name: string, detail?: string) {
  console.log(`  ${YELLOW}⊘${NC} ${name}${detail ? ` — ${detail}` : ''}`);
  results.push({ name, status: 'SKIP', durationMs: 0, detail });
}

function timer() {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

// ─── Tests ───

async function testParseMcpToolName() {
  console.log(`\n${CYAN}═══ 1. parseMcpToolName Unit Tests ═══${NC}`);
  const t = timer();

  const cases = [
    { input: 'mcp__server__tool', expected: { server: 'server', tool: 'tool' } },
    { input: 'mcp__ms-learn__microsoft_docs_search', expected: { server: 'ms-learn', tool: 'microsoft_docs_search' } },
    { input: 'mcp__finance__query_expenses', expected: { server: 'finance', tool: 'query_expenses' } },
    { input: 'notmcp__server__tool', expected: null },
    { input: 'mcp__', expected: null },
    { input: 'WebSearch', expected: null },
  ];

  for (const c of cases) {
    const result = parseMcpToolName(c.input);
    const match = JSON.stringify(result) === JSON.stringify(c.expected);
    if (match) {
      ok(`parse "${c.input}"`, 0, JSON.stringify(result));
    } else {
      fail(`parse "${c.input}"`, 0, `expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(result)}`);
    }
  }
  log(`parseMcpToolName tests: ${t()}ms`);
}

async function testMcpConnection() {
  console.log(`\n${CYAN}═══ 2. MCP Server Connection ═══${NC}`);

  for (const [name, cfg] of Object.entries(SERVERS)) {
    const t = timer();
    const pool = new McpClientPool();

    try {
      // Test: Connect and discover tools
      const { tools, warnings } = await pool.getAnthropicTools({ [name]: cfg });
      const ms = t();

      if (tools.length > 0) {
        ok(`Connect + discover "${name}"`, ms, `${tools.length} tools found`);
        for (const tool of tools) {
          log(`  Tool: ${tool.name} — ${tool.description.slice(0, 80)}...`);
        }
      } else {
        fail(`Connect + discover "${name}"`, ms, 'No tools discovered');
      }

      if (warnings.length > 0) {
        log(`  Warnings: ${warnings.join(', ')}`);
      }
    } catch (err) {
      const ms = t();
      fail(`Connect "${name}"`, ms, (err as Error).message);
    } finally {
      await pool.shutdown();
    }
  }
}

async function testMcpToolInvocation() {
  console.log(`\n${CYAN}═══ 3. MCP Tool Invocation ═══${NC}`);

  const pool = new McpClientPool();
  try {
    // Connect to MS Learn
    const { tools } = await pool.getAnthropicTools({ 'ms-learn': SERVERS['ms-learn'] });

    if (tools.length === 0) {
      skip('Tool invocation', 'No tools available (connection failed)');
      return;
    }

    // Test: microsoft_docs_search
    {
      const t = timer();
      const result = await pool.callTool('ms-learn', 'microsoft_docs_search', {
        query: 'Azure Functions getting started',
      });
      const ms = t();
      const text = result.content.map((c) => c.text ?? '').join('');
      if (!result.isError && text.length > 0) {
        ok('callTool microsoft_docs_search', ms, `${text.length} chars returned`);
      } else {
        fail('callTool microsoft_docs_search', ms, result.isError ? text : 'empty response');
      }
    }

    // Test: microsoft_docs_fetch
    {
      const t = timer();
      const result = await pool.callTool('ms-learn', 'microsoft_docs_fetch', {
        url: 'https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview',
      });
      const ms = t();
      const text = result.content.map((c) => c.text ?? '').join('');
      if (!result.isError && text.length > 0) {
        ok('callTool microsoft_docs_fetch', ms, `${text.length} chars returned`);
      } else {
        fail('callTool microsoft_docs_fetch', ms, result.isError ? text.slice(0, 200) : 'empty');
      }
    }

    // Test: calling non-existent tool
    {
      const t = timer();
      const result = await pool.callTool('ms-learn', 'nonexistent_tool', {});
      const ms = t();
      if (result.isError) {
        ok('callTool non-existent (error expected)', ms, 'correctly returned error');
      } else {
        fail('callTool non-existent', ms, 'should have returned error');
      }
    }

    // Test: calling non-existent server
    {
      const t = timer();
      const result = await pool.callTool('no-such-server', 'tool', {});
      const ms = t();
      if (result.isError) {
        ok('callTool non-existent server (error expected)', ms);
      } else {
        fail('callTool non-existent server', ms);
      }
    }
  } finally {
    await pool.shutdown();
  }
}

async function testMcpMerge() {
  console.log(`\n${CYAN}═══ 4. MCP Server Merge Logic ═══${NC}`);

  const pool = new McpClientPool();
  const t = timer();

  // Test reserved name
  const { configs, warnings } = pool.mergeMcpServers(
    { femtoclaw: { type: 'http', url: 'http://evil.com' }, valid: { type: 'http', url: 'http://ok.com' } },
    { femtoclaw: { headers: { 'X-Evil': '1' } } },
  );
  const ms = t();

  if (!configs['femtoclaw'] || configs['femtoclaw'].url !== 'http://evil.com') {
    ok('Reserved name "femtoclaw" blocked', ms);
  } else {
    fail('Reserved name "femtoclaw" not blocked', ms);
  }

  if (configs['valid']) {
    ok('Valid per-request server accepted', 0);
  } else {
    fail('Valid per-request server rejected', 0);
  }

  if (warnings.length >= 2) {
    ok('Warnings generated for reserved name', 0, `${warnings.length} warnings`);
  } else {
    fail('Expected warnings for reserved name', 0, `got ${warnings.length}`);
  }

  await pool.shutdown();
}

async function testConnectionTiming() {
  console.log(`\n${CYAN}═══ 5. Connection Timing Benchmarks ═══${NC}`);

  // Cold connect
  for (const [name, cfg] of Object.entries(SERVERS)) {
    const pool = new McpClientPool();
    const t = timer();
    await pool.getAnthropicTools({ [name]: cfg });
    const cold = t();
    log(`"${name}" cold connect + discover: ${cold}ms`);

    // Warm tool call
    const t2 = timer();
    await pool.callTool(name, 'microsoft_docs_search', { query: 'test' });
    const warm = t2();
    log(`"${name}" warm tool call: ${warm}ms`);

    await pool.shutdown();

    ok(`"${name}" cold connect`, cold, `${cold}ms`);
    ok(`"${name}" warm tool call`, warm, `${warm}ms`);
  }
}

async function testTransientCleanup() {
  console.log(`\n${CYAN}═══ 6. Transient Connection Cleanup ═══${NC}`);

  const pool = new McpClientPool();

  // Connect via per-request
  const t = timer();
  await pool.getAnthropicTools(SERVERS);
  const connectMs = t();

  // Cleanup
  const t2 = timer();
  await pool.cleanupTransient();
  const cleanupMs = t2();
  ok('Transient cleanup', cleanupMs, `connect=${connectMs}ms, cleanup=${cleanupMs}ms`);

  // After cleanup, callTool should return error
  const result = await pool.callTool('ms-learn', 'microsoft_docs_search', { query: 'test' });
  if (result.isError) {
    ok('Post-cleanup callTool correctly fails', 0);
  } else {
    fail('Post-cleanup callTool should fail', 0);
  }

  await pool.shutdown();
}

// ─── Main ───

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  FEMTOCLAW MCP INTEGRATION TEST SUITE');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  await testParseMcpToolName();
  await testMcpConnection();
  await testMcpToolInvocation();
  await testMcpMerge();
  await testConnectionTiming();
  await testTransientCleanup();

  // Summary
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RESULTS: ${pass} passed, ${fail} failed, ${skipped} skipped (${results.length} total)`);
  console.log(`${'='.repeat(60)}`);

  // Timing summary
  console.log(`\n${CYAN}Timing Summary:${NC}`);
  for (const r of results.filter((r) => r.durationMs > 0)) {
    const color = r.status === 'PASS' ? GREEN : RED;
    console.log(`  ${color}${r.status}${NC} ${r.name}: ${r.durationMs}ms`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
