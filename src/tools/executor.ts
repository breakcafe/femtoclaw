import { getToolByName } from './index.js';
import type { ToolExecutionContext, ToolResult } from '../types.js';
import { parseMcpToolName } from '../mcp/tool-mapper.js';
import type { McpClientPool } from '../mcp/client-pool.js';
import type { McpServerConfig } from '../types.js';
import { logger } from '../utils/logger.js';

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Execute a tool call (built-in or MCP) and return the result.
 */
export async function executeTool(
  block: ToolUseBlock,
  context: ToolExecutionContext,
  mcpClientPool: McpClientPool,
  perRequestServers?: Record<string, McpServerConfig>,
): Promise<ToolResultBlock> {
  // 1. Check built-in tools
  const builtinTool = getToolByName(block.name);
  if (builtinTool) {
    try {
      const result = await builtinTool.execute(block.input, context);
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.error ?? result.text ?? result.content ?? '',
        is_error: result.type === 'error' || !!result.error,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: block.name }, 'Tool execution error');
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool error: ${message}`,
        is_error: true,
      };
    }
  }

  // 2. Check MCP tools
  const mcpParsed = parseMcpToolName(block.name);
  if (mcpParsed) {
    try {
      const result = await mcpClientPool.callTool(
        mcpParsed.server,
        mcpParsed.tool,
        block.input,
        perRequestServers,
      );
      const text = result.content.map((c) => c.text ?? '').join('\n');
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: text,
        is_error: result.isError,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `MCP tool error: ${message}`,
        is_error: true,
      };
    }
  }

  // 3. Unknown tool
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: `Unknown tool: ${block.name}`,
    is_error: true,
  };
}
