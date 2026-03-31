import type { McpToolDefinition } from './types.js';

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Convert an MCP tool definition to Anthropic API tool format.
 * Tool names follow pattern: mcp__<server>__<tool>
 */
export function mcpToolToAnthropicTool(
  serverName: string,
  mcpTool: McpToolDefinition,
): AnthropicToolDefinition {
  return {
    name: `mcp__${serverName}__${mcpTool.name}`,
    description: mcpTool.description ?? '',
    input_schema: mcpTool.inputSchema ?? { type: 'object', properties: {} },
  };
}

/**
 * Parse an MCP tool name back to server name and tool name.
 * Returns null if the name doesn't match the mcp__server__tool pattern.
 */
export function parseMcpToolName(fullName: string): { server: string; tool: string } | null {
  const match = fullName.match(/^mcp__([^_]+(?:__[^_]+)*)__([^_]+(?:__[^_]+)*)$/);
  if (!match) return null;

  // Handle the case where server or tool name might contain double underscores
  const parts = fullName.slice(5).split('__'); // Remove 'mcp__' prefix
  if (parts.length < 2) return null;

  // Last part is tool name, everything else is server name
  const tool = parts[parts.length - 1];
  const server = parts.slice(0, -1).join('__');
  return { server, tool };
}
