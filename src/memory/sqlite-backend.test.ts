import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryService } from './sqlite-backend.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = '/tmp/femtoclaw-test-memory.db';

describe('SqliteMemoryService', () => {
  let service: SqliteMemoryService;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    service = new SqliteMemoryService(TEST_DB);
  });

  afterEach(() => {
    service.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  it('should write and read a memory entry', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role',
      type: 'user',
      description: 'User is a designer',
      value: 'Product designer at Acme Corp',
    });

    const entry = await service.readMemory('user-1', 'user.role');
    expect(Array.isArray(entry)).toBe(false);
    if (!Array.isArray(entry)) {
      expect(entry.key).toBe('user.role');
      expect(entry.value).toBe('Product designer at Acme Corp');
      expect(entry.type).toBe('user');
    }
  });

  it('should list memories as summaries (no value)', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role',
      type: 'user',
      description: 'User is a designer',
      value: 'Long detailed value here...',
    });

    const list = await service.listMemories('user-1');
    expect(list.length).toBe(1);
    expect(list[0].key).toBe('user.role');
    expect(list[0].description).toBe('User is a designer');
    expect((list[0] as any).value).toBeUndefined();
  });

  it('should filter by category', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'Role', value: 'Designer',
    });
    await service.writeMemory('user-1', {
      key: 'feedback.no_emoji', type: 'feedback',
      description: 'No emoji', value: 'Do not use emoji',
    });

    const userOnly = await service.listMemories('user-1', 'user');
    expect(userOnly.length).toBe(1);
    expect(userOnly[0].key).toBe('user.role');
  });

  it('should search memories by keyword', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'User is a designer', value: 'Product designer at Acme',
    });
    await service.writeMemory('user-1', {
      key: 'project.deadline', type: 'project',
      description: 'Q2 deadline', value: 'Ship by 2026-06-30',
    });

    const results = await service.searchMemory('user-1', 'designer');
    expect(results.length).toBe(1);
    expect(results[0].key).toBe('user.role');
  });

  it('should delete a memory entry', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'Role', value: 'Designer',
    });

    await service.deleteMemory('user-1', 'user.role');

    await expect(service.readMemory('user-1', 'user.role')).rejects.toThrow();
  });

  it('should upsert on write', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'V1', value: 'Designer',
    });
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'V2', value: 'Senior Designer',
    });

    const entry = await service.readMemory('user-1', 'user.role');
    if (!Array.isArray(entry)) {
      expect(entry.description).toBe('V2');
      expect(entry.value).toBe('Senior Designer');
    }
  });

  it('should isolate memories between users', async () => {
    await service.writeMemory('user-1', {
      key: 'user.role', type: 'user',
      description: 'User 1 role', value: 'Designer',
    });

    const list = await service.listMemories('user-2');
    expect(list.length).toBe(0);
  });
});
