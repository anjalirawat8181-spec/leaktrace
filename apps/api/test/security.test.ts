import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Must be set before the app (and its rate limiter) is imported.
process.env.LOGIN_RATE_LIMIT = '5';
delete process.env.TRUST_PROXY;

async function dbReachable(getPool: () => { query: (q: string) => Promise<unknown> }): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM audit_events LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping security tests');
    return false;
  }
}

describe('security (M6)', async () => {
  const { createApp } = await import('../src/app');
  const { closePool, getPool, query } = await import('../src/db');
  if (!(await dbReachable(getPool))) {
    it.skip('needs Postgres', () => {});
    return;
  }
  const password = 'Test-Password-1';

  beforeAll(async () => {
    await query(
      `TRUNCATE trace_results, trace_cases, downloads, copies, variation_points, paper_templates,
       generation_jobs, exams, rooms, users, centres CASCADE`,
    );
    await query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ('c@test', $1, 'C', 'CONTROLLER')",
      [await bcrypt.hash(password, 4)],
    );
  });
  afterAll(closePool);

  it('rate-limits login to 5 attempts per minute per IP', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'c@test', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'c@test', password });
    expect(blocked.status).toBe(429);
  });

  it('uses the first X-Forwarded-For address only when trust proxy is on', async () => {
    process.env.TRUST_PROXY = 'true';
    const trusted = createApp();
    const res = await request(trusted)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.9, 10.0.0.1')
      .send({ email: 'c@test', password });
    expect(res.status).toBe(200);
    const [login] = await query("SELECT details FROM audit_events WHERE action='LOGIN' ORDER BY at DESC LIMIT 1");
    expect(login.details.ip).toBe('203.0.113.9');

    process.env.TRUST_PROXY = 'false';
    const untrusted = createApp();
    await request(untrusted)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ email: 'c@test', password: 'wrong' });
    const [failed] = await query("SELECT details FROM audit_events WHERE action='LOGIN_FAILED' ORDER BY at DESC LIMIT 1");
    expect(failed.details.ip).not.toBe('198.51.100.7');
  });

  it('sets security headers and returns JSON 404s for unknown API routes', async () => {
    const app = createApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
