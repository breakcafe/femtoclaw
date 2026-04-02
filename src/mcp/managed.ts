import { readFileSync, existsSync } from 'fs';
import type { McpServerConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const RESERVED_NAME = 'femtoclaw';

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function parseAuthConfig(
  value: unknown,
): { header?: string; scheme?: string; token?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const auth = value as Record<string, unknown>;
  const parsed: { header?: string; scheme?: string; token?: string } = {};
  if (typeof auth.header === 'string' && auth.header.trim()) {
    parsed.header = auth.header.trim();
  }
  if (typeof auth.scheme === 'string') {
    parsed.scheme = auth.scheme.trim();
  }
  if (typeof auth.token === 'string' && auth.token.trim()) {
    parsed.token = auth.token.trim();
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function validateServerConfig(name: string, raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    logger.warn({ name }, 'Invalid MCP config entry, expected an object');
    return null;
  }

  const cfg = raw as Record<string, unknown>;
  const type = (cfg.type as string | undefined) ?? 'http';

  if (type === 'http' || type === 'sse') {
    if (typeof cfg.url !== 'string' || !cfg.url) {
      logger.warn({ name, type }, 'Invalid MCP config entry, url is required');
      return null;
    }
    return {
      type,
      url: cfg.url,
      headers: isStringRecord(cfg.headers) ? cfg.headers : undefined,
      auth: parseAuthConfig(cfg.auth),
    };
  }

  if (type === 'stdio') {
    if (typeof cfg.command !== 'string' || !cfg.command) {
      logger.warn({ name }, 'Invalid MCP stdio config entry, command is required');
      return null;
    }
    return {
      type,
      command: cfg.command,
      args: Array.isArray(cfg.args)
        ? cfg.args.filter((arg): arg is string => typeof arg === 'string')
        : undefined,
      env: isStringRecord(cfg.env) ? cfg.env : undefined,
      auth: parseAuthConfig(cfg.auth),
    };
  }

  logger.warn({ name, type }, 'Invalid MCP config entry, unsupported transport type');
  return null;
}

/**
 * Load managed MCP server configs from a JSON file.
 * Format: { "mcpServers": { "name": McpServerConfig, ... } }
 */
export function loadManagedMcpServers(configPath: string): Record<string, McpServerConfig> {
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
      const validated = validateServerConfig(name, cfg);
      if (!validated) {
        continue;
      }
      result[name] = validated;
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
