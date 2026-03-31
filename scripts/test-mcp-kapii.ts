#!/usr/bin/env npx tsx
/**
 * Kapii MCP server integration test (separate from main test to avoid checking in URLs)
 * Usage: KAPII_MCP_URL=http://... npx tsx scripts/test-mcp-kapii.ts
 */
import { McpClientPool } from '../src/mcp/client-pool.js';
import type { McpServerConfig } from '../src/types.js';

const KAPII_URL = process.env.KAPII_MCP_URL || 'http://next-int.kapii.cn/kapii-mcp-server-go/kapii/mcp';

const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';

function timer() {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  KAPII MCP INTEGRATION TEST');
  console.log(`${'='.repeat(60)}`);

  const pool = new McpClientPool();
  const cfg: Record<string, McpServerConfig> = {
    kapii: { type: 'http', url: KAPII_URL },
  };

  // 1. Connect and discover
  console.log(`\n${CYAN}═══ 1. Connect + Discover ═══${NC}`);
  let t = timer();
  try {
    const { tools, warnings } = await pool.getAnthropicTools(cfg);
    const ms = t();
    console.log(`  ${GREEN}✓${NC} Connected to Kapii MCP ${DIM}[${ms}ms]${NC}`);
    console.log(`  Tools found: ${tools.length}`);
    for (const tool of tools) {
      console.log(`    - ${tool.name}: ${tool.description.slice(0, 100)}`);
    }
    if (warnings.length > 0) {
      console.log(`  Warnings: ${warnings.join(', ')}`);
    }

    // 2. List tools to find what's available
    console.log(`\n${CYAN}═══ 2. Tool Invocation ═══${NC}`);

    // Try calling the first available tool
    if (tools.length > 0) {
      // Extract actual tool names
      for (const tool of tools) {
        const mcpName = tool.name.replace('mcp__kapii__', '');
        t = timer();
        try {
          const result = await pool.callTool('kapii', mcpName, {
            user_id: 'CAOZHENXING',
          });
          const ms2 = t();
          const text = result.content.map((c) => c.text ?? '').join('').slice(0, 500);
          if (result.isError) {
            console.log(`  ${RED}✗${NC} ${mcpName} ${DIM}[${ms2}ms]${NC} — ERROR: ${text}`);
          } else {
            console.log(`  ${GREEN}✓${NC} ${mcpName} ${DIM}[${ms2}ms]${NC} — ${text.slice(0, 200)}...`);
          }
        } catch (err) {
          const ms2 = t();
          console.log(`  ${RED}✗${NC} ${mcpName} ${DIM}[${ms2}ms]${NC} — ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    const ms = t();
    console.log(`  ${RED}✗${NC} Connection failed ${DIM}[${ms}ms]${NC} — ${(err as Error).message}`);
  }

  await pool.shutdown();
}

main().catch(console.error);
