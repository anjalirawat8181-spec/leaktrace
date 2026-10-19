import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalMetrics } from '@leaktrace/adapters';
import { renderTemplate, type ParsedTemplate } from '@leaktrace/fingerprint';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { getAdapters } from '../../api/src/adapters';
import { createApp } from '../../api/src/app';
import { closePool, getPool, query } from '../../api/src/db';
import { processMessage, type GenerationMessage } from '../src/process';

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM trace_cases LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping trace tests');
    return false;
  }
}

describe('trace lab (M5)', async () => {
  if (!(await dbReachable())) {
    it.skip('needs Postgres', () => {});
    return;
  }
  const server = createApp().listen(0);
  server.keepAliveTimeout = 120_000;
  const adapters = getAdapters();
  const deps = { pool: getPool(), adapters, log: () => {} };
  const metrics = adapters.metrics as LocalMetrics;
  const controller = request.agent(server);
  const auditor = request.agent(server);
  let examId = '';
  let target: any;
  let excerpt = '';

  beforeAll(async () => {
    await query(
      `TRUNCATE local_queue, local_schedules, notifications, worker_heartbeats, trace_results, trace_cases,
       downloads, copies, variation_points, paper_templates, generation_jobs, exams, rooms, users, centres CASCADE`,
    );
    const hash = await bcrypt.hash('pw-123456', 4);
    await query(
      `INSERT INTO users (email, password_hash, name, role) VALUES
       ('c@test', $1, 'Ctrl', 'CONTROLLER'), ('a@test', $1, 'Aud', 'AUDITOR')`, [hash],
    );
    await controller.post('/api/auth/login').send({ email: 'c@test', password: 'pw-123456' }).expect(200);
    await auditor.post('/api/auth/login').send({ email: 'a@test', password: 'pw-123456' }).expect(200);
    for (const code of ['A', 'B']) {
      const centre = await controller.post('/api/centres').send({ code, name: `Centre ${code}`, city: 'Pune' });
      for (const name of [`${code}-R1`, `${code}-R2`]) {
        await controller.post(`/api/centres/${centre.body.id}/rooms`)
          .send({ name, seats: 5, invigilatorName: `Inv ${name}` }).expect(201);
      }
      await query(
        "INSERT INTO users (email, password_hash, name, role, centre_id) VALUES ($1,$2,$3,'SUPERINTENDENT',$4)",
        [`s${code}@test`, hash, `Supt ${code}`, centre.body.id],
      );
    }
    const exam = await controller.post('/api/exams').send({
      title: 'Trace exam', subject: 'CC', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 60,
    });
    examId = exam.body.id;
    await controller.put(`/api/exams/${examId}/template`).send({ source: seedPaper }).expect(200);
    await controller.post(`/api/exams/${examId}/generate`).expect(202);
    for (;;) {
      const msgs = await adapters.queue.receive<GenerationMessage>('generation', { max: 10 });
      if (!msgs.length) break;
      for (const m of msgs) await processMessage(deps, m);
    }

    target = (await query(
      `SELECT c.*, ce.code AS centre_code, r.name AS room_name, r.invigilator_name FROM copies c
       JOIN centres ce ON ce.id = c.centre_id JOIN rooms r ON r.id = c.room_id
       WHERE c.exam_id=$1 AND c.serial=14`, [examId],
    ))[0];
    const [supt] = await query("SELECT id FROM users WHERE email='sB@test'");
    await query(
      `INSERT INTO downloads (exam_id, centre_id, room_id, user_id, allowed, reason)
       VALUES ($1,$2,$3,$4,true,'OK')`, [examId, target.centre_id, target.room_id, supt.id],
    );

    const [tpl] = await query('SELECT parsed FROM paper_templates WHERE exam_id=$1', [examId]);
    const text = renderTemplate(tpl.parsed as ParsedTemplate, target.choice_vector);
    const paragraphs = text.split(/\n\n/).filter((p) => /^\d+\./.test(p.trim())).slice(0, 3);
    excerpt = paragraphs.join('\n\n')
      .replace('storage', 'storge')
      .replace('Amazon', 'Amazn');
  });
  afterAll(async () => {
    server.close();
    await closePool();
  });

  it('names the leaking copy, centre, room, seat and invigilator, and raises one leak alert', async () => {
    const created = await controller.post('/api/trace/cases').send({ examId, title: 'Telegram leak', leakText: excerpt }).expect(201);
    const caseId = created.body.id;
    expect(created.body.status).toBe('OPEN');

    const run = await controller.post(`/api/trace/cases/${caseId}/run`).expect(200);
    expect(run.body.status).toBe('IDENTIFIED');
    expect(run.body.case.status).toBe('IDENTIFIED');
    expect(run.body.top).toMatchObject({
      serial: 14, seat: target.seat_no, room: target.room_name, invigilator: target.invigilator_name,
    });
    expect(run.body.top.centre.code).toBe(target.centre_code);
    expect(run.body.top.downloadedBy[0].by).toBe('Supt B');
    expect(run.body.coincidence.oneIn).toBeGreaterThan(1000);
    expect(run.body.candidates.length).toBeLessThanOrEqual(5);
    const agreeing = run.body.evidence.filter((e: any) => e.agrees);
    expect(agreeing.length).toBeGreaterThanOrEqual(run.body.evidence.length - 1);
    for (const e of run.body.evidence) {
      expect(e.position.start).toBeGreaterThanOrEqual(0);
      expect(e.position.end).toBeLessThanOrEqual(excerpt.length);
      expect(e.position.end).toBeGreaterThan(e.position.start);
    }

    const rows = await query('SELECT rank, copy_id FROM trace_results WHERE case_id=$1 ORDER BY rank', [caseId]);
    expect(rows[0].copy_id).toBe(target.id);

    const alerts = await query("SELECT subject, body FROM notifications WHERE topic='leak-alerts'");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe('LEAK TRACED: Trace exam');
    expect(alerts[0].body).toContain('Copy serial: 14');
    expect(alerts[0].body).toContain(`Seat: ${target.seat_no}`);
    expect(alerts[0].body).toContain('Supt B');
    expect(alerts[0].body).toMatch(/1 in [\d,]+/);
    expect(metrics.counters.get('LeaksIdentified')).toBe(1);

    await controller.post(`/api/trace/cases/${caseId}/run`).expect(200);
    expect(await query("SELECT 1 FROM notifications WHERE topic='leak-alerts'")).toHaveLength(1);
    expect(metrics.counters.get('TraceRuns')).toBe(2);

    const read = await auditor.get(`/api/trace/cases/${caseId}`).expect(200);
    expect(read.body.top.serial).toBe(14);
    await auditor.post(`/api/trace/cases/${caseId}/run`).expect(403);
    await auditor.post('/api/trace/cases').send({ examId, title: 'x', leakText: 'y' }).expect(403);
  });

  it('returns INSUFFICIENT for a one-line excerpt and raises no alert', async () => {
    const oneLine = excerpt.split('\n')[0].slice(0, 120);
    const created = await controller.post('/api/trace/cases').send({ examId, title: 'One line', leakText: oneLine });
    const run = await controller.post(`/api/trace/cases/${created.body.id}/run`).expect(200);
    expect(run.body.status).toBe('INSUFFICIENT');
    expect(run.body.case.status).toBe('INCONCLUSIVE');
    expect(await query("SELECT 1 FROM notifications WHERE topic='leak-alerts'")).toHaveLength(1);
  });

  it('re-checks the evidence photo hash on the server', async () => {
    const photo = Buffer.from('fake-png-bytes');
    const sha = createHash('sha256').update(photo).digest('hex');
    const created = await controller.post('/api/trace/cases').send({ examId, title: 'With photo', leakText: excerpt });
    const id = created.body.id;

    const reg = await controller.post(`/api/trace/cases/${id}/evidence-url`).send({ sha256: sha, contentType: 'image/png' }).expect(200);
    await controller.post(`/api/trace/cases/${id}/run`).expect(422);

    await request(server).put(reg.body.url).set('Content-Type', 'image/png').send(photo).expect(204);
    await controller.post(`/api/trace/cases/${id}/run`).expect(200);

    const wrong = createHash('sha256').update('something else').digest('hex');
    await controller.post(`/api/trace/cases/${id}/evidence-url`).send({ sha256: wrong, contentType: 'image/png' }).expect(200);
    const bad = await controller.post(`/api/trace/cases/${id}/run`);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/hash mismatch/i);

    await controller.post(`/api/trace/cases/${id}/evidence-url`).send({ sha256: sha, contentType: 'application/pdf' }).expect(400);
  });
});
