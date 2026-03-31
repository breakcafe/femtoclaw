import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? `req-${randomUUID()}`;
  res.setHeader('X-Request-ID', requestId);
  next();
}
