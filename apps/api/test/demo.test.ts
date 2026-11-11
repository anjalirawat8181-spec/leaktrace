import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { createApp } from '../src/app';
import { closePool, getPool, query } from '../src/db';

async function ready(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM app_state LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping demo tests');
    return false;
  }
}

describe('public demo mode', async () => {
  if (!(await ready())) {
    it.skip('needs Postgres (npm run db:up && npm run db:test)', () => {});
    return;
  }
  const app = createApp();
  const TOKEN = 'reset-token-for-tests-only-0123456789';

  beforeAll(async () => {
    await query(
      `TRUNCATE trace_results, trace_cases, downloads, copies, variation_points, paper_templates,
       generation_jobs, exams, rooms, users, centres, local_queue, notifications CASCADE`,
    );
    const hash = await bcrypt.hash('unused-password-1', 4);
    const [centre] = await query("INSERT INTO centres (code, name, city) VALUES ('C1','North','Pune') RETURNING id");
    await query("INSERT INTO rooms (centre_id, name, seats, invigilator_name) VALUES ($1,'C1-Room 1',5,'A. Sharma')", [centre.id]);
    await query(
      `INSERT INTO users (email, password_hash, name, role, centre_id) VALUES
       ('controller@demo', $1, 'Controller Demo', 'CONTROLLER', NULL),
       ('supt.c1@demo', $1, 'Superintendent C1', 'SUPERINTENDENT', $2),
       ('auditor@demo', $1, 'Auditor Demo', 'AUDITOR', NULL)`,
      [hash, centre.id],
    );
  });
  afterAll(async () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_RESET_TOKEN;
    await closePool();
  });

  it('is switched off by default', async () => {
    delete process.env.DEMO_MODE;
    expect((await request(app).get('/api/auth/demo-config')).body).toEqual({ demo: false });
    expect((await request(app).post('/api/auth/demo-login').send({ role: 'controller' })).status).toBe(404);
    expect((await request(app).post('/api/admin/reset-demo')).status).toBe(404);
  });

  it('signs visitors in as the seeded users with one click', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await request(app).get('/api/auth/demo-config')).body).toEqual({ demo: true });
    for (const [role, expected] of [['controller', 'CONTROLLER'], ['superintendent', 'SUPERINTENDENT'], ['auditor', 'AUDITOR']]) {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/demo-login').send({ role });
      expect(res.status).toBe(200);
      expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
      expect((await agent.get('/api/auth/me')).body.role).toBe(expected);
    }
  });

  it('rejects roles that are not demo roles', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await request(app).post('/api/auth/demo-login').send({ role: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/auth/demo-login').send({ role: '__proto__' })).status).toBe(400);
    expect((await request(app).post('/api/auth/demo-login').send({})).status).toBe(400);
  });

  it('protects the reset endpoint with a bearer token', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_RESET_TOKEN = TOKEN;
    expect((await request(app).post('/api/admin/reset-demo')).status).toBe(401);
    expect((await request(app).post('/api/admin/reset-demo').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).post('/api/admin/reset-demo').set('Authorization', TOKEN)).status).toBe(401);
  });

  it('wipes and reseeds the demo data', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_RESET_TOKEN = TOKEN;
    await query("INSERT INTO exams (title, subject, starts_at, duration_min, created_by) SELECT 'Visitor exam','X',now(),60,id FROM users LIMIT 1");
    await query("INSERT INTO audit_events (action, entity, at) VALUES ('BEFORE_RESET_MARKER','test', now() - interval '1 hour')");

    const res = await request(app).post('/api/admin/reset-demo').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);

    const exams = await query('SELECT title, status FROM exams ORDER BY title');
    expect(exams.map((e) => e.title)).toEqual(['Cloud Computing Unit Test 1', 'Operating Systems Midterm (try me)']);
    expect(exams.find((e) => e.title.startsWith('Cloud'))!.status).toBe('RELEASED');
    expect(exams.find((e) => e.title.startsWith('Operating'))!.status).toBe('DRAFT');

    const [{ copies }] = await query('SELECT count(*)::int AS copies FROM copies');
    expect(copies).toBe(5);
    const [traceCase] = await query('SELECT status FROM trace_cases');
    expect(traceCase.status).toBe('IDENTIFIED');
    const [{ queued }] = await query("SELECT count(*)::int AS queued FROM local_queue WHERE queue='generation'");
    expect(queued).toBeGreaterThan(0);

    const agent = request.agent(app);
    await agent.post('/api/auth/demo-login').send({ role: 'auditor' });
    const log = (await agent.get('/api/audit')).body as Array<{ action: string }>;
    expect(log.some((e) => e.action === 'LEAK_IDENTIFIED')).toBe(true);
    expect(log.some((e) => e.action === 'DOWNLOAD_DENIED')).toBe(true);
    expect(log.some((e) => e.action === 'BEFORE_RESET_MARKER')).toBe(false);
  });

  it('keeps the audit trail append-only through a reset', async () => {
    await expect(query("DELETE FROM audit_events WHERE action='BEFORE_RESET_MARKER'")).rejects.toThrow(/append-only/);
    const [{ n }] = await query("SELECT count(*)::int AS n FROM audit_events WHERE action='BEFORE_RESET_MARKER'");
    expect(n).toBe(1);
  });

  it('caps paper length, exam count and upload size', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_MAX_PAPER_CHARS = '100';
    process.env.DEMO_MAX_EXAMS = '2';
    const agent = request.agent(app);
    await agent.post('/api/auth/demo-login').send({ role: 'controller' });
    const [draft] = await query("SELECT id FROM exams WHERE status='DRAFT' LIMIT 1");

    const tooLong = await agent.put(`/api/exams/${draft.id}/template`).send({ source: seedPaper });
    expect(tooLong.status).toBe(413);

    const full = await agent.post('/api/exams').send({
      title: 'One too many', subject: 'S', startsAt: new Date(Date.now() + 86400000).toISOString(),
      durationMin: 60, releaseLeadMin: 15, closeAfterMin: 30,
    });
    expect(full.status).toBe(429);

    const [traceCase] = await query('SELECT id FROM trace_cases LIMIT 1');
    const sha256 = 'a'.repeat(64);
    const noSize = await agent.post(`/api/trace/cases/${traceCase.id}/evidence-url`).send({ sha256, contentType: 'image/png' });
    expect(noSize.status).toBe(413);
    const huge = await agent.post(`/api/trace/cases/${traceCase.id}/evidence-url`).send({ sha256, contentType: 'image/png', bytes: 50_000_000 });
    expect(huge.status).toBe(413);
    const fine = await agent.post(`/api/trace/cases/${traceCase.id}/evidence-url`).send({ sha256, contentType: 'image/png', bytes: 1000 });
    expect(fine.status).toBe(200);
    delete process.env.DEMO_MAX_PAPER_CHARS;
    delete process.env.DEMO_MAX_EXAMS;
  });

  it('ignores a spoofed X-Forwarded-For unless proxies are trusted, and honours a hop count', async () => {
    process.env.DEMO_MODE = 'true';
    delete process.env.TRUST_PROXY;
    const plain = createApp();
    await request(plain).post('/api/auth/demo-login').set('X-Forwarded-For', '203.0.113.9').send({ role: 'auditor' });
    const [first] = await query("SELECT details->>'ip' AS ip FROM audit_events WHERE details->>'demo'='true' ORDER BY at DESC LIMIT 1");
    expect(first.ip).not.toContain('203.0.113.9');

    process.env.TRUST_PROXY = '2';
    const behind = createApp();
    const hop = await request(behind).post('/api/auth/demo-login').set('X-Forwarded-For', '203.0.113.9, 198.51.100.7').send({ role: 'auditor' });
    expect(hop.status).toBe(200);
    const [second] = await query("SELECT details->>'ip' AS ip FROM audit_events WHERE details->>'demo'='true' ORDER BY at DESC LIMIT 1");
    expect(second.ip).toBe('203.0.113.9');
    delete process.env.TRUST_PROXY;
  });

  it('rate limits generation on the public demo', async () => {
    process.env.DEMO_MODE = 'true';
    const agent = request.agent(app);
    await agent.post('/api/auth/demo-login').send({ role: 'controller' });
    const [draft] = await query("SELECT id FROM exams WHERE status='DRAFT' LIMIT 1");
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await agent.post(`/api/exams/${draft.id}/generate`)).status);
    expect(codes).toContain(429);
  });
});
