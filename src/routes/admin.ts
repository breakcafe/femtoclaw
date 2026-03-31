import { Router } from 'express';
import type { ServerDeps } from '../server.js';
import { SkillManager } from '../skills/manager.js';

export function adminRoutes(deps: ServerDeps): Router {
  const router = Router();

  // POST /admin/reload-skills — Reload skills from all tiers
  router.post('/admin/reload-skills', async (_req, res) => {
    const manager = deps.skillManager;
    if (manager instanceof SkillManager) {
      await manager.loadSkills();
      const skills = manager.getSkillManifest();
      res.json({ status: 'reloaded', skills });
    } else {
      res.json({ status: 'ok', message: 'Skill manager does not support reload' });
    }
  });

  return router;
}
