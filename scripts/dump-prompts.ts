#!/usr/bin/env npx tsx
/**
 * Dump the fully constructed prompts for various scenarios.
 * Shows exactly what gets sent to the Anthropic Messages API.
 *
 * Usage: npx tsx scripts/dump-prompts.ts
 */
import { buildSystemPrompt, buildUserMessagePreamble } from '../src/agent/context-builder.js';
import { getAllToolDefinitions } from '../src/tools/index.js';
import { SkillManager } from '../src/skills/manager.js';
import { SqliteMemoryService } from '../src/memory/sqlite-backend.js';
import { McpClientPool } from '../src/mcp/client-pool.js';
import { estimateTokenCount } from '../src/utils/token-counter.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = '/tmp/femtoclaw-prompt-dump.db';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

function header(text: string) { console.log(`\n${CYAN}${'═'.repeat(70)}${NC}`); console.log(`${CYAN}  ${text}${NC}`); console.log(`${CYAN}${'═'.repeat(70)}${NC}\n`); }
function section(text: string) { console.log(`\n${YELLOW}── ${text} ──${NC}\n`); }
function tokenInfo(label: string, content: string) {
  const chars = content.length;
  const tokens = estimateTokenCount(content);
  console.log(`${DIM}[${label}: ${chars} chars, ~${tokens} tokens]${NC}`);
}

async function main() {
  // Setup
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  const memoryService = new SqliteMemoryService(TEST_DB);
  const skillManager = new SkillManager('./skills/builtin');
  await skillManager.loadSkills();

  // Seed some test memory
  await memoryService.writeMemory('test-user', {
    key: 'user.role', type: 'user',
    description: '用户是一名产品设计师，在北京工作',
    value: '产品设计师，专注于移动端设计，在北京字节工作',
  });
  await memoryService.writeMemory('test-user', {
    key: 'feedback.no_emoji', type: 'feedback',
    description: '不要在回复中使用 emoji',
    value: '回复中不要使用 emoji。\n**原因**：用户觉得 emoji 不专业。\n**应用场景**：所有回复。',
  });
  await memoryService.writeMemory('test-user', {
    key: 'project.deadline', type: 'project',
    description: 'Q2 产品上线截止日 2026-06-30',
    value: 'Q2 上线日期是 2026-06-30，需在此之前完成所有功能开发和测试。',
  });

  // ════════════════════════════════════════════════════════════
  // Scenario 1: Basic chat (no MCP, no org instructions)
  // ════════════════════════════════════════════════════════════
  header('Scenario 1: Basic Chat (no MCP, no org instructions)');

  section('System Prompt Blocks');
  const sysBlocks = await buildSystemPrompt('test-user', {
    assistantName: 'Femto',
    timezone: 'Asia/Shanghai',
  });
  for (let i = 0; i < sysBlocks.length; i++) {
    const block = sysBlocks[i];
    console.log(`--- system[${i}] ${block.cache_control ? '(cache_control: ephemeral)' : ''} ---`);
    console.log(block.text);
    tokenInfo(`system[${i}]`, block.text);
  }

  section('User Message Preamble (skills + memory)');
  const preamble = await buildUserMessagePreamble('test-user', skillManager, memoryService, {
    timezone: 'Asia/Shanghai',
    device_type: 'mobile',
    locale: 'zh-CN',
  });
  for (let i = 0; i < preamble.length; i++) {
    console.log(`--- user_preamble[${i}] ---`);
    console.log(preamble[i].text);
    tokenInfo(`preamble[${i}]`, preamble[i].text);
  }

  section('User Message (actual text)');
  const userText = '帮我分析一下最近一周的支出情况';
  console.log(`--- user_content[${preamble.length}] (actual message) ---`);
  console.log(userText);
  tokenInfo('user_message', userText);

  section('Built-in Tool Definitions');
  const builtinTools = getAllToolDefinitions();
  for (const tool of builtinTools) {
    const json = JSON.stringify(tool, null, 2);
    console.log(`--- tool: ${tool.name} ---`);
    console.log(`  description: ${tool.description.slice(0, 100)}...`);
    tokenInfo(tool.name, json);
  }

  // ════════════════════════════════════════════════════════════
  // Scenario 2: Chat with MCP servers
  // ════════════════════════════════════════════════════════════
  header('Scenario 2: Chat with MCP (Microsoft Learn)');

  const mcpPool = new McpClientPool();
  try {
    const { tools: mcpTools } = await mcpPool.getAnthropicTools({
      'ms-learn': { type: 'http', url: 'https://learn.microsoft.com/api/mcp' },
    });
    section('MCP Tool Definitions');
    for (const tool of mcpTools) {
      const json = JSON.stringify(tool, null, 2);
      console.log(`--- tool: ${tool.name} ---`);
      console.log(`  description: ${tool.description.slice(0, 100)}...`);
      tokenInfo(tool.name, json);
    }
  } catch (err) {
    console.log(`  MCP connection failed: ${(err as Error).message}`);
  }
  await mcpPool.shutdown();

  // ════════════════════════════════════════════════════════════
  // Scenario 3: No memory, no skills (cold user)
  // ════════════════════════════════════════════════════════════
  header('Scenario 3: Cold User (no memory, no skills)');

  const emptySkillManager = new SkillManager('/nonexistent');
  await emptySkillManager.loadSkills();

  const preambleEmpty = await buildUserMessagePreamble('new-user', emptySkillManager, memoryService, {
    timezone: 'UTC',
  });
  if (preambleEmpty.length === 0) {
    console.log('(no preamble blocks — no skills, no memory for this user)');
  } else {
    for (let i = 0; i < preambleEmpty.length; i++) {
      console.log(`--- preamble[${i}] ---`);
      console.log(preambleEmpty[i].text);
    }
  }

  // ════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════
  header('Token Budget Summary');

  const sysTotal = sysBlocks.reduce((sum, b) => sum + estimateTokenCount(b.text), 0);
  const preambleTotal = preamble.reduce((sum, b) => sum + estimateTokenCount(b.text), 0);
  const builtinToolsTotal = builtinTools.reduce((sum, t) => sum + estimateTokenCount(JSON.stringify(t)), 0);

  console.log(`System prompt (core):          ~${sysTotal} tokens`);
  console.log(`User preamble (skills+memory): ~${preambleTotal} tokens`);
  console.log(`Built-in tools (${builtinTools.length} tools):     ~${builtinToolsTotal} tokens`);
  console.log(`User message:                  ~${estimateTokenCount(userText)} tokens`);
  console.log(`${'─'.repeat(45)}`);
  console.log(`Total per-request overhead:    ~${sysTotal + preambleTotal + builtinToolsTotal} tokens`);
  console.log();
  console.log(`${DIM}Comparison: Picoclaw system prompt is ~32KB (~8000 tokens)${NC}`);
  console.log(`${DIM}           Picoclaw tools are ~130KB (~32500 tokens, 32 tools)${NC}`);

  // Cleanup
  memoryService.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  [TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { unlinkSync(f); } catch {} });
}

main().catch(console.error);
