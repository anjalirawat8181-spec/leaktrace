import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  capacityBits, detectLeak, generateVectors, parseTemplate, renderTemplate, type ParsedTemplate,
} from '@leaktrace/fingerprint';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import type { Adapters } from '@leaktrace/adapters';
import { getAdapters } from './adapters';
import { config } from './config';
import { audit, getPool, query } from './db';
import { enqueueJob, insertCopies } from './routes/generation';
import { logger } from './logger';

export const DEMO_USERS = {
  controller: 'controller@demo',
  superintendent: 'supt.c1@demo',
  auditor: 'auditor@demo',
} as const;

const RESET_KEY = 'demo_reset_at';

export async function demoResetAt(): Promise<Date | null> {
  const rows = await query<{ value: string }>('SELECT value FROM app_state WHERE key=$1', [RESET_KEY]);
  return rows[0] ? new Date(rows[0].value) : null;
}

async function markReset(): Promise<void> {
  await query(
    `INSERT INTO app_state (key, value) VALUES ($1, (now() - interval '5 minutes')::text)
     ON CONFLICT (key) DO UPDATE SET value = (now() - interval '5 minutes')::text`,
    [RESET_KEY],
  );
}

async function storedKeys(): Promise<string[]> {
  const keys = new Set<string>();
  for (const r of await query('SELECT DISTINCT storage_key FROM copies WHERE storage_key IS NOT NULL')) keys.add(r.storage_key);
  for (const r of await query('SELECT evidence_key FROM trace_cases WHERE evidence_key IS NOT NULL')) keys.add(r.evidence_key);
  return [...keys];
}

export async function wipeDemoData(adapters: Adapters): Promise<{ files: number; filesFailed: number }> {
  const keys = await storedKeys();
  let filesFailed = 0;
  for (const key of keys) {
    try {
      await adapters.storage.delete(key);
    } catch (err) {
      filesFailed++;
      logger.error({ err, key }, 'could not delete demo file');
    }
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM downloads');
    await client.query('DELETE FROM exams');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM local_queue');
    await client.query('DELETE FROM local_schedules');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await markReset();
  return { files: keys.length - filesFailed, filesFailed };
}

async function userIds(): Promise<Record<string, string>> {
  const rows = await query('SELECT id, email FROM users');
  return Object.fromEntries(rows.map((r) => [r.email, r.id]));
}

interface ExamOptions { status?: string; releaseAt?: string; closeAt?: string }

async function insertExam(title: string, subject: string, createdBy: string, source: string, options: ExamOptions = {}) {
  const startsAt = new Date(Date.now() + 3 * 3600_000).toISOString();
  const [exam] = await query(
    `INSERT INTO exams (title, subject, starts_at, duration_min, status, release_at, close_at, created_by)
     VALUES ($1,$2,$3,90,$4,$5,$6,$7) RETURNING *`,
    [title, subject, startsAt, options.status ?? 'DRAFT', options.releaseAt ?? null, options.closeAt ?? null, createdBy],
  );
  const parsed = parseTemplate(source);
  const [tpl] = await query(
    `INSERT INTO paper_templates (exam_id, source, parsed, capacity_bits, version)
     VALUES ($1,$2,$3,$4,1) RETURNING id`,
    [exam.id, source, JSON.stringify(parsed), capacityBits(parsed.points)],
  );
  for (const p of parsed.points) {
    await query(
      `INSERT INTO variation_points (template_id, idx, kind, alternatives, left_ctx, right_ctx)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tpl.id, p.idx, p.kind, JSON.stringify(p.alternatives), p.leftCtx, p.rightCtx],
    );
  }
  await audit(createdBy, 'EXAM_CREATED', 'exam', exam.id, { title });
  return { exam, parsed };
}

function leakExcerpt(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => /^[1-3]\./.test(l)).slice(0, 3);
  const joined = lines.join('\n');
  const at = joined.indexOf('storage');
  return at > 0 ? `${joined.slice(0, at)}storge${joined.slice(at + 7)}` : joined;
}

export async function seedDemoData(adapters: Adapters): Promise<void> {
  const ids = await userIds();
  const controller = ids[DEMO_USERS.controller];
  const supt = ids[DEMO_USERS.superintendent];
  if (!controller || !supt) throw new Error('Demo users are missing; run the seed first');

  const now = Date.now();
  const { exam, parsed } = await insertExam(
    'Cloud Computing Unit Test 1', 'Cloud Computing', controller, seedPaper,
    {
      status: 'RELEASED',
      releaseAt: new Date(now - 30 * 60_000).toISOString(),
      closeAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
    },
  );

  const rooms = await query(
    'SELECT r.id, r.centre_id, r.seats FROM rooms r JOIN centres c ON c.id = r.centre_id ORDER BY c.code, r.name',
  );
  const total = rooms.reduce((n, r) => n + r.seats, 0);
  const vectors = generateVectors(exam.id, total, parsed.points, config.fingerprintKey);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await insertCopies(client, exam.id, rooms, parsed, vectors);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const queued = await enqueueJob(exam.id, false);
  await audit(controller, 'GENERATION_STARTED', 'exam', exam.id, queued);
  await audit(controller, 'EXAM_SCHEDULED', 'exam', exam.id, { examId: exam.id });
  await audit(null, 'EXAM_RELEASED', 'exam', exam.id);

  const copies = await query(
    'SELECT c.id, c.serial, c.room_id, c.choice_vector FROM copies c WHERE c.exam_id=$1 ORDER BY c.serial', [exam.id],
  );
  const leaked = copies[Math.min(7, copies.length - 1)];
  const leakText = leakExcerpt(renderTemplate(parsed as ParsedTemplate, leaked.choice_vector));
  const result = detectLeak(parsed as ParsedTemplate, copies.map((c) => ({ serial: c.serial, vector: c.choice_vector })), leakText);

  await query(
    `INSERT INTO downloads (exam_id, centre_id, room_id, user_id, allowed, reason, at)
     SELECT $1, c.centre_id, c.room_id, $2, false, 'TOO_EARLY', now() - interval '4 minutes' FROM copies c WHERE c.id=$3`,
    [exam.id, ids['supt.c2@demo'] ?? supt, copies[copies.length - 1].id],
  );
  await query(
    `INSERT INTO downloads (exam_id, centre_id, room_id, user_id, allowed, reason, at)
     SELECT $1, c.centre_id, c.room_id, $2, true, 'OK', now() - interval '3 minutes' FROM copies c WHERE c.id=$3`,
    [exam.id, supt, leaked.id],
  );

  const [traceCase] = await query(
    'INSERT INTO trace_cases (exam_id, title, leak_text, status, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [exam.id, 'Leaked screenshot from a messaging group', leakText, result.status === 'IDENTIFIED' ? 'IDENTIFIED' : 'INCONCLUSIVE', controller],
  );
  for (const [i, cand] of result.candidates.entries()) {
    const copy = copies.find((c) => c.serial === Number(cand.serial));
    if (!copy) continue;
    await query(
      `INSERT INTO trace_results (case_id, copy_id, matches, mismatches, score, false_match_odds, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [traceCase.id, copy.id, cand.matches, cand.mismatches, cand.score, result.coincidenceOdds.oneIn, i + 1],
    );
  }
  await audit(controller, 'TRACE_CASE_CREATED', 'trace_case', traceCase.id, { examId: exam.id });
  await audit(controller, 'TRACE_RUN', 'trace_case', traceCase.id, {
    examId: exam.id, verdict: result.status, observed: result.evidence.length,
  });
  if (result.status === 'IDENTIFIED') {
    await audit(controller, 'LEAK_IDENTIFIED', 'trace_case', traceCase.id, { examId: exam.id, serial: leaked.serial });
    await adapters.notifier.publish(
      'leak-alerts',
      'LEAK TRACED: Cloud Computing Unit Test 1',
      `Copy serial: ${leaked.serial}\nThis alert comes from the seeded demo case.`,
    );
  }

  await insertExam(
    'Operating Systems Midterm (try me)', 'Operating Systems', controller,
    seedPaper.replace('Cloud Computing Unit Test 1', 'Operating Systems Midterm'),
  );
}

export async function resetDemo(): Promise<{ files: number; filesFailed: number }> {
  const adapters = getAdapters();
  const wiped = await wipeDemoData(adapters);
  await seedDemoData(adapters);
  return wiped;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const adminRouter = Router();

adminRouter.post('/reset-demo', async (req, res) => {
  const expected = config.demoResetToken;
  if (!config.demoMode || !expected) return res.status(404).json({ error: 'Not found' });
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !tokenMatches(given, expected)) return res.status(401).json({ error: 'Invalid token' });
  const result = await resetDemo();
  res.json({ reset: true, ...result });
});
