import type { ToolDefinition } from '../types.js';
import { config } from '../config.js';
import { SkillTool } from './skill.js';
import { WebSearchTool } from './web-search.js';
import { WebFetchTool } from './web-fetch.js';
import { MemoryTool } from './memory.js';
import { TodoWriteTool } from './todo-write.js';
import { SendMessageTool } from './send-message.js';
import { AskUserQuestionTool } from './ask-user-question.js';

/** All registered tools (order = default display order). */
const allTools: ToolDefinition[] = [
  SkillTool,
  WebSearchTool,
  WebFetchTool,
  MemoryTool,
  TodoWriteTool,
  SendMessageTool,
  AskUserQuestionTool,
];

const toolMap = new Map<string, ToolDefinition>();
for (const tool of allTools) {
  toolMap.set(tool.name, tool);
}

/** Lookup any tool by name (always works — executor needs this). */
export function getToolByName(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

/**
 * Parse an allowlist string into a Set, or null for "all".
 * Accepts: "*" | "Skill,Memory,WebFetch" | "Skill, Memory, WebFetch"
 */
function parseAllowList(raw: string): Set<string> | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null; // null = allow all
  return new Set(
    trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Get tool definitions to expose to Claude.
 *
 * Respects two layers of allow-listing:
 *   1. Server-level: ALLOWED_TOOLS env var (config)
 *   2. Request-level: allowed_tools param from POST /chat
 *
 * A tool must pass BOTH to be visible. If either is "*" / undefined,
 * that layer is a pass-through.
 */
export function getAllToolDefinitions(
  requestAllowedTools?: string[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const serverAllow = parseAllowList(config.ALLOWED_TOOLS);
  const requestAllow = requestAllowedTools ? new Set(requestAllowedTools) : null;

  return allTools
    .filter((t) => {
      if (serverAllow && !serverAllow.has(t.name)) return false;
      if (requestAllow && !requestAllow.has(t.name)) return false;
      return true;
    })
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
}
