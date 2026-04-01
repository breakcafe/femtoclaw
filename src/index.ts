import { createApp, type ServerDeps } from './server.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { ConversationManager } from './conversation/manager.js';
import { createConversationStore } from './conversation/store-factory.js';
import { ConversationLock } from './conversation/lock.js';
import { SkillManager } from './skills/manager.js';
import { createMemoryService } from './memory/service-factory.js';
import { McpClientPool } from './mcp/client-pool.js';

async function main(): Promise<void> {
  logger.info('Starting Femtoclaw...');
  if (!config.ANTHROPIC_API_KEY) {
    logger.warn(
      'ANTHROPIC_API_KEY is empty. Set ANTHROPIC_API_KEY (or X_API_KEY/API_KEY) to avoid auth failures.',
    );
  }

  // Initialize storage
  const conversationStore = createConversationStore();
  const conversationLock = new ConversationLock();
  const conversationManager = new ConversationManager(conversationStore, conversationLock);

  // Initialize services
  const skillManager = new SkillManager(
    config.BUILTIN_SKILLS_DIR,
    config.ORG_SKILLS_URL || undefined,
    config.USER_SKILLS_DIR,
  );
  await skillManager.loadSkills();

  const mcpClientPool = new McpClientPool();
  await mcpClientPool.init();
  const memoryService = createMemoryService(mcpClientPool);

  // Build deps
  const deps: ServerDeps = {
    conversationManager,
    skillManager,
    memoryService,
    mcpClientPool,
  };

  // Create and start server
  const app = createApp(deps);

  const server = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        model: config.DEFAULT_MODEL,
        assistant: config.ASSISTANT_NAME,
        auth: config.API_TOKEN ? 'enabled' : 'disabled',
      },
      `Femtoclaw listening on port ${config.PORT}`,
    );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    server.close();
    conversationStore.close?.();
    await mcpClientPool.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start Femtoclaw');
  process.exit(1);
});
