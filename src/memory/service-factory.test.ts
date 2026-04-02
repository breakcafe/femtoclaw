import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../types.js';
import { resolveApiMemoryConfig } from './service-factory.js';

describe('resolveApiMemoryConfig', () => {
  it('should prefer explicit env values over managed MCP config', () => {
    const managed: Record<string, McpServerConfig> = {
      memory: {
        type: 'http',
        url: 'http://memory-from-mcp/api',
        auth: {
          header: 'X-Memory-Token',
          scheme: 'Token',
          token: 'mcp-token',
        },
      },
    };

    const resolved = resolveApiMemoryConfig({
      memoryServiceUrl: 'http://memory-from-env/api',
      memoryServiceApiKey: 'env-token',
      memoryServiceAuthHeader: 'Authorization',
      memoryServiceAuthScheme: 'Bearer',
      memoryMcpServer: 'memory',
      managedMcpServers: managed,
    });

    expect(resolved).toEqual({
      url: 'http://memory-from-env/api',
      apiKey: 'env-token',
      authHeader: 'Authorization',
      authScheme: 'Bearer',
    });
  });

  it('should infer API memory config from managed MCP auth block', () => {
    const managed: Record<string, McpServerConfig> = {
      memory: {
        type: 'http',
        url: 'http://memory-from-mcp/api',
        auth: {
          header: 'X-Memory-Token',
          scheme: 'Token',
          token: 'mcp-token',
        },
      },
    };

    const resolved = resolveApiMemoryConfig({
      memoryServiceUrl: '',
      memoryServiceApiKey: '',
      memoryServiceAuthHeader: '',
      memoryServiceAuthScheme: '',
      memoryMcpServer: 'memory',
      managedMcpServers: managed,
    });

    expect(resolved).toEqual({
      url: 'http://memory-from-mcp/api',
      apiKey: 'mcp-token',
      authHeader: 'X-Memory-Token',
      authScheme: 'Token',
    });
  });

  it('should infer auth header and token from managed MCP headers', () => {
    const managed: Record<string, McpServerConfig> = {
      memory: {
        type: 'http',
        url: 'http://memory-from-mcp/api',
        headers: {
          Authorization: 'Bearer header-token',
        },
      },
    };

    const resolved = resolveApiMemoryConfig({
      memoryServiceUrl: '',
      memoryServiceApiKey: '',
      memoryServiceAuthHeader: '',
      memoryServiceAuthScheme: '',
      memoryMcpServer: 'memory',
      managedMcpServers: managed,
    });

    expect(resolved).toEqual({
      url: 'http://memory-from-mcp/api',
      apiKey: 'header-token',
      authHeader: 'Authorization',
      authScheme: 'Bearer',
    });
  });

  it('should throw if no URL can be resolved', () => {
    expect(() =>
      resolveApiMemoryConfig({
        memoryServiceUrl: '',
        memoryServiceApiKey: '',
        memoryServiceAuthHeader: '',
        memoryServiceAuthScheme: '',
        memoryMcpServer: 'memory',
        managedMcpServers: {},
      }),
    ).toThrow(/MEMORY_SERVICE_URL required/);
  });
});
