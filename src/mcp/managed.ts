import { readFileSync, existsSync } from 'fs';
import type { McpServerConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const RESERVED_NAME = 'femtoclaw';

/**
 * Load managed MCP server configs from a JSON file.
 * Format: { "mcpServers": { "name": McpServerConfig, ... } }
 */
export function loadManagedMcpServers(
  configPath: string,
): Record<string, McpServerConfig> {
  if (!existsSync(configPath)) {
    logger.debug({ path: configPath }, 'No managed MCP config found');
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
    const servers = parsed.mcpServers ?? {};

    // Filter out reserved name
    const result: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(servers)) {
      if (name === RESERVED_NAME) {
        logger.warn({ name }, 'Reserved MCP server name in managed config, skipping');
        continue;
      }
      result[name] = cfg;
    }

    logger.info(
      { count: Object.keys(result).length, names: Object.keys(result) },
      'Loaded managed MCP servers',
    );
    return result;
  } catch (err) {
    logger.error({ err, path: configPath }, 'Failed to load managed MCP config');
    return {};
  }
}
