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
}

/**
 * Renders one room's copies, merges them in seat order and stores the bundle.
 * Throws on failure so the caller leaves the message undeleted (queue retries, then DLQ).
 * Returns true when the message did work, false when it was an idempotent no-op.
 */
export async function handleGeneration(deps: WorkerDeps, msg: GenerationMessage): Promise<boolean> {
  const { pool, adapters } = deps;

  const { rows: copies } = await pool.query(
    `SELECT c.id, c.seat_no, c.visible_code, c.choice_vector, c.storage_key, ce.code AS centre_code, r.name AS room_name
     FROM copies c JOIN centres ce ON ce.id = c.centre_id JOIN rooms r ON r.id = c.room_id
     WHERE c.id = ANY($1::uuid[]) AND c.exam_id = $2 ORDER BY c.seat_no`,
    [msg.copyIds, msg.examId],
  );
  if (copies.length !== msg.copyIds.length) throw new Error('Copy rows missing for job message');

  if (!msg.rerender && copies.every((c) => c.storage_key)) {
    deps.log({ event: 'GENERATION_SKIPPED_DUPLICATE', roomId: msg.roomId });
    return false;
  }

  const { rows: [exam] } = await pool.query('SELECT title, starts_at FROM exams WHERE id=$1', [msg.examId]);
  const { rows: [tpl] } = await pool.query(
    'SELECT parsed FROM paper_templates WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [msg.examId],
  );
  const template = tpl.parsed as ParsedTemplate;

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
  const key = `papers/${msg.examId}/${copies[0].centre_code}/${copies[0].room_name}.pdf`;
  await adapters.storage.put(key, merged, 'application/pdf');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE copies SET storage_key=$2, generated_at=now() WHERE id = ANY($1::uuid[])',
      [msg.copyIds, key],
    );
    // Atomic progress: concurrent workers each add their own room's copies.
    const { rows: [job] } = await client.query(
      `UPDATE generation_jobs SET done = done + $2,
         status = CASE WHEN done + $2 + failed >= total THEN 'DONE' ELSE status END,
         finished_at = CASE WHEN done + $2 + failed >= total THEN now() ELSE finished_at END
       WHERE id = $1 RETURNING status`,
      [msg.jobId, copies.length],
    );
    if (job?.status === 'DONE') {
      await client.query("UPDATE exams SET status='READY' WHERE id=$1 AND status='GENERATING'", [msg.examId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  adapters.metrics.count('CopiesGenerated', copies.length);
  deps.log({ event: 'ROOM_GENERATED', key, copies: copies.length });
  return true;
}

/** Processes one queue message; deletes it only on success. */
export async function processMessage(deps: WorkerDeps, message: QueueMessage<GenerationMessage>): Promise<void> {
  try {
    await handleGeneration(deps, message.body);
    await deps.adapters.queue.delete('generation', message.receiptHandle);
  } catch (err) {
    deps.log({ event: 'GENERATION_FAILED', id: message.id, receiveCount: message.receiveCount, error: (err as Error).message });
  }
}
