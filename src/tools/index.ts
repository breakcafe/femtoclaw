import type { ToolDefinition } from '../types.js';
import { config } from '../config.js';
import { SkillTool } from './skill.js';
import { WebSearchTool } from './web-search.js';
import { WebFetchTool } from './web-fetch.js';
import { MemoryTool } from './memory.js';
import { TodoWriteTool } from './todo-write.js';
import { SendMessageTool } from './send-message.js';
import { AskUserQuestionTool } from './ask-user-question.js';

/** All tools unconditionally (for executor lookup — execution still works). */
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

/** Lookup any tool by name (always works, regardless of toggles). */
export function getToolByName(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

/**
 * Get tool definitions to expose to Claude (respects feature toggles).
 * Disabled tools are hidden from the tool list so Claude won't invoke them.
 */
export function getAllToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  const tools: ToolDefinition[] = [];

  // Always-on core tools
  tools.push(TodoWriteTool, SendMessageTool, AskUserQuestionTool);

  // Conditional tools
  if (config.ENABLE_SKILLS) tools.push(SkillTool);
  if (config.ENABLE_MEMORY) tools.push(MemoryTool);
  if (config.ENABLE_WEB_TOOLS) {
    tools.push(WebSearchTool, WebFetchTool);
  }

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
