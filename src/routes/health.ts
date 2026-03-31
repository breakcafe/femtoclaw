import { Router } from 'express';
import { config } from '../config.js';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      assistant_name: config.ASSISTANT_NAME,
      max_execution_ms: config.MAX_EXECUTION_MS,
      model: config.DEFAULT_MODEL,
    });
  });

  return router;
}
