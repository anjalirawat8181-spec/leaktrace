import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { createApp } from '../src/app';
import { closePool, getPool, query } from '../src/db';

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM audit_events LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping API tests');
    return false;
  }
}

describe('API (M2)', async () => {
  if (!(await dbReachable())) {
    it.skip('needs Postgres (npm run db:up && npm run migrate)', () => {});
    return;
  }
  const app = createApp();
  const password = 'Test-Password-1';
  const agent = request.agent(app);

  beforeAll(async () => {
    await query(
      `TRUNCATE trace_results, trace_cases, downloads, copies, variation_points, paper_templates,
       generation_jobs, exams, rooms, users, centres CASCADE`,
    );
    const hash = await bcrypt.hash(password, 4);
    await query(
      `INSERT INTO users (email, password_hash, name, role) VALUES
       ('controller@test', $1, 'C', 'CONTROLLER'), ('auditor@test', $1, 'A', 'AUDITOR')`,
      [hash],
    );
  });
  afterAll(closePool);

  it('rejects unauthenticated access', async () => {
    expect((await request(app).get('/api/exams')).status).toBe(401);
  });

  it('logs in, sets an httpOnly SameSite=Strict cookie, and reports /me', async () => {
    const res = await agent.post('/api/auth/login').send({ email: 'controller@test', password });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect((await agent.get('/api/auth/me')).body.role).toBe('CONTROLLER');
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'controller@test', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('forbids the auditor from creating exams', async () => {
    const aud = request.agent(app);
    await aud.post('/api/auth/login').send({ email: 'auditor@test', password });
    const res = await aud.post('/api/exams').send({});
    expect(res.status).toBe(403);
  });

  it('enforces the 20-seat limit with 422', async () => {
    const centre = await agent.post('/api/centres').send({ code: 'T1', name: 'Test', city: 'Pune' });
    expect(centre.status).toBe(201);
    const id = centre.body.id;
    for (const name of ['R1', 'R2', 'R3', 'R4']) {
      const r = await agent.post(`/api/centres/${id}/rooms`).send({ name, seats: 5, invigilatorName: 'X' });
      expect(r.status).toBe(201);
    }
    const over = await agent.post(`/api/centres/${id}/rooms`).send({ name: 'R5', seats: 1, invigilatorName: 'X' });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatch(/maximum is 20/);
  });

  it('creates an exam, saves the seed template, and returns points + capacity', async () => {
    const exam = await agent.post('/api/exams').send({
      title: 'Cloud', subject: 'CC', startsAt: new Date(Date.now() + 3600_000).toISOString(),
      durationMin: 90,
    });
    expect(exam.status).toBe(201);
    const put = await agent.put(`/api/exams/${exam.body.id}/template`).send({ source: seedPaper });
    expect(put.status).toBe(200);
    expect(put.body.points.length).toBeGreaterThanOrEqual(12);
    expect(put.body.sufficient).toBe(true);
    expect(put.body.totalCopies).toBe(20);

    const get = await agent.get(`/api/exams/${exam.body.id}`);
    expect(get.body.template.version).toBe(1);

    const bad = await agent.put(`/api/exams/${exam.body.id}/template`).send({ source: 'x {{a|b' });
    expect(bad.status).toBe(400);

    const diff = await agent.get(`/api/exams/${exam.body.id}/spot-the-difference`);
    expect(diff.status).toBe(200);
    expect(diff.body.a.ranges.length).toBeGreaterThan(0);
    expect(diff.body.a.serial).not.toBe(diff.body.b.serial);
  });

  it('keeps audit_events append-only', async () => {
    await expect(query('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
  });
});
