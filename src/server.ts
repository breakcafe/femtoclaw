import express from 'express';
import { requestIdMiddleware } from './middleware/request-id.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { skillRoutes } from './routes/skills.js';
import { adminRoutes } from './routes/admin.js';
import type { ConversationManager } from './conversation/manager.js';
import type { SkillManagerInterface, MemoryServiceInterface } from './types.js';
import type { McpClientPool } from './mcp/client-pool.js';

export interface ServerDeps {
  conversationManager: ConversationManager;
  skillManager: SkillManagerInterface;
  memoryService: MemoryServiceInterface;
  mcpClientPool: McpClientPool;
}

export function createApp(deps: ServerDeps): express.Express {
  const app = express();

  // Body parsing
  app.use(express.json({ limit: '1mb' }));

  // Request ID on all routes
  app.use(requestIdMiddleware);

  // Health check (no auth)
  app.use(healthRoutes());

  // Auth + rate limit on all other routes
  app.use(authMiddleware);
  app.use(rateLimitMiddleware);

  // API routes
  app.use(chatRoutes(deps));
  app.use(skillRoutes(deps));
  app.use(adminRoutes(deps));

  // Error handler
  app.use(errorHandler);

  return app;
}
