import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  detectLeak, mapNormalizedRange, type DetectionResult, type ParsedTemplate,
} from '@leaktrace/fingerprint';
import { getAdapters } from '../adapters';
import { requireAuth, requireRole } from '../auth';
import { audit, getPool, query } from '../db';

export const traceRouter = Router();
traceRouter.use(requireAuth);

const UUID = /^[0-9a-f-]{36}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const createSchema = z.object({
  examId: z.string().uuid(),
  title: z.string().min(1).max(200),
  leakText: z.string().min(1).max(50_000),
});
const evidenceSchema = z.object({
  sha256: z.string().regex(SHA256),
  contentType: z.string().refine((t) => IMAGE_TYPES.includes(t), 'Evidence must be a JPEG, PNG or WebP image'),
});

async function loadCase(id: string) {
  if (!UUID.test(id)) return undefined;
  return (await query('SELECT * FROM trace_cases WHERE id=$1', [id]))[0];
}

const caseJson = (c: any) => ({
  id: c.id, examId: c.exam_id, title: c.title, leakText: c.leak_text, status: c.status,
  evidenceKey: c.evidence_key, evidenceSha256: c.evidence_sha256, createdAt: new Date(c.created_at).toISOString(),
});

async function analyse(c: any) {
  const [tpl] = await query(
    'SELECT parsed FROM paper_templates WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [c.exam_id],
  );
  const copies = await query(
    `SELECT c.id, c.serial, c.seat_no, c.room_id, c.centre_id, c.choice_vector,
            ce.code AS centre_code, ce.name AS centre_name, r.name AS room_name, r.invigilator_name
     FROM copies c JOIN centres ce ON ce.id = c.centre_id JOIN rooms r ON r.id = c.room_id
     WHERE c.exam_id=$1 ORDER BY c.serial`, [c.exam_id],
  );
  if (!tpl || !copies.length) return null;

  const template = tpl.parsed as ParsedTemplate;
  const result: DetectionResult = detectLeak(
    template, copies.map((x) => ({ serial: x.serial, vector: x.choice_vector })), c.leak_text,
  );
  const bySerial = new Map(copies.map((x) => [x.serial, x]));
  const downloads = await query(
    `SELECT d.room_id, d.at, u.name AS by FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     WHERE d.exam_id=$1 AND d.allowed ORDER BY d.at`, [c.exam_id],
  );

  const describe = (cand: { serial: string | number; matches: number; mismatches: number; score: number }) => {
    const copy = bySerial.get(Number(cand.serial))!;
    return {
      copyId: copy.id,
      serial: copy.serial,
      centre: { code: copy.centre_code, name: copy.centre_name },
      room: copy.room_name,
      seat: copy.seat_no,
      invigilator: copy.invigilator_name,
      matches: cand.matches,
      mismatches: cand.mismatches,
      score: cand.score,
      downloadedBy: downloads
        .filter((d) => d.room_id === copy.room_id)
        .map((d) => ({ by: d.by ?? 'unknown', at: new Date(d.at).toISOString() })),
    };
  };

  const top = result.topCandidate ? bySerial.get(Number(result.topCandidate.serial))! : null;
  return {
    status: result.status,
    top: result.topCandidate ? describe(result.topCandidate) : null,
    candidates: result.candidates.map(describe),
    evidence: result.evidence.map((e) => ({
      pointId: e.pointId,
      pointIndex: e.pointIndex,
      kind: template.points[e.pointIndex].kind,
      alternative: e.alternative,
      position: mapNormalizedRange(c.leak_text, e.position),
      agrees: top ? top.choice_vector[e.pointIndex] === e.alternativeIndex : false,
    })),
    totalPoints: template.points.length,
    totalCopies: copies.length,
    coincidence: {
      probability: result.coincidenceOdds.probability,
      expectedFalseMatches: result.coincidenceOdds.expectedFalseMatches,
      oneIn: result.coincidenceOdds.oneIn,
    },
  };
}

traceRouter.get('/cases', requireRole('CONTROLLER', 'AUDITOR'), async (_req, res) => {
  const rows = await query(
    `SELECT t.*, e.title AS exam_title FROM trace_cases t JOIN exams e ON e.id = t.exam_id
     ORDER BY t.created_at DESC LIMIT 100`,
  );
  res.json(rows.map((r) => ({ ...caseJson(r), examTitle: r.exam_title })));
});

traceRouter.post('/cases', requireRole('CONTROLLER'), async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid case', issues: body.error.issues });
  const exam = await query('SELECT 1 FROM exams WHERE id=$1', [body.data.examId]);
  if (!exam.length) return res.status(404).json({ error: 'Exam not found' });
  const [row] = await query(
    `INSERT INTO trace_cases (exam_id, title, leak_text, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [body.data.examId, body.data.title, body.data.leakText, req.user!.id],
  );
  await audit(req.user!.id, 'TRACE_CASE_CREATED', 'trace_case', row.id, { examId: row.exam_id });
  res.status(201).json(caseJson(row));
});

traceRouter.post('/cases/:id/evidence-url', requireRole('CONTROLLER'), async (req, res) => {
  const c = await loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const body = evidenceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.issues[0].message });
  const ext = body.data.contentType.split('/')[1];
  const key = `evidence/${c.id}/photo.${ext}`;
  await query('UPDATE trace_cases SET evidence_key=$2, evidence_sha256=$3 WHERE id=$1', [
    c.id, key, body.data.sha256.toLowerCase(),
  ]);
  const url = await getAdapters().storage.signedUploadUrl(key, body.data.contentType, 300);
  await audit(req.user!.id, 'TRACE_EVIDENCE_REGISTERED', 'trace_case', c.id, { key, sha256: body.data.sha256 });
  res.json({ url, key });
});

traceRouter.post('/cases/:id/run', requireRole('CONTROLLER'), async (req, res) => {
  const c = await loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const adapters = getAdapters();

  if (c.evidence_key) {
    if (!(await adapters.storage.exists(c.evidence_key))) {
      return res.status(422).json({ error: 'The evidence photo was registered but never uploaded' });
    }
    const actual = createHash('sha256').update(await adapters.storage.get(c.evidence_key)).digest('hex');
    if (actual !== c.evidence_sha256) {
      await audit(req.user!.id, 'TRACE_EVIDENCE_MISMATCH', 'trace_case', c.id, { expected: c.evidence_sha256, actual });
      return res.status(422).json({ error: 'Evidence hash mismatch: the uploaded file differs from what was hashed in the browser' });
    }
  }

  const analysis = await analyse(c);
  if (!analysis) return res.status(409).json({ error: 'This exam has no generated copies to trace against' });

  const identified = analysis.status === 'IDENTIFIED';
  const status = identified ? 'IDENTIFIED' : 'INCONCLUSIVE';
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM trace_results WHERE case_id=$1', [c.id]);
    for (const [i, cand] of analysis.candidates.entries()) {
      await client.query(
        `INSERT INTO trace_results (case_id, copy_id, matches, mismatches, score, false_match_odds, rank)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [c.id, cand.copyId, cand.matches, cand.mismatches, cand.score, analysis.coincidence.oneIn, i + 1],
      );
    }
    await client.query('UPDATE trace_cases SET status=$2 WHERE id=$1', [c.id, status]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  adapters.metrics.count('TraceRuns');
  await audit(req.user!.id, 'TRACE_RUN', 'trace_case', c.id, {
    examId: c.exam_id, verdict: analysis.status, observed: analysis.evidence.length,
  });

  if (identified && c.status !== 'IDENTIFIED' && analysis.top) {
    const [exam] = await query('SELECT title FROM exams WHERE id=$1', [c.exam_id]);
    const t = analysis.top;
    const odds = analysis.coincidence.oneIn;
    adapters.metrics.count('LeaksIdentified');
    await audit(req.user!.id, 'LEAK_IDENTIFIED', 'trace_case', c.id, { examId: c.exam_id, serial: t.serial });
    await adapters.notifier.publish(
      'leak-alerts',
      `LEAK TRACED: ${exam.title}`,
      [
        `Copy serial: ${t.serial}`,
        `Centre: ${t.centre.code} (${t.centre.name})`,
        `Room: ${t.room}`,
        `Seat: ${t.seat}`,
        `Invigilator: ${t.invigilator}`,
        `Room bundle downloaded by: ${t.downloadedBy.length
          ? t.downloadedBy.map((d) => `${d.by} at ${d.at}`).join('; ')
          : 'no recorded download'}`,
        `Chance of coincidence: ${odds ? `1 in ${Math.round(odds).toLocaleString('en-US')}` : 'negligible'}`,
      ].join('\n'),
    );
  }
  res.json({ case: caseJson({ ...c, status }), ...analysis });
});

traceRouter.get('/cases/:id', requireRole('CONTROLLER', 'AUDITOR'), async (req, res) => {
  const c = await loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  res.json({ case: caseJson(c), ...(c.status === 'OPEN' ? {} : await analyse(c)) });
});
