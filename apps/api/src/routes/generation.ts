import { Router } from 'express';
import { createHash, randomInt } from 'node:crypto';
import { zipSync } from 'fflate';
import { generateVectors, type ParsedTemplate } from '@leaktrace/fingerprint';
import { buildAnswerKey, renderCopy, visibleCode } from '@leaktrace/pdf';
import { getAdapters } from '../adapters';
import { requireAuth, requireRole } from '../auth';
import { config } from '../config';
import { audit, getPool, query } from '../db';

export const generationRouter = Router();
generationRouter.use(requireAuth, requireRole('CONTROLLER'));

const UUID = /^[0-9a-f-]{36}$/i;

async function loadExam(id: string) {
  if (!UUID.test(id)) return undefined;
  return (await query('SELECT * FROM exams WHERE id=$1', [id]))[0];
}

async function latestTemplate(examId: string) {
  return (await query(
    'SELECT * FROM paper_templates WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [examId],
  ))[0];
}

interface RoomJob { roomId: string; copyIds: string[] }

async function roomJobs(examId: string): Promise<RoomJob[]> {
  const rows = await query(
    `SELECT c.id, c.room_id FROM copies c JOIN rooms r ON r.id = c.room_id
     JOIN centres ce ON ce.id = c.centre_id
     WHERE c.exam_id=$1 ORDER BY ce.code, r.name, c.seat_no`, [examId],
  );
  const jobs = new Map<string, RoomJob>();
  for (const row of rows) {
    if (!jobs.has(row.room_id)) jobs.set(row.room_id, { roomId: row.room_id, copyIds: [] });
    jobs.get(row.room_id)!.copyIds.push(row.id);
  }
  return [...jobs.values()];
}

async function enqueueJob(examId: string, rerender: boolean): Promise<{ jobId: string; rooms: number; copies: number }> {
  const jobs = await roomJobs(examId);
  const copies = jobs.reduce((n, j) => n + j.copyIds.length, 0);
  const [job] = await query(
    'INSERT INTO generation_jobs (exam_id, total) VALUES ($1,$2) RETURNING id', [examId, copies],
  );
  for (const j of jobs) {
    await getAdapters().queue.send('generation', { examId, jobId: job.id, rerender, ...j });
  }
  return { jobId: job.id, rooms: jobs.length, copies };
}

generationRouter.post('/:id/generate', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.status !== 'DRAFT') {
    return res.status(409).json({ error: `Exam is ${exam.status}; use re-render to rebuild PDFs` });
  }
  const tpl = await latestTemplate(exam.id);
  if (!tpl) return res.status(409).json({ error: 'Save a template first' });
  const parsed = tpl.parsed as ParsedTemplate;

  const rooms = await query(
    `SELECT r.id, r.centre_id, r.seats FROM rooms r JOIN centres c ON c.id = r.centre_id
     ORDER BY c.code, r.name`,
  );
  const total = rooms.reduce((n, r) => n + r.seats, 0);
  if (total < 1) return res.status(422).json({ error: 'Add centres and rooms before generating' });
  if (total > config.maxCopies) {
    return res.status(422).json({ error: `Rooms add up to ${total} seats; the maximum is ${config.maxCopies}` });
  }

  let vectors: number[][];
  try {
    vectors = generateVectors(exam.id, total, parsed.points, config.fingerprintKey);
  } catch (err) {
    return res.status(422).json({ error: (err as Error).message });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      "UPDATE exams SET status='GENERATING' WHERE id=$1 AND status='DRAFT' RETURNING id", [exam.id],
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Generation already started' });
    }
    let serial = 0;
    for (const room of rooms) {
      for (let seat = 1; seat <= room.seats; seat++) {
        const vector = vectors[serial];
        serial++;
        await client.query(
          `INSERT INTO copies (exam_id, centre_id, room_id, seat_no, serial, visible_code, choice_vector, answer_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [exam.id, room.centre_id, room.id, seat, serial, visibleCode(serial, config.fingerprintKey),
            vector, JSON.stringify(buildAnswerKey(parsed.points, vector))],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const queued = await enqueueJob(exam.id, false);
  await audit(req.user!.id, 'GENERATION_STARTED', 'exam', exam.id, queued);
  res.status(202).json(queued);
});

generationRouter.post('/:id/rerender', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const [{ n }] = await query('SELECT count(*)::int AS n FROM copies WHERE exam_id=$1', [exam.id]);
  if (!n) return res.status(409).json({ error: 'Nothing to re-render: generate copies first' });
  const queued = await enqueueJob(exam.id, true);
  await audit(req.user!.id, 'RERENDER_STARTED', 'exam', exam.id, queued);
  res.status(202).json(queued);
});

generationRouter.get('/:id/generation', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const adapters = getAdapters();
  const [job] = await query(
    'SELECT id, total, done, failed, status FROM generation_jobs WHERE exam_id=$1 ORDER BY started_at DESC LIMIT 1',
    [exam.id],
  );
  res.json({
    examStatus: exam.status,
    job: job ?? null,
    queueDepth: await adapters.queue.depth('generation'),
    deadLetterDepth: await adapters.queue.depth('generation-dlq'),
    workers: await adapters.fleet.status(),
  });
});

generationRouter.get('/:id/demo-set', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const tpl = await latestTemplate(exam.id);
  const copies = await query(
    `SELECT c.*, ce.code AS centre_code FROM copies c JOIN centres ce ON ce.id = c.centre_id
     WHERE c.exam_id=$1`, [exam.id],
  );
  if (!tpl || !copies.length) return res.status(409).json({ error: 'Generate copies first' });

  const picked = [...copies];
  const chosen: typeof copies = [];
  while (chosen.length < 5 && picked.length) chosen.push(picked.splice(randomInt(picked.length), 1)[0]);

  const files: Record<string, Uint8Array> = {};
  for (const c of chosen) {
    const pdf = await renderCopy({
      template: tpl.parsed as ParsedTemplate,
      vector: c.choice_vector,
      title: exam.title,
      startsAt: new Date(exam.starts_at),
      centreCode: c.centre_code,
      seatNo: c.seat_no,
      visibleCode: c.visible_code,
    });
    files[`copy-${String(c.serial).padStart(2, '0')}-${c.centre_code}-seat${c.seat_no}.pdf`] = pdf;
  }
  const zip = Buffer.from(zipSync(files));
  await audit(req.user!.id, 'DEMO_SET_DOWNLOADED', 'exam', exam.id, {
    sha256: createHash('sha256').update(zip).digest('hex'),
  });
  res.type('application/zip').setHeader('Content-Disposition', 'attachment; filename="demo-set.zip"');
  res.send(zip);
});
