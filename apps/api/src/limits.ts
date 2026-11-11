import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';

export function demoLimit(name: string, limit: number, windowMs = 60_000): RequestHandler {
  let limiter: RequestHandler | undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.demoMode) return next();
    limiter ??= rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: `Too many ${name} requests on the public demo, try again in a minute` },
    });
    return limiter(req, res, next);
  };
}
