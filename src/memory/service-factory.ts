import { config } from '../config.js';
import { SqliteMemoryService } from './sqlite-backend.js';
import { ApiMemoryService } from './api-backend.js';
import { McpMemoryService } from './mcp-backend.js';
import type { MemoryServiceInterface, McpServerConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import type { McpClientPool } from '../mcp/client-pool.js';
import { loadManagedMcpServers } from '../mcp/managed.js';

type OptionalString = string | undefined;

export interface ResolvedApiMemoryConfig {
  url: string;
  apiKey: string;
  authHeader: string;
  authScheme: string;
}

interface ParsedAuthHeader {
  headerName: string;
  token: string;
  scheme: string;
}

interface ResolveApiMemoryConfigInput {
  memoryServiceUrl: OptionalString;
  memoryServiceApiKey: OptionalString;
  memoryServiceAuthHeader: OptionalString;
  memoryServiceAuthScheme: OptionalString;
  memoryMcpServer: OptionalString;
  managedMcpServers: Record<string, McpServerConfig>;
}

function parseAuthHeaderValue(headerName: string, value: string): ParsedAuthHeader | null {
  const token = value.trim();
  if (!token) {
    return null;
  }
  const parts = token.split(/\s+/, 2);
  if (parts.length === 2) {
    return {
      headerName,
      scheme: parts[0] ?? '',
      token: parts[1] ?? '',
    };
  }
  return {
    headerName,
    scheme: '',
    token,
  };
}

function extractAuthFromHeaders(headers?: Record<string, string>): ParsedAuthHeader | null {
  if (!headers) {
    return null;
  }
  const entries = Object.entries(headers);
  const preferred = [
    'Authorization',
    'authorization',
    'X-API-Key',
    'x-api-key',
    'Api-Key',
    'api-key',
    'X-Auth-Token',
    'x-auth-token',
  ];

  for (const key of preferred) {
    const value = headers[key];
    if (typeof value === 'string') {
      const parsed = parseAuthHeaderValue(key, value);
      if (parsed) {
        return parsed;
      }
    }
  }

  for (const [key, value] of entries) {
    if (key.toLowerCase() === 'x-mcp-session-id') {
      continue;
    }
    const parsed = parseAuthHeaderValue(key, value);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function resolveApiMemoryConfig(
  input: ResolveApiMemoryConfigInput,
): ResolvedApiMemoryConfig {
  const envUrl = input.memoryServiceUrl?.trim() ?? '';
  const envApiKey = input.memoryServiceApiKey?.trim() ?? '';
  const envAuthHeader = input.memoryServiceAuthHeader?.trim() ?? '';
  const envAuthScheme = input.memoryServiceAuthScheme?.trim() ?? '';
  const mcpServerName = (input.memoryMcpServer?.trim() || 'memory') as string;

  let url = envUrl;
  let apiKey = envApiKey;
  let authHeader = envAuthHeader || 'Authorization';
  let authScheme = envAuthScheme || 'Bearer';

  const mcpCfg = input.managedMcpServers[mcpServerName];
  if (mcpCfg && (mcpCfg.type === 'http' || mcpCfg.type === 'sse')) {
    if (!url && mcpCfg.url) {
      url = mcpCfg.url;
    }

    if (!envApiKey) {
      if (mcpCfg.auth?.token?.trim()) {
        apiKey = mcpCfg.auth.token.trim();
      } else {
        const headerAuth = extractAuthFromHeaders(mcpCfg.headers);
        if (headerAuth?.token) {
          apiKey = headerAuth.token;
          if (!envAuthHeader) {
            authHeader = headerAuth.headerName;
          }
          if (!envAuthScheme) {
            authScheme = headerAuth.scheme;
          }
        }
      }
    }

    if (!envAuthHeader && mcpCfg.auth?.header?.trim()) {
      authHeader = mcpCfg.auth.header.trim();
    }
    if (!envAuthScheme && typeof mcpCfg.auth?.scheme === 'string') {
      authScheme = mcpCfg.auth.scheme.trim();
    }
  }

  if (!url) {
    throw new Error(
      'MEMORY_SERVICE_URL required for api memory service (or provide managed MCP server URL)',
    );
  }

  return {
    url,
    apiKey,
    authHeader,
    authScheme,
  };
}

export function createMemoryService(mcpClientPool?: McpClientPool): MemoryServiceInterface {
  switch (config.MEMORY_SERVICE_TYPE) {
    case 'api': {
      const managedMcpServers = loadManagedMcpServers(config.MANAGED_MCP_CONFIG);
      const resolved = resolveApiMemoryConfig({
        memoryServiceUrl: config.MEMORY_SERVICE_URL,
        memoryServiceApiKey: config.MEMORY_SERVICE_API_KEY,
        memoryServiceAuthHeader: config.MEMORY_SERVICE_AUTH_HEADER,
        memoryServiceAuthScheme: config.MEMORY_SERVICE_AUTH_SCHEME,
        memoryMcpServer: config.MEMORY_MCP_SERVER,
        managedMcpServers,
      });
      logger.info(
        {
          url: resolved.url,
          authHeader: resolved.authHeader,
          authScheme: resolved.authScheme,
          mcpServer: config.MEMORY_MCP_SERVER,
        },
        'Using API memory service',
      );
      return new ApiMemoryService(resolved.url, resolved.apiKey, {
        authHeader: resolved.authHeader,
        authScheme: resolved.authScheme,
      });
    }
    case 'mcp': {
      if (!mcpClientPool) {
        throw new Error('McpClientPool is required for mcp memory service');
      }
      logger.info({ server: config.MEMORY_MCP_SERVER }, 'Using MCP memory service');
      return new McpMemoryService(mcpClientPool, config.MEMORY_MCP_SERVER);
    }
    case 'sqlite':
    default: {
      logger.info({ path: config.SQLITE_DB_PATH }, 'Using SQLite memory service');
      return new SqliteMemoryService(config.SQLITE_DB_PATH);
    }
  }
}
