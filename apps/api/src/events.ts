import type { Adapters } from '@leaktrace/adapters';
import { audit, query } from './db';

export interface ExamEvent {
  type: 'RELEASE' | 'CLOSE';
  examId: string;
}

export async function handleExamEvent(adapters: Adapters, event: ExamEvent): Promise<void> {
  if (event.type === 'RELEASE') {
    const rows = await query(
      `UPDATE exams SET status='RELEASED' WHERE id=$1 AND status IN ('SCHEDULED','READY')
       RETURNING title, starts_at`,
      [event.examId],
    );
    if (!rows[0]) return; // duplicate or stale event
    await audit(null, 'EXAM_RELEASED', 'exam', event.examId);
    await adapters.notifier.publish(
      'release-notices',
      `PAPER RELEASED: ${rows[0].title}`,
      `The paper for "${rows[0].title}" is now available to centre superintendents.`,
    );
  } else if (event.type === 'CLOSE') {
    const rows = await query(
      `UPDATE exams SET status='CLOSED' WHERE id=$1 AND status IN ('SCHEDULED','READY','RELEASED')
       RETURNING title`,
      [event.examId],
    );
    if (!rows[0]) return;
    await audit(null, 'EXAM_CLOSED', 'exam', event.examId);
  }
}

/** Drains the exam-events queue once. Returns the number of messages handled. */
export async function consumeExamEvents(adapters: Adapters, waitSec = 0): Promise<number> {
  const messages = await adapters.queue.receive<ExamEvent>('exam-events', { max: 10, waitSec });
  for (const message of messages) {
    await handleExamEvent(adapters, message.body); // throws => not deleted => retried
    await adapters.queue.delete('exam-events', message.receiptHandle);
  }
  return messages.length;
}

export function startExamEventConsumer(adapters: Adapters, onError: (err: unknown) => void): () => void {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        await consumeExamEvents(adapters, 5);
      } catch (err) {
        onError(err);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  })();
  return () => { stopped = true; };
}
