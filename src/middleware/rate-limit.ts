import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const userLimits = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of userLimits) {
      if (entry.resetAt <= now) {
        userLimits.delete(key);
      }
    }
  },
  5 * 60 * 1000,
).unref();

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (config.RATE_LIMIT_RPM <= 0) {
    next();
    return;
  }

  const userId = req.userContext?.userId ?? 'anonymous';
  const now = Date.now();
  const windowMs = 60_000; // 1 minute

  let entry = userLimits.get(userId);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    userLimits.set(userId, entry);
  }

  entry.count++;

  res.setHeader('X-RateLimit-Limit', config.RATE_LIMIT_RPM);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, config.RATE_LIMIT_RPM - entry.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.count > config.RATE_LIMIT_RPM) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retry_after_ms: entry.resetAt - now,
    });
    return;
  }

  next();
}
