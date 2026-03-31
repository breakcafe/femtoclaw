import { config } from '../config.js';
import { SqliteConversationStore } from './sqlite-store.js';
import { ApiConversationStore } from './api-store.js';
import type { ConversationStore } from './store.js';
import { logger } from '../utils/logger.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function createConversationStore(): ConversationStore & { close?: () => void } {
  switch (config.CONVERSATION_STORE_TYPE) {
    case 'api': {
      if (!config.CONVERSATION_STORE_URL) {
        throw new Error('CONVERSATION_STORE_URL required for api store type');
      }
      logger.info({ url: config.CONVERSATION_STORE_URL }, 'Using API conversation store');
      return new ApiConversationStore(
        config.CONVERSATION_STORE_URL,
        config.CONVERSATION_STORE_API_KEY,
      );
    }
    case 'sqlite':
    default: {
      const dbPath = config.SQLITE_DB_PATH;
      mkdirSync(dirname(dbPath), { recursive: true });
      logger.info({ path: dbPath }, 'Using SQLite conversation store');
      return new SqliteConversationStore(dbPath);
    }
  }
}
