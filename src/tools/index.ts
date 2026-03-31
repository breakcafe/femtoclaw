import type { ToolDefinition } from '../types.js';
import { SkillTool } from './skill.js';
import { WebSearchTool } from './web-search.js';
import { WebFetchTool } from './web-fetch.js';
import { MemoryTool } from './memory.js';
import { TodoWriteTool } from './todo-write.js';
import { SendMessageTool } from './send-message.js';
import { AskUserQuestionTool } from './ask-user-question.js';

export const builtinTools: ToolDefinition[] = [
  SkillTool,
  WebSearchTool,
  WebFetchTool,
  MemoryTool,
  TodoWriteTool,
  SendMessageTool,
  AskUserQuestionTool,
];

const toolMap = new Map<string, ToolDefinition>();
for (const tool of builtinTools) {
  toolMap.set(tool.name, tool);
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

export function getAllToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return builtinTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
