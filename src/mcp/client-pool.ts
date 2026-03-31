import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpServerContext } from '../types.js';
import type { McpToolDefinition, McpCallToolResult } from './types.js';
import { mcpToolToAnthropicTool, type AnthropicToolDefinition } from './tool-mapper.js';
import { loadManagedMcpServers } from './managed.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const RESERVED_NAME = 'femtoclaw';

interface ConnectedServer {
  client: Client;
  tools: McpToolDefinition[];
  connectedAt: number;
}

export class McpClientPool {
  private managedConfigs: Record<string, McpServerConfig> = {};
  private managedServers = new Map<string, ConnectedServer>();
  private transientServers = new Map<string, ConnectedServer>();

  async init(): Promise<void> {
    this.managedConfigs = loadManagedMcpServers(config.MANAGED_MCP_CONFIG);

    // Pre-connect managed servers
    for (const [name, cfg] of Object.entries(this.managedConfigs)) {
      try {
        const connected = await this.connectAndDiscover(name, cfg);
        this.managedServers.set(name, connected);
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
  ): { configs: Record<string, McpServerConfig>; warnings: string[] } {
    const merged: Record<string, McpServerConfig> = { ...this.managedConfigs };
    const warnings: string[] = [];

    if (perRequestServers) {
      for (const [name, cfg] of Object.entries(perRequestServers)) {
        if (name === RESERVED_NAME) {
          warnings.push(`Reserved MCP server name "${RESERVED_NAME}" ignored`);
          continue;
        }
        merged[name] = cfg;
      }
    }

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

    return { configs: merged, warnings };
  }

  /**
   * Get all discovered tool definitions (managed + per-request) as Anthropic tools.
   * For per-request servers, connects and discovers on-the-fly.
   */
  async getAnthropicTools(
    perRequestServers?: Record<string, McpServerConfig>,
    perRequestContext?: Record<string, McpServerContext>,
  ): Promise<{ tools: AnthropicToolDefinition[]; warnings: string[] }> {
    const { configs: mergedConfigs, warnings } = this.mergeMcpServers(
      perRequestServers,
      perRequestContext,
    );
    const tools: AnthropicToolDefinition[] = [];

    // 1. Managed servers (already connected and discovered)
    for (const [name, server] of this.managedServers) {
      for (const tool of server.tools) {
        tools.push(mcpToolToAnthropicTool(name, tool));
      }
    }

    // 2. Per-request servers (connect + discover on-the-fly)
    if (perRequestServers) {
      for (const [name, cfg] of Object.entries(perRequestServers)) {
        if (name === RESERVED_NAME) continue;
        if (this.managedServers.has(name)) continue; // already have managed

        // Check if we have a cached transient connection
        const existing = this.transientServers.get(name);
        if (existing) {
          for (const tool of existing.tools) {
            tools.push(mcpToolToAnthropicTool(name, tool));
          }
          continue;
        }

        // Apply context overlay if present
        const effectiveCfg = perRequestContext?.[name]
          ? this.applyContextToCopy(cfg, perRequestContext[name], name)
          : cfg;

        try {
          const connected = await this.connectAndDiscover(name, effectiveCfg);
          this.transientServers.set(name, connected);
          for (const tool of connected.tools) {
            tools.push(mcpToolToAnthropicTool(name, tool));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to connect MCP server "${name}": ${msg}`);
          logger.warn({ err, name }, 'Failed to connect per-request MCP server');
        }
      }
    }

    return { tools, warnings };
  }

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    // Check managed servers first, then transient
    const server = this.managedServers.get(serverName) ?? this.transientServers.get(serverName);

    if (!server) {
      return {
        content: [{ type: 'text', text: `MCP server "${serverName}" not available` }],
        isError: true,
      };
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      return result as McpCallToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `MCP tool error: ${message}` }],
        isError: true,
      };
    }
  }

  /**
   * Clean up transient connections (call after each request).
   */
  async cleanupTransient(): Promise<void> {
    for (const [name, server] of this.transientServers) {
      try {
        await server.client.close();
      } catch (err) {
        logger.warn({ err, name }, 'Error closing transient MCP client');
      }
    }
    this.transientServers.clear();
  }

  async shutdown(): Promise<void> {
    // Close managed
    for (const [name, server] of this.managedServers) {
      try {
        await server.client.close();
      } catch (err) {
        logger.warn({ err, name }, 'Error closing managed MCP client');
      }
    }
    this.managedServers.clear();

    // Close transient
    await this.cleanupTransient();
  }

  /**
   * Connect to a server and discover its tools.
   */
  private async connectAndDiscover(name: string, cfg: McpServerConfig): Promise<ConnectedServer> {
    const client = await this.connectServer(name, cfg);

    // Discover tools
    let tools: McpToolDefinition[] = [];
    try {
      const toolsList = await client.listTools();
      tools = (toolsList.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      logger.info(
        { name, toolCount: tools.length, toolNames: tools.map((t) => t.name) },
        'MCP tools discovered',
      );
    } catch (err) {
      logger.warn(
        { err, name },
        'Failed to discover MCP tools (server connected but listTools failed)',
      );
    }

    return { client, tools, connectedAt: Date.now() };
  }

  private async connectServer(name: string, cfg: McpServerConfig): Promise<Client> {
    const client = new Client({ name: `femtoclaw-${name}`, version: '0.1.0' });
    const type = cfg.type ?? 'http';

    if ((type === 'http' || !cfg.type) && cfg.url) {
      // Try Streamable HTTP first, fall back to SSE
      try {
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: { headers: cfg.headers },
        });
        await client.connect(transport);
        logger.info({ name, type: 'http' }, 'Connected via Streamable HTTP');
        return client;
      } catch (httpErr) {
        logger.debug({ name, err: httpErr }, 'Streamable HTTP failed, trying SSE fallback');
        // Fall back to SSE
        const sseClient = new Client({ name: `femtoclaw-${name}`, version: '0.1.0' });
        try {
          const sseTransport = new SSEClientTransport(new URL(cfg.url), {
            requestInit: { headers: cfg.headers },
          });
          await sseClient.connect(sseTransport);
          logger.info({ name, type: 'sse-fallback' }, 'Connected via SSE (fallback)');
          return sseClient;
        } catch (sseErr) {
          // If both fail, throw the original HTTP error
          throw httpErr;
        }
      }
    } else if (type === 'sse' && cfg.url) {
      const transport = new SSEClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
      });
      await client.connect(transport);
      logger.info({ name, type: 'sse' }, 'Connected via SSE');
      return client;
    } else if (type === 'stdio' && cfg.command) {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        stderr: 'pipe',
      });
      const stderr = transport.stderr;
      if (stderr) {
        stderr.on('data', (chunk) => {
          const text = chunk.toString().trim();
          if (text) {
            logger.debug({ name, stderr: text }, 'MCP stdio server stderr');
          }
        });
      }
      await client.connect(transport);
      logger.info({ name, type: 'stdio' }, 'Connected via stdio');
      return client;
    }

    throw new Error(
      `Unsupported MCP transport type "${type}" or missing connection details for server "${name}"`,
    );
  }

  private applyContext(
    server: McpServerConfig,
    ctx: McpServerContext,
    name: string,
    warnings: string[],
  ): void {
    const type = server.type ?? 'http';
    if (ctx.headers && (type === 'http' || type === 'sse')) {
      server.headers = { ...server.headers, ...ctx.headers };
    } else if (ctx.headers) {
      warnings.push(`headers in mcp_context for stdio server "${name}" ignored`);
    }
    if (ctx.env && type === 'stdio') {
      server.env = { ...server.env, ...ctx.env };
    } else if (ctx.env) {
      warnings.push(`env in mcp_context for ${type} server "${name}" ignored`);
    }
    if (ctx.args && type === 'stdio') {
      server.args = [...(server.args ?? []), ...ctx.args];
    } else if (ctx.args) {
      warnings.push(`args in mcp_context for ${type} server "${name}" ignored`);
    }
  }

  private applyContextToCopy(
    cfg: McpServerConfig,
    ctx: McpServerContext,
    name: string,
  ): McpServerConfig {
    const copy = { ...cfg };
    const warnings: string[] = [];
    this.applyContext(copy, ctx, name, warnings);
    return copy;
  }
}
