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
  // No token configured — auth disabled
  if (!config.API_TOKEN) {
    req.userContext = {
      userId: (req.headers['x-user-id'] as string) ?? 'anonymous',
      displayName: req.headers['x-user-name'] as string,
      timezone: req.headers['x-timezone'] as string,
      locale: req.headers['x-locale'] as string,
    };
    next();
    return;
  }

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

  req.userContext = {
    userId: (req.headers['x-user-id'] as string) ?? 'default',
    displayName: req.headers['x-user-name'] as string,
    timezone: req.headers['x-timezone'] as string,
    locale: req.headers['x-locale'] as string,
  };
  next();
}
