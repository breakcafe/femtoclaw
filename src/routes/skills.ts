import { Router } from 'express';
import type { ServerDeps } from '../server.js';

export function skillRoutes(deps: ServerDeps): Router {
  const router = Router();

  // GET /skills — List available skills
  router.get('/skills', (req, res) => {
    const userId = req.userContext?.userId ?? 'anonymous';
    const manifest = deps.skillManager.getSkillManifest(userId);
    res.json({ skills: manifest });
  });

  return router;
}
