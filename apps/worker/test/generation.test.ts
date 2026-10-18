import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage, MAX_RECEIVES } from '@leaktrace/adapters';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { getAdapters } from '../../api/src/adapters';
import { createApp } from '../../api/src/app';
import { closePool, getPool, query } from '../../api/src/db';
import { processMessage, type GenerationMessage } from '../src/process';

/** supertest hangs intermittently on large binary bodies on Windows, so binary reads use fetch. */
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
    await getPool().query('SELECT 1 FROM local_queue LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping worker tests');
    return false;
  }
}

describe('generation pipeline (M3)', async () => {
  if (!(await dbReachable())) {
    it.skip('needs Postgres', () => {});
    return;
  }
  const server = createApp().listen(0);
  server.keepAliveTimeout = 120_000; // avoid resets when a test reuses an idle socket
  const app = server; // one real listener for every request
  const agent = request.agent(server);
  const adapters = getAdapters();
  const deps = { pool: getPool(), adapters, log: () => {} };
  let examId = '';

  const drain = async () => {
    let handled = 0;
    for (;;) {
      const msgs = await adapters.queue.receive<GenerationMessage>('generation', { max: 10 });
      if (!msgs.length) return handled;
      for (const m of msgs) await processMessage(deps, m);
      handled += msgs.length;
    }
  };
  const bundleHashes = async () => {
    const rows = await query('SELECT DISTINCT storage_key FROM copies WHERE exam_id=$1 ORDER BY 1', [examId]);
    const storage = adapters.storage as LocalStorage;
    return Promise.all(
      rows.map(async (r) => createHash('sha256').update(await storage.read(r.storage_key)).digest('hex')),
    );
  };

  beforeAll(async () => {
    await query(
      `TRUNCATE local_queue, local_schedules, worker_heartbeats, trace_results, trace_cases, downloads, copies,
       variation_points, paper_templates, generation_jobs, exams, rooms, users, centres CASCADE`,
    );
    await query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ('c@test', $1, 'C', 'CONTROLLER')",
      [await bcrypt.hash('pw-123456', 4)],
    );
    await agent.post('/api/auth/login').send({ email: 'c@test', password: 'pw-123456' }).expect(200);
    for (const code of ['A', 'B']) {
      const centre = await agent.post('/api/centres').send({ code, name: `Centre ${code}`, city: 'Pune' });
      for (const name of ['R1', 'R2']) {
        await agent
          .post(`/api/centres/${centre.body.id}/rooms`)
          .send({ name, seats: 5, invigilatorName: 'Inv' })
          .expect(201);
      }
    }
    const exam = await agent.post('/api/exams').send({
      title: 'Cloud', subject: 'CC', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 60,
    });
    examId = exam.body.id;
    await agent.put(`/api/exams/${examId}/template`).send({ source: seedPaper }).expect(200);
  });
  afterAll(async () => {
    server.close();
    await closePool();
  });

  it('generates 20 copies via queue + worker and stores one PDF per room', async () => {
    const res = await agent.post(`/api/exams/${examId}/generate`).expect(202);
    expect(res.body).toMatchObject({ rooms: 4, copies: 20 });
    expect(await adapters.queue.depth('generation')).toBe(4);

    expect(await drain()).toBe(4);
    const status = await agent.get(`/api/exams/${examId}/generation`).expect(200);
    expect(status.body.job).toMatchObject({ done: 20, total: 20, status: 'DONE' });
    expect(status.body.examStatus).toBe('READY');
    expect(status.body.queueDepth).toBe(0);

    const copies = await query('SELECT * FROM copies WHERE exam_id=$1 ORDER BY serial', [examId]);
    expect(copies).toHaveLength(20);
    expect(new Set(copies.map((c) => c.choice_vector.join(','))).size).toBe(20);
    expect(copies.every((c) => c.storage_key && /^[0-9a-f]{6}$/.test(c.visible_code))).toBe(true);
    expect(Object.keys(copies[0].answer_key)).toHaveLength(2);
    const storage = adapters.storage as LocalStorage;
    expect((await storage.read(copies[0].storage_key)).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('rejects a second generate and re-renders to byte-identical PDFs', async () => {
    await agent.post(`/api/exams/${examId}/generate`).expect(409);
    const before = await bundleHashes();
    await agent.post(`/api/exams/${examId}/rerender`).expect(202);
    expect(await drain()).toBe(4);
    expect(await bundleHashes()).toEqual(before);
  });

  it('serves a demo set zip', async () => {
    const cookie = await cookieFor(server, 'c@test', 'pw-123456');
    const res = await fetchBinary(server, `/api/exams/${examId}/demo-set`, cookie);
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/zip/);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('signed URLs work, and expired or tampered ones get 403', async () => {
    const key = (await query('SELECT storage_key FROM copies WHERE exam_id=$1 LIMIT 1', [examId]))[0].storage_key;
    const good = await adapters.storage.signedDownloadUrl(key, 120);
    const ok = await fetchBinary(server, good);
    expect(ok.status).toBe(200);
    expect(ok.type).toMatch(/pdf/);

    const expired = await adapters.storage.signedDownloadUrl(key, -5);
    expect((await request(app).get(expired)).status).toBe(403);
    expect((await request(app).get(good.slice(0, -3) + 'abc')).status).toBe(403);

    const upload = await adapters.storage.signedUploadUrl('evidence/test.txt', 'text/plain', 60);
    await request(app).put(upload).set('Content-Type', 'text/plain').send('hello').expect(204);
    expect(await adapters.storage.exists('evidence/test.txt')).toBe(true);
    await request(app).put(good).send('x').expect(403); // a download token cannot upload
  });

  it('moves a failing message to the dead-letter queue after 3 receives', async () => {
    await adapters.queue.send('generation', { examId, jobId: examId, roomId: examId, copyIds: [examId] });
    for (let i = 1; i <= MAX_RECEIVES; i++) {
      const [msg] = await adapters.queue.receive<GenerationMessage>('generation');
      expect(msg.receiveCount).toBe(i);
      await processMessage(deps, msg); // fails (no such copy), so it is not deleted
      await query("UPDATE local_queue SET visible_at = now() WHERE queue='generation'");
    }
    expect(await adapters.queue.receive('generation')).toHaveLength(0);
    expect(await adapters.queue.depth('generation-dlq')).toBe(1);
    expect(await adapters.queue.depth('generation')).toBe(0);
  });

  it('reports workers online from heartbeats', async () => {
    expect((await adapters.fleet.status()).inService).toBe(0);
    await query("INSERT INTO worker_heartbeats (worker_id) VALUES ('w1')");
    expect(await adapters.fleet.status()).toEqual({ desired: 1, inService: 1 });
  });
});
