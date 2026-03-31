import { config } from '../config.js';
import { SqliteMemoryService } from './sqlite-backend.js';
import { ApiMemoryService } from './api-backend.js';
import type { MemoryServiceInterface } from '../types.js';
import { logger } from '../utils/logger.js';

export function createMemoryService(): MemoryServiceInterface {
  switch (config.MEMORY_SERVICE_TYPE) {
    case 'api': {
      if (!config.MEMORY_SERVICE_URL) {
        throw new Error('MEMORY_SERVICE_URL required for api memory service');
      }
      logger.info({ url: config.MEMORY_SERVICE_URL }, 'Using API memory service');
      return new ApiMemoryService(config.MEMORY_SERVICE_URL, config.MEMORY_SERVICE_API_KEY);
    }
    case 'sqlite':
    default: {
      logger.info({ path: config.SQLITE_DB_PATH }, 'Using SQLite memory service');
      return new SqliteMemoryService(config.SQLITE_DB_PATH);
    }
  }
}
