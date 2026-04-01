import { Router } from 'express';
import { config } from '../config.js';

const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const BUILD_COMMIT = process.env.BUILD_COMMIT || 'unknown';
const BUILD_TIME = process.env.BUILD_TIME || 'unknown';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      engine: 'femtoclaw',
      version: APP_VERSION,
      runtime: process.env.FEMTOCLAW_RUNTIME || ('Bun' in globalThis ? 'bun' : 'node'),
      commit: BUILD_COMMIT,
      build_time: BUILD_TIME,
      assistant_name: config.ASSISTANT_NAME,
      max_execution_ms: config.MAX_EXECUTION_MS,
      model: config.DEFAULT_MODEL,
    });
  });

  return router;
}
