import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { UserContext } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Token-based auth when API_TOKEN is configured
  if (config.API_TOKEN) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== config.API_TOKEN) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
  }

  // User identity from X-User-Id header
  const rawUserId = req.headers['x-user-id'] as string | undefined;

  if (!rawUserId && config.REQUIRE_USER_ID) {
    res.status(400).json({
      error: 'X-User-Id header is required',
      hint: 'Set REQUIRE_USER_ID=false to allow anonymous access',
    });
    return;
  }

  req.userContext = {
    userId: rawUserId ?? 'anonymous',
    displayName: req.headers['x-user-name'] as string,
    timezone: req.headers['x-timezone'] as string,
    locale: req.headers['x-locale'] as string,
  };
  next();
}
