import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalMetrics, LocalScheduler, localIsoToUtc } from '@leaktrace/adapters';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { getAdapters } from '../../api/src/adapters';
import { createApp } from '../../api/src/app';
import { closePool, getPool, query } from '../../api/src/db';
import { consumeExamEvents } from '../../api/src/events';
import { setClock, wallClockIso } from '../../api/src/time';
import { processMessage, type GenerationMessage } from '../src/process';

const ist = (minutesAhead: number) => wallClockIso(new Date(Date.now() + minutesAhead * 60_000)).slice(0, 16);
const IST = 'Asia/Kolkata';

async function fetchBinary(server: any, path: string, cookie = '') {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { cookie } });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()) };
}

async function cookieFor(server: any, email: string, password: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM local_schedules LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping release tests');
    return false;
  }
}

describe('release window (M4)', async () => {
  if (!(await dbReachable())) {
    it.skip('needs Postgres', () => {});
    return;
  }
  const server = createApp().listen(0);
  server.keepAliveTimeout = 120_000;
  const adapters = getAdapters();
  const deps = { pool: getPool(), adapters, log: () => {} };
  const metrics = adapters.metrics as LocalMetrics;
  const scheduler = adapters.scheduler as LocalScheduler;
  const controller = request.agent(server);
  const suptA = request.agent(server);
  const suptB = request.agent(server);
  const auditor = request.agent(server);
  const centreIds: Record<string, string> = {};

  const drain = async () => {
    for (;;) {
      const msgs = await adapters.queue.receive<GenerationMessage>('generation', { max: 10 });
      if (!msgs.length) return;
      for (const m of msgs) await processMessage(deps, m);
    }
  };
  const readyExam = async (title: string, startsInMin: number) => {
    const exam = await controller.post('/api/exams').send({
      title, subject: 'CC', startsAt: new Date(Date.now() + startsInMin * 60_000).toISOString(), durationMin: 60,
    });
    const id = exam.body.id;
    await controller.put(`/api/exams/${id}/template`).send({ source: seedPaper }).expect(200);
    await controller.post(`/api/exams/${id}/generate`).expect(202);
    await drain();
    return id as string;
  };

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
    for (const code of ['A', 'B']) {
      const centre = await controller.post('/api/centres').send({ code, name: `Centre ${code}`, city: 'Pune' });
      centreIds[code] = centre.body.id;
      for (const name of [`${code}-R1`, `${code}-R2`]) {
        await controller.post(`/api/centres/${centre.body.id}/rooms`)
          .send({ name, seats: 5, invigilatorName: 'Inv' }).expect(201);
      }
      await query(
        "INSERT INTO users (email, password_hash, name, role, centre_id) VALUES ($1,$2,$3,'SUPERINTENDENT',$4)",
        [`s${code}@test`, hash, `Supt ${code}`, centre.body.id],
      );
    }
    await suptA.post('/api/auth/login').send({ email: 'sA@test', password: 'pw-123456' }).expect(200);
    await suptB.post('/api/auth/login').send({ email: 'sB@test', password: 'pw-123456' }).expect(200);
    await auditor.post('/api/auth/login').send({ email: 'a@test', password: 'pw-123456' }).expect(200);
  });
  afterAll(async () => {
    setClock(null);
    server.close();
    await closePool();
  });

  it('schedules release and close with the documented names and times', async () => {
    const id = await readyExam('Early exam', 120);
    const when = { releaseAt: ist(90), closeAt: ist(150) };
    const res = await controller.post(`/api/exams/${id}/schedule`).send(when).expect(200);
    expect(res.body.release.name).toBe(`leaktrace-release-${id}`);
    expect(res.body.close.name).toBe(`leaktrace-close-${id}`);

    const exam = (await query('SELECT * FROM exams WHERE id=$1', [id]))[0];
    expect(exam.status).toBe('SCHEDULED');
    const rows = await query('SELECT name, fire_at, payload FROM local_schedules ORDER BY fire_at');
    expect(rows.map((r) => r.name)).toEqual([`leaktrace-release-${id}`, `leaktrace-close-${id}`]);
    expect(new Date(rows[0].fire_at).getTime()).toBe(localIsoToUtc(when.releaseAt, IST).getTime());
    expect(new Date(rows[1].fire_at).getTime()).toBe(localIsoToUtc(when.closeAt, IST).getTime());
    expect(new Date(exam.release_at).getTime()).toBe(localIsoToUtc(when.releaseAt, IST).getTime());
    expect(new Date(exam.close_at).getTime()).toBe(localIsoToUtc(when.closeAt, IST).getTime());
    expect(rows[0].payload).toEqual({ type: 'RELEASE', examId: id });

    expect(await scheduler.fireDue()).toBe(0);

    const before = metrics.counters.get('DownloadsOutsideWindow') ?? 0;
    const denied = await suptA.post(`/api/centre/exams/${id}/download`).send({});
    expect(denied.status).toBe(403);
    expect(denied.body.reason).toBe('TOO_EARLY');
    const row = (await query('SELECT * FROM downloads WHERE exam_id=$1', [id]))[0];
    expect(row).toMatchObject({ allowed: false, reason: 'TOO_EARLY' });
    expect(metrics.counters.get('DownloadsOutsideWindow')).toBe(before + 1);
    const alerts = await query("SELECT * FROM notifications WHERE topic='ops-alerts'");
    expect(alerts).toHaveLength(1);

    const feed = await auditor.get('/api/audit').query({ examId: id }).expect(200);
    expect(feed.body.find((e: any) => e.action === 'DOWNLOAD_DENIED')).toMatchObject({ denied: true });
    const filtered = await auditor.get('/api/audit').query({ examId: id, type: 'EXAM_SCHEDULED' }).expect(200);
    expect(filtered.body.every((e: any) => e.action === 'EXAM_SCHEDULED')).toBe(true);
  });

  it('releases via the scheduler and exam-events consumer, then serves only the own centre', async () => {
    await query("DELETE FROM local_schedules");
    const id = await readyExam('Live exam', 5);
    await controller.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(2), closeAt: ist(40) }).expect(200);
    const locked = await suptA.get('/api/centre/exams').expect(200);
    expect(locked.body.exams.find((e: any) => e.id === id)).toMatchObject({ state: 'LOCKED', windowState: 'BEFORE' });

    await query("UPDATE exams SET release_at = now() - interval '1 minute' WHERE id=$1", [id]);
    await query("UPDATE local_schedules SET fire_at = now() - interval '1 second' WHERE name LIKE 'leaktrace-release-%'");
    expect(await scheduler.fireDue()).toBe(1);
    expect(await consumeExamEvents(adapters)).toBe(1);
    expect((await query('SELECT status FROM exams WHERE id=$1', [id]))[0].status).toBe('RELEASED');
    const notices = await query("SELECT subject FROM notifications WHERE topic='release-notices'");
    expect(notices.map((n) => n.subject)).toContain('PAPER RELEASED: Live exam');

    const list = await suptA.get('/api/centre/exams').expect(200);
    expect(list.body.exams.find((e: any) => e.id === id)).toMatchObject({ windowState: 'OPEN', status: 'RELEASED', state: 'OPEN' });
    expect(list.body.exams[0].rooms.map((r: any) => r.name)).toEqual(['A-R1', 'A-R2']);

    const ok = await suptA.post(`/api/centre/exams/${id}/download`).send({}).expect(200);
    expect(ok.body.rooms.map((r: any) => r.room)).toEqual(['A-R1', 'A-R2']);
    const pdf = await fetchBinary(server, ok.body.rooms[0].url);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(await query("SELECT 1 FROM downloads WHERE exam_id=$1 AND allowed AND reason='OK'", [id])).toHaveLength(2);

    const b = await suptB.post(`/api/centre/exams/${id}/download`).send({}).expect(200);
    expect(b.body.rooms.map((r: any) => r.room)).toEqual(['B-R1', 'B-R2']);

    const wrong = await suptA.post(`/api/centre/exams/${id}/download`).send({ centreId: centreIds.B });
    expect(wrong.status).toBe(403);
    expect(wrong.body.reason).toBe('WRONG_CENTRE');

    await auditor.post(`/api/centre/exams/${id}/download`).send({}).expect(403);
    await controller.post(`/api/centre/exams/${id}/download`).send({}).expect(403);

    setClock(() => new Date(Date.now() + 2 * 3600_000));
    const late = await suptA.post(`/api/centre/exams/${id}/download`).send({});
    setClock(null);
    expect(late.status).toBe(403);
    expect(late.body.reason).toBe('CLOSED');
  });

  it('closes the exam from the CLOSE event', async () => {
    const [{ id }] = await query("SELECT id FROM exams WHERE title='Live exam'");
    await query("UPDATE local_schedules SET fire_at = now() - interval '1 minute' WHERE name LIKE 'leaktrace-close-%'");
    await scheduler.fireDue();
    await consumeExamEvents(adapters);
    expect((await query('SELECT status FROM exams WHERE id=$1', [id]))[0].status).toBe('CLOSED');
    const denied = await suptA.post(`/api/centre/exams/${id}/download`).send({});
    expect(denied.body.reason).toBe('CLOSED');
  });

  it('rejects schedules that do not make sense, in plain words', async () => {
    const id = await readyExam('Bad times', 120);
    const post = (body: object) => controller.post(`/api/exams/${id}/schedule`).send(body);
    expect((await post({})).status).toBe(400);
    expect((await post({ releaseAt: 'soon', closeAt: ist(60) })).status).toBe(400);
    const past = await post({ releaseAt: ist(-10), closeAt: ist(60) });
    expect(past.status).toBe(422);
    expect(past.body.error).toMatch(/at least 1 minute from now/);
    const backwards = await post({ releaseAt: ist(30), closeAt: ist(20) });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error).toMatch(/after the release time/);
    expect((await query('SELECT status FROM exams WHERE id=$1', [id]))[0].status).toBe('READY');
    await auditor.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(30), closeAt: ist(60) }).expect(403);
  });

  it('shows a superintendent only exams for their own centre, and closed ones for 24 hours', async () => {
    const id = await readyExam('Window exam', 120);
    await controller.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(10), closeAt: ist(60) }).expect(200);
    const idle = await suptA.get('/api/centre/exams').expect(200);
    expect(idle.body.exams.find((e: any) => e.id === id)).toMatchObject({ state: 'LOCKED' });

    await query("UPDATE exams SET status='CLOSED', release_at = now() - interval '25 hours', close_at = now() - interval '23 hours' WHERE id=$1", [id]);
    const recent = await suptA.get('/api/centre/exams').expect(200);
    expect(recent.body.exams.find((e: any) => e.id === id)).toMatchObject({ state: 'CLOSED' });

    await query("UPDATE exams SET close_at = now() - interval '25 hours' WHERE id=$1", [id]);
    const old = await suptA.get('/api/centre/exams').expect(200);
    expect(old.body.exams.find((e: any) => e.id === id)).toBeUndefined();

    const hash = await bcrypt.hash('pw-123456', 4);
    const empty = await controller.post('/api/centres').send({ code: 'C', name: 'Centre C', city: 'Pune' }).expect(201);
    await query(
      "INSERT INTO users (email, password_hash, name, role, centre_id) VALUES ('sC@test',$1,'Supt C','SUPERINTENDENT',$2)",
      [hash, empty.body.id],
    );
    const suptC = request.agent(server);
    await suptC.post('/api/auth/login').send({ email: 'sC@test', password: 'pw-123456' }).expect(200);
    await query("UPDATE exams SET close_at = now() + interval '1 hour' WHERE id=$1", [id]);
    const none = await suptC.get('/api/centre/exams').expect(200);
    expect(none.body.exams).toEqual([]);
  });

  it('deletes an exam everywhere but keeps the audit history', async () => {
    const id = await readyExam('Doomed exam', 120);
    await controller.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(5), closeAt: ist(60) }).expect(200);
    await query("UPDATE exams SET release_at = now() - interval '1 minute' WHERE id=$1", [id]);
    await query("UPDATE local_schedules SET fire_at = now() - interval '1 second' WHERE name = $1", [`leaktrace-release-${id}`]);
    await scheduler.fireDue();
    await consumeExamEvents(adapters);
    await suptA.post(`/api/centre/exams/${id}/download`).send({}).expect(200);
    const keys = (await query('SELECT DISTINCT storage_key FROM copies WHERE exam_id=$1', [id])).map((r) => r.storage_key);
    expect(keys).toHaveLength(4);
    for (const key of keys) expect(await adapters.storage.exists(key)).toBe(true);
    await controller.post('/api/trace/cases').send({ examId: id, title: 'case', leakText: 'some leaked text' }).expect(201);
    const downloadsBefore = (await query('SELECT count(*)::int AS n FROM downloads WHERE exam_id=$1', [id]))[0].n;
    expect(downloadsBefore).toBeGreaterThan(0);

    await auditor.delete(`/api/exams/${id}`).send({ confirmTitle: 'Doomed exam' }).expect(403);
    await suptA.delete(`/api/exams/${id}`).send({ confirmTitle: 'Doomed exam' }).expect(403);
    const wrong = await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'doomed' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/exact exam title/);
    expect((await query('SELECT 1 FROM exams WHERE id=$1', [id])).length).toBe(1);

    const res = await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'Doomed exam' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, filesRemoved: 4, filesFailed: 0, schedulesFailed: 0 });

    for (const table of ['exams', 'copies', 'paper_templates', 'trace_cases', 'generation_jobs']) {
      const col = table === 'exams' ? 'id' : 'exam_id';
      expect((await query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [id])).length).toBe(0);
    }
    expect(await query('SELECT 1 FROM local_schedules WHERE name LIKE $1', [`%${id}`])).toHaveLength(0);
    for (const key of keys) expect(await adapters.storage.exists(key)).toBe(false);

    const kept = await query("SELECT exam_id FROM downloads WHERE reason='OK' ORDER BY at DESC LIMIT 1");
    expect(kept[0].exam_id).toBeNull();
    const trail = await auditor.get('/api/audit').query({ type: 'EXAM_DELETED' }).expect(200);
    expect(trail.body[0]).toMatchObject({ action: 'EXAM_DELETED', details: { title: 'Doomed exam', copies: 20, traceCases: 1, files: 4 } });
    const history = await auditor.get('/api/audit').query({ type: 'EXAM_SCHEDULED' }).expect(200);
    expect(history.body.some((e: any) => e.details.examId === id)).toBe(true);

    for (const who of [controller, auditor]) {
      expect((await who.get('/api/exams').expect(200)).body.some((e: any) => e.id === id)).toBe(false);
    }
    expect((await suptA.get('/api/centre/exams').expect(200)).body.exams.some((e: any) => e.id === id)).toBe(false);
    await controller.get(`/api/exams/${id}`).expect(404);
    await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'Doomed exam' }).expect(404);
    await suptA.post(`/api/centre/exams/${id}/download`).send({}).expect(404);
  });

  it('quietly drops worker messages for an exam that was deleted', async () => {
    const id = await readyExam('Gone exam', 120);
    const jobs = await query('SELECT id FROM generation_jobs WHERE exam_id=$1', [id]);
    await adapters.queue.send('generation', { examId: id, jobId: jobs[0].id, roomId: id, copyIds: [id], rerender: true });
    await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'Gone exam' }).expect(200);
    await drain();
    expect(await adapters.queue.depth('generation')).toBe(0);
    expect(await adapters.queue.depth('generation-dlq')).toBe(0);
  });

  it('lists notifications for controller and auditor only', async () => {
    const res = await auditor.get('/api/notifications').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    await suptA.get('/api/notifications').expect(403);
  });
});
