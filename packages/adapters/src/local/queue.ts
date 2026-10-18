import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Queue, QueueMessage, QueueName } from '../interfaces';

export const MAX_RECEIVES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LocalQueue implements Queue {
  constructor(private readonly pool: Pool, private readonly visibilitySec = 30) {}

  async send(queue: QueueName, body: unknown): Promise<void> {
    await this.pool.query('INSERT INTO local_queue (queue, body) VALUES ($1, $2)', [
      queue, JSON.stringify(body),
    ]);
  }

  async receive<T = any>(
    queue: QueueName,
    opts: { max?: number; waitSec?: number } = {},
  ): Promise<QueueMessage<T>[]> {
    const deadline = Date.now() + (opts.waitSec ?? 0) * 1000;
    for (;;) {
      const messages = await this.receiveOnce<T>(queue, opts.max ?? 1);
      if (messages.length || Date.now() >= deadline) return messages;
      await sleep(Math.min(500, Math.max(deadline - Date.now(), 0)));
    }
  }

  private async receiveOnce<T>(queue: string, max: number): Promise<QueueMessage<T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, body, receive_count FROM local_queue
         WHERE queue = $1 AND visible_at <= now()
         ORDER BY visible_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [queue, max],
      );
      const result: QueueMessage<T>[] = [];
      for (const row of rows) {
        if (row.receive_count >= MAX_RECEIVES) {
          await client.query(
            `UPDATE local_queue SET queue = $2, receive_count = 0, visible_at = now(),
             receipt_handle = NULL WHERE id = $1`,
            [row.id, `${queue}-dlq`],
          );
          continue;
        }
        const receiptHandle = randomUUID();
        await client.query(
          `UPDATE local_queue SET receive_count = receive_count + 1, receipt_handle = $2,
           visible_at = now() + make_interval(secs => $3) WHERE id = $1`,
          [row.id, receiptHandle, this.visibilitySec],
        );
        result.push({
          id: row.id, body: row.body, receiptHandle, receiveCount: row.receive_count + 1,
        });
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async delete(queue: QueueName, receiptHandle: string): Promise<void> {
    await this.pool.query('DELETE FROM local_queue WHERE queue = $1 AND receipt_handle = $2', [
      queue, receiptHandle,
    ]);
  }

  async depth(queue: QueueName): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM local_queue WHERE queue = $1', [queue],
    );
    return rows[0].n;
  }
}
