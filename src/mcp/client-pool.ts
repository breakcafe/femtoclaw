import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpServerContext } from '../types.js';
import type { McpToolDefinition, McpCallToolResult } from './types.js';
import { loadManagedMcpServers } from './managed.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const RESERVED_NAME = 'femtoclaw';

export class McpClientPool {
  private managedConfigs: Record<string, McpServerConfig> = {};
  private managedClients = new Map<string, Client>();

  async init(): Promise<void> {
    this.managedConfigs = loadManagedMcpServers(config.MANAGED_MCP_CONFIG);

    // Pre-connect managed servers
    for (const [name, cfg] of Object.entries(this.managedConfigs)) {
      try {
        const client = await this.connectServer(name, cfg);
        this.managedClients.set(name, client);
      } catch (err) {
        logger.error({ err, name }, 'Failed to connect managed MCP server');
      }
    }
  }

  /**
   * Merge MCP servers from all 3 sources.
   * Priority: managed → builtin (protected) → per-request
   */
  mergeMcpServers(
    perRequestServers?: Record<string, McpServerConfig>,
    perRequestContext?: Record<string, McpServerContext>,
  ): Record<string, McpServerConfig> {
    const merged: Record<string, McpServerConfig> = { ...this.managedConfigs };
    const warnings: string[] = [];

    // Per-request servers can override managed but not builtin
    if (perRequestServers) {
      for (const [name, cfg] of Object.entries(perRequestServers)) {
        if (name === RESERVED_NAME) {
          warnings.push(`Reserved MCP server name "${RESERVED_NAME}" ignored`);
          continue;
        }
        merged[name] = cfg;
      }
    }

    // Apply per-request context overlay
    if (perRequestContext) {
      for (const [name, ctx] of Object.entries(perRequestContext)) {
        if (name === RESERVED_NAME) {
          warnings.push(`Reserved name "${RESERVED_NAME}" in mcp_context ignored`);
          continue;
        }
        const server = merged[name];
        if (!server) {
          warnings.push(`MCP server "${name}" not found for context overlay`);
          continue;
        }
        this.applyContext(server, ctx, name, warnings);
      }
    }

    if (warnings.length > 0) {
      logger.warn({ warnings }, 'MCP merge warnings');
    }

    return merged;
  }

  /**
   * Discover tools from a specific server or all managed servers.
   */
  async discoverTools(
    servers?: Record<string, McpServerConfig>,
  ): Promise<Array<{ server: string; tools: McpToolDefinition[] }>> {
    const results: Array<{ server: string; tools: McpToolDefinition[] }> = [];
    const targetServers = servers ?? Object.fromEntries(this.managedClients.entries());

    for (const [name] of Object.entries(targetServers)) {
      try {
        const client = this.managedClients.get(name);
        if (!client) continue;

        const toolsList = await client.listTools();
        const tools: McpToolDefinition[] = (toolsList.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema as Record<string, unknown>,
        }));
        results.push({ server: name, tools });
      } catch (err) {
        logger.warn({ err, server: name }, 'Failed to discover MCP tools');
      }
    }

    return results;
  }

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    perRequestServers?: Record<string, McpServerConfig>,
  ): Promise<McpCallToolResult> {
    let client = this.managedClients.get(serverName);

    // If not managed, try per-request
    if (!client && perRequestServers?.[serverName]) {
      client = await this.connectServer(serverName, perRequestServers[serverName]);
    }

    if (!client) {
      return {
        content: [{ type: 'text', text: `MCP server "${serverName}" not available` }],
        isError: true,
      };
    }

    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      return result as McpCallToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `MCP tool error: ${message}` }],
        isError: true,
      };
    }
  }

  async shutdown(): Promise<void> {
    for (const [name, client] of this.managedClients) {
      try {
        await client.close();
      } catch (err) {
        logger.warn({ err, name }, 'Error closing MCP client');
      }
    }
    this.managedClients.clear();
  }

  private async connectServer(name: string, cfg: McpServerConfig): Promise<Client> {
    const client = new Client({ name: `femtoclaw-${name}`, version: '0.1.0' });
    const type = cfg.type ?? 'http';

    if (type === 'http' && cfg.url) {
      const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
      });
      await client.connect(transport);
    } else if (type === 'sse' && cfg.url) {
      const transport = new SSEClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
      });
      await client.connect(transport);
    } else {
      throw new Error(`Unsupported MCP transport type "${type}" for server "${name}"`);
    }

    logger.info({ name, type }, 'Connected to MCP server');
    return client;
  }

  private applyContext(
    server: McpServerConfig,
    ctx: McpServerContext,
    name: string,
    warnings: string[],
  ): void {
    const type = server.type ?? 'http';

    if (ctx.headers) {
      if (type === 'http' || type === 'sse') {
        server.headers = { ...server.headers, ...ctx.headers };
      } else {
        warnings.push(`headers in mcp_context for stdio server "${name}" ignored`);
      }
    }
    if (ctx.env) {
      if (type === 'stdio') {
        server.env = { ...server.env, ...ctx.env };
      } else {
        warnings.push(`env in mcp_context for ${type} server "${name}" ignored`);
      }
    }
    if (ctx.args) {
      if (type === 'stdio') {
        server.args = [...(server.args ?? []), ...ctx.args];
      } else {
        warnings.push(`args in mcp_context for ${type} server "${name}" ignored`);
      }
    }
  }
}
