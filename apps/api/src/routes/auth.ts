import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { loginSchema } from '@leaktrace/shared';
import { COOKIE_NAME, clientIp, requireAuth, signSession } from '../auth';
import { audit, query } from '../db';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.LOGIN_RATE_LIMIT ?? 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again in a minute' },
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { email, password } = parsed.data;
  const rows = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !ok) {
    await audit(user?.id ?? null, 'LOGIN_FAILED', 'user', user?.id ?? null, {
      email,
      ip: clientIp(req),
    });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.cookie(COOKIE_NAME, signSession(user.id), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 3600 * 1000,
  });
  await audit(user.id, 'LOGIN', 'user', user.id, { ip: clientIp(req) });
  res.json({
    id: user.id, email: user.email, name: user.name, role: user.role, centreId: user.centre_id,
  });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});
