import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadManagedMcpServers } from './managed.js';

describe('loadManagedMcpServers', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should parse optional auth fields for managed MCP servers', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'femtoclaw-managed-'));
    const cfgPath = join(tempDir, 'managed-mcp.json');

    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          mcpServers: {
            memory: {
              type: 'http',
              url: 'http://memory.internal/mcp',
              auth: {
                header: 'X-Memory-Token',
                scheme: 'Token',
                token: 'abc123',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const loaded = loadManagedMcpServers(cfgPath);

    expect(loaded.memory).toMatchObject({
      type: 'http',
      url: 'http://memory.internal/mcp',
      auth: {
        header: 'X-Memory-Token',
        scheme: 'Token',
        token: 'abc123',
      },
    });
  });
});
