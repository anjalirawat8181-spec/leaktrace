import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { examSchema, templateSchema } from '@leaktrace/shared';
import {
  capacityBits, generateVectors, parseTemplate, renderTemplate,
  type ParsedTemplate,
} from '@leaktrace/fingerprint';
import { getAdapters } from '../adapters';
import { requireAuth, requireRole } from '../auth';
import { config } from '../config';
import { audit, getPool, query } from '../db';
import { demoLimit } from '../limits';
import { wordDiff } from '../diff';
import { logger } from '../logger';
import { closeScheduleName, releaseScheduleName } from '../time';
import { scheduleInfo } from './schedule';

export const examsRouter = Router();
examsRouter.use(requireAuth);

const examJson = (e: any) => ({
  id: e.id,
  title: e.title,
  subject: e.subject,
  startsAt: new Date(e.starts_at).toISOString(),
  durationMin: e.duration_min,
  releaseLeadMin: e.release_lead_min,
  closeAfterMin: e.close_after_min,
  releaseAt: e.release_at ? new Date(e.release_at).toISOString() : null,
  closeAt: e.close_at ? new Date(e.close_at).toISOString() : null,
  hasTemplate: Boolean(e.has_template),
  status: e.status,
});

async function totalSeats(): Promise<number> {
  const rows = await query<{ total: string }>('SELECT COALESCE(SUM(seats),0) AS total FROM rooms');
  return Number(rows[0].total);
}

function planCopies(seats: number): number {
  return seats > 0 ? Math.min(seats, config.maxCopies) : config.maxCopies;
}

function capacityInfo(parsed: ParsedTemplate, seats: number) {
  const copies = planCopies(seats);
  const bits = parsed.points.length ? capacityBits(parsed.points) : 0;
  const requiredBits = Math.log2(copies) + 12;
  return {
    capacityBits: bits,
    requiredBits,
    totalCopies: seats,
    plannedCopies: copies,
    maxCopies: config.maxCopies,
    sufficient: bits >= requiredBits,
  };
}

const pointJson = (p: ParsedTemplate['points'][number]) => ({
  id: p.id, idx: p.idx, kind: p.kind, alternatives: p.alternatives,
  items: p.items, leftCtx: p.leftCtx, rightCtx: p.rightCtx, start: p.start, end: p.end,
});

async function loadExam(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return (await query('SELECT * FROM exams WHERE id = $1', [id]))[0];
}

async function loadTemplate(examId: string) {
  return (await query(
    'SELECT * FROM paper_templates WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [examId],
  ))[0];
}

examsRouter.get('/', requireRole('CONTROLLER', 'AUDITOR'), async (_req, res) => {
  const rows = await query(
    `SELECT e.*, EXISTS (SELECT 1 FROM paper_templates t WHERE t.exam_id = e.id) AS has_template
     FROM exams e ORDER BY e.starts_at DESC`,
  );
  res.json(rows.map(examJson));
});

examsRouter.post('/', requireRole('CONTROLLER'), demoLimit('create exam', 10), async (req, res) => {
  const parsed = examSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid exam', issues: parsed.error.issues });
  const d = parsed.data;
  if (config.demoMode) {
    const [{ n }] = await query('SELECT count(*)::int AS n FROM exams');
    if (n >= config.demoMaxExams) {
      return res.status(429).json({ error: `The public demo allows ${config.demoMaxExams} exams until the nightly reset. Delete one to make room.` });
    }
  }
  const [row] = await query(
    `INSERT INTO exams (title, subject, starts_at, duration_min, release_lead_min, close_after_min, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [d.title, d.subject, d.startsAt, d.durationMin, d.releaseLeadMin, d.closeAfterMin, req.user!.id],
  );
  await audit(req.user!.id, 'EXAM_CREATED', 'exam', row.id, { title: d.title });
  res.status(201).json(examJson(row));
});

examsRouter.get('/:id', requireRole('CONTROLLER', 'AUDITOR'), async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const tpl = await loadTemplate(exam.id);
  const seats = await totalSeats();
  let template = null;
  if (tpl) {
    const parsed = tpl.parsed as ParsedTemplate;
    template = {
      source: tpl.source,
      version: tpl.version,
      points: parsed.points.map(pointJson),
      ...capacityInfo(parsed, seats),
    };
  }
  const schedule = ['SCHEDULED', 'RELEASED', 'CLOSED'].includes(exam.status) ? scheduleInfo(exam) : null;
  res.json({ ...examJson(exam), totalCopies: seats, maxCopies: config.maxCopies, template, schedule });
});

examsRouter.post('/:id/template/preview', requireRole('CONTROLLER'), async (req, res) => {
  const body = templateSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid template' });
  try {
    const parsed = parseTemplate(body.data.source);
    const info = capacityInfo(parsed, await totalSeats());
    const preview = renderTemplate(parsed, parsed.points.map(() => 0));
    res.json({ points: parsed.points.map(pointJson), preview, ...info });
  } catch (err) {
    res.status(400).json({ error: `Template error: ${(err as Error).message}` });
  }
});

examsRouter.put('/:id/template',requireRole('CONTROLLER'), async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.status !== 'DRAFT') {
    return res.status(409).json({ error: `Template is locked once the exam is ${exam.status}` });
  }
  const body = templateSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid template', issues: body.error.issues });
  if (config.demoMode && body.data.source.length > config.demoMaxPaperChars) {
    return res.status(413).json({ error: `The public demo accepts papers up to ${config.demoMaxPaperChars} characters` });
  }

  let parsed: ParsedTemplate;
  try {
    parsed = parseTemplate(body.data.source);
  } catch (err) {
    return res.status(400).json({ error: `Template error: ${(err as Error).message}` });
  }
  const info = capacityInfo(parsed, await totalSeats());

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const prev = await client.query(
      'SELECT COALESCE(MAX(version),0) AS v FROM paper_templates WHERE exam_id=$1', [exam.id],
    );
    const version = Number(prev.rows[0].v) + 1;
    const tpl = await client.query(
      `INSERT INTO paper_templates (exam_id, source, parsed, capacity_bits, version)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [exam.id, body.data.source, JSON.stringify(parsed), info.capacityBits, version],
    );
    for (const p of parsed.points) {
      await client.query(
        `INSERT INTO variation_points (template_id, idx, kind, alternatives, left_ctx, right_ctx)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tpl.rows[0].id, p.idx, p.kind, JSON.stringify(p.alternatives), p.leftCtx, p.rightCtx],
      );
    }
    await client.query('COMMIT');
    await audit(req.user!.id, 'TEMPLATE_SAVED', 'exam', exam.id, {
      version, points: parsed.points.length, capacityBits: info.capacityBits,
    });
    res.json({ version, points: parsed.points.map(pointJson), ...info });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

examsRouter.get('/:id/spot-the-difference', requireRole('CONTROLLER'), async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const tpl = await loadTemplate(exam.id);
  if (!tpl) return res.status(409).json({ error: 'Save a template first' });
  const parsed = tpl.parsed as ParsedTemplate;
  const copies = Math.max(2, planCopies(await totalSeats()));
  let vectors: number[][];
  try {
    vectors = generateVectors(exam.id, copies, parsed.points, config.fingerprintKey);
  } catch (err) {
    return res.status(422).json({ error: (err as Error).message });
  }
  const first = randomInt(vectors.length);
  let second = randomInt(vectors.length - 1);
  if (second >= first) second++;
  const a = renderTemplate(parsed, vectors[first]);
  const b = renderTemplate(parsed, vectors[second]);
  const diff = wordDiff(a, b);
  res.json({
    a: { serial: first + 1, text: a, ranges: diff.a },
    b: { serial: second + 1, text: b, ranges: diff.b },
  });
});

examsRouter.delete('/:id', requireRole('CONTROLLER'), async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const typed = typeof req.body?.confirmTitle === 'string' ? req.body.confirmTitle.trim() : '';
  if (typed !== exam.title.trim()) {
    return res.status(400).json({ error: 'Type the exact exam title to confirm the delete' });
  }

  const fileKeys = new Set<string>();
  for (const r of await query('SELECT DISTINCT storage_key FROM copies WHERE exam_id=$1 AND storage_key IS NOT NULL', [exam.id])) {
    fileKeys.add(r.storage_key);
  }
  for (const r of await query('SELECT evidence_key FROM trace_cases WHERE exam_id=$1 AND evidence_key IS NOT NULL', [exam.id])) {
    fileKeys.add(r.evidence_key);
  }
  const [{ copies }] = await query('SELECT count(*)::int AS copies FROM copies WHERE exam_id=$1', [exam.id]);
  const [{ cases }] = await query('SELECT count(*)::int AS cases FROM trace_cases WHERE exam_id=$1', [exam.id]);

  await query('DELETE FROM exams WHERE id=$1', [exam.id]);
  await audit(req.user!.id, 'EXAM_DELETED', 'exam', exam.id, {
    examId: exam.id, title: exam.title, status: exam.status, copies, traceCases: cases, files: fileKeys.size,
  });

  const { storage, scheduler } = getAdapters();
  let filesRemoved = 0;
  let filesFailed = 0;
  for (const key of fileKeys) {
    try {
      await storage.delete(key);
      filesRemoved++;
    } catch (err) {
      filesFailed++;
      logger.error({ err, key, examId: exam.id }, 'could not delete exam file');
    }
  }
  let schedulesFailed = 0;
  for (const name of [releaseScheduleName(exam.id), closeScheduleName(exam.id)]) {
    try {
      await scheduler.cancel(name);
    } catch (err) {
      schedulesFailed++;
      logger.error({ err, name, examId: exam.id }, 'could not delete exam schedule');
    }
  }
  res.json({ deleted: true, filesRemoved, filesFailed, schedulesFailed });
});
