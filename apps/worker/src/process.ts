import type { Pool } from 'pg';
import type { Adapters, QueueMessage } from '@leaktrace/adapters';
import type { ParsedTemplate } from '@leaktrace/fingerprint';
import { mergePdfs, renderCopy } from '@leaktrace/pdf';

export interface GenerationMessage {
  examId: string;
  roomId: string;
  copyIds: string[];
  jobId: string;
  rerender?: boolean;
}

export interface WorkerDeps {
  pool: Pool;
  adapters: Adapters;
  log: (o: object) => void;
  logError?: (o: object) => void;
}

export const MAX_ATTEMPTS = Number(process.env.GENERATION_MAX_ATTEMPTS ?? 3);

export async function handleGeneration(deps: WorkerDeps, msg: GenerationMessage): Promise<boolean> {
  const { pool, adapters } = deps;

  const { rows: [exam] } = await pool.query('SELECT title, starts_at FROM exams WHERE id=$1', [msg.examId]);
  if (!exam) {
    deps.log({ event: 'EXAM_GONE', examId: msg.examId, roomId: msg.roomId, note: 'exam was deleted; dropping message' });
    return false;
  }

  const { rows: copies } = await pool.query(
    `SELECT c.id, c.seat_no, c.visible_code, c.choice_vector, c.storage_key, ce.code AS centre_code, r.name AS room_name
     FROM copies c JOIN centres ce ON ce.id = c.centre_id JOIN rooms r ON r.id = c.room_id
     WHERE c.id = ANY($1::uuid[]) AND c.exam_id = $2 ORDER BY c.seat_no`,
    [msg.copyIds, msg.examId],
  );
  if (copies.length !== msg.copyIds.length) {
    throw new Error(`Copy rows missing for this room: expected ${msg.copyIds.length}, found ${copies.length}`);
  }

  if (!msg.rerender && copies.every((c) => c.storage_key)) {
    deps.log({ event: 'GENERATION_SKIPPED_DUPLICATE', roomId: msg.roomId });
    return false;
  }

  const { rows: [tpl] } = await pool.query(
    'SELECT parsed FROM paper_templates WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [msg.examId],
  );
  if (!tpl) throw new Error('This exam has no saved template');
  const template = tpl.parsed as ParsedTemplate;
  const roomLabel = `${copies[0].centre_code}/${copies[0].room_name}`;

  deps.log({ event: 'ROOM_RENDERING', room: roomLabel, copies: copies.length });
  const pdfs: Buffer[] = [];
  for (const copy of copies) {
    pdfs.push(await renderCopy({
      template,
      vector: copy.choice_vector,
      title: exam.title,
      startsAt: new Date(exam.starts_at),
      centreCode: copy.centre_code,
      seatNo: copy.seat_no,
      visibleCode: copy.visible_code,
    }));
  }
  const merged = await mergePdfs(pdfs);
  deps.log({ event: 'ROOM_RENDERED', room: roomLabel, bytes: merged.length });

  const key = `papers/${msg.examId}/${copies[0].centre_code}/${copies[0].room_name}.pdf`;
  deps.log({ event: 'S3_UPLOAD_START', key, bytes: merged.length });
  await adapters.storage.put(key, merged, 'application/pdf');
  deps.log({ event: 'S3_UPLOAD_DONE', key });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE copies SET storage_key=$2, generated_at=now() WHERE id = ANY($1::uuid[])',
      [msg.copyIds, key],
    );
    const { rows: [job] } = await client.query(
      `UPDATE generation_jobs SET done = done + $2,
         status = CASE WHEN done + $2 + failed >= total
                       THEN (CASE WHEN failed > 0 THEN 'FAILED' ELSE 'DONE' END) ELSE status END,
         finished_at = CASE WHEN done + $2 + failed >= total THEN now() ELSE finished_at END,
         last_error = CASE WHEN done + $2 + failed >= total AND failed = 0 THEN NULL ELSE last_error END
       WHERE id = $1 RETURNING status, done, total`,
      [msg.jobId, copies.length],
    );
    if (job?.status === 'DONE') {
      await client.query("UPDATE exams SET status='READY' WHERE id=$1 AND status='GENERATING'", [msg.examId]);
    }
    await client.query('COMMIT');
    deps.log({ event: 'ROOM_SAVED', room: roomLabel, jobStatus: job?.status, done: job?.done, total: job?.total });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  adapters.metrics.count('CopiesGenerated', copies.length);
  return true;
}

async function recordFailure(deps: WorkerDeps, msg: GenerationMessage, receiveCount: number, text: string) {
  try {
    await deps.pool.query('UPDATE generation_jobs SET last_error = $2 WHERE id = $1', [msg.jobId, text.slice(0, 1000)]);
    if (receiveCount >= MAX_ATTEMPTS) {
      await deps.pool.query(
        `UPDATE generation_jobs SET failed = failed + $2, failed_messages = failed_messages + 1,
           status = CASE WHEN done + failed + $2 >= total THEN 'FAILED' ELSE status END,
           finished_at = CASE WHEN done + failed + $2 >= total THEN now() ELSE finished_at END
         WHERE id = $1`,
        [msg.jobId, msg.copyIds.length],
      );
    }
  } catch (err) {
    (deps.logError ?? deps.log)({ event: 'FAILURE_NOT_RECORDED', error: (err as Error).message });
  }
}

export async function processMessage(deps: WorkerDeps, message: QueueMessage<GenerationMessage>): Promise<void> {
  const body = message.body;
  deps.log({
    event: 'MESSAGE_RECEIVED', id: message.id, receiveCount: message.receiveCount,
    examId: body.examId, jobId: body.jobId, roomId: body.roomId, copies: body.copyIds?.length, rerender: Boolean(body.rerender),
  });
  try {
    await handleGeneration(deps, body);
  } catch (err) {
    const error = err as Error;
    (deps.logError ?? deps.log)({
      event: 'GENERATION_FAILED', id: message.id, receiveCount: message.receiveCount,
      examId: body.examId, jobId: body.jobId, roomId: body.roomId, error: error.message, stack: error.stack,
    });
    await recordFailure(deps, body, message.receiveCount, error.message);
    return;
  }
  try {
    await deps.adapters.queue.delete('generation', message.receiptHandle);
    deps.log({ event: 'MESSAGE_DELETED', id: message.id });
  } catch (err) {
    (deps.logError ?? deps.log)({ event: 'QUEUE_DELETE_FAILED', id: message.id, error: (err as Error).message });
  }
}
