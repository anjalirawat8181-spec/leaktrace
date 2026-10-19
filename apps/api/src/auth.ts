import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, SessionUser } from '@leaktrace/shared';
import { config } from './config';
import { query } from './db';

export const COOKIE_NAME = 'lt_session';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '8h' });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const rows = await query(
      'SELECT id, email, name, role, centre_id FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!rows[0]) return res.status(401).json({ error: 'Not signed in' });
    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      role: rows[0].role,
      centreId: rows[0].centre_id,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

export function clientIp(req: Request): string | undefined {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress;
}
