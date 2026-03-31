import express, { type Request, type Response, type NextFunction } from 'express';
import { requestIdMiddleware } from './middleware/request-id.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { skillRoutes } from './routes/skills.js';
import { adminRoutes } from './routes/admin.js';
import { logger } from './utils/logger.js';
import type { ConversationManager } from './conversation/manager.js';
import type { SkillManagerInterface, MemoryServiceInterface } from './types.js';
import type { McpClientPool } from './mcp/client-pool.js';

const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const BUILD_COMMIT = process.env.BUILD_COMMIT || 'unknown';

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

  // Build metadata headers on every response
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Build-Version', APP_VERSION);
    res.setHeader('X-Build-Commit', BUILD_COMMIT);
    next();
  });

  // Per-request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const entry = {
        requestId: res.getHeader('X-Request-ID'),
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      };
      const isHealthProbe = req.originalUrl === '/health';
      if (res.statusCode >= 500) {
        logger.warn(entry, 'Request completed');
      } else if (isHealthProbe) {
        logger.debug(entry, 'Request completed');
      } else {
        logger.info(entry, 'Request completed');
      }
    });
    next();
  });

  // Health check (no auth)
  app.use(healthRoutes());

  // Auth + rate limit on all other routes
  app.use(authMiddleware);
  app.use(rateLimitMiddleware);

  // API routes
  app.use(chatRoutes(deps));
  app.use(skillRoutes(deps));
  app.use(adminRoutes(deps));

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}
