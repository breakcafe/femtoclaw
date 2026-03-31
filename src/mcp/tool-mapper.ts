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
 * Format: mcp__<server>__<tool>
 * Returns null if the name doesn't match the pattern.
 */
export function parseMcpToolName(fullName: string): { server: string; tool: string } | null {
  if (!fullName.startsWith('mcp__')) return null;

  // Remove 'mcp__' prefix and split by '__'
  const rest = fullName.slice(5);
  const parts = rest.split('__');
  if (parts.length < 2) return null;

  // Last segment is the tool name, rest is the server name
  const tool = parts[parts.length - 1];
  const server = parts.slice(0, -1).join('__');

  if (!server || !tool) return null;
  return { server, tool };
}
