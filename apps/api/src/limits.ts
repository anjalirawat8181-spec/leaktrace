import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';

const GLOBAL_FACTOR = 5;

export function demoLimit(name: string, limit: number, windowMs = 60_000): RequestHandler {
  const message = { error: `Too many ${name} requests on the public demo, try again in a minute` };
  const perClient = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message,
  });
  const everyone = rateLimit({
    windowMs,
    limit: limit * GLOBAL_FACTOR,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: () => 'all-visitors',
    message,
  });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.demoMode) return next();
    return perClient(req, res, (err?: unknown) => (err ? next(err) : everyone(req, res, next)));
  };
}
