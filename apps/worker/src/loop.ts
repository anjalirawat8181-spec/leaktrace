import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { recordHeartbeat, type Adapters } from '@leaktrace/adapters';
import { processMessage, type GenerationMessage } from './process';

export interface WorkerLoopOptions {
  pool: Pool;
  adapters: Adapters;
  log: (o: object) => void;
  logError: (o: object) => void;
  heartbeat?: boolean;
  onState?: (running: boolean) => void;
}

const HEARTBEAT_MS = 15_000;

export function startWorkerLoop(options: WorkerLoopOptions): () => Promise<void> {
  const { pool, adapters, log, logError } = options;
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const deps = { pool, adapters, log, logError };
  let stopping = false;

  const beat = () => recordHeartbeat(pool, workerId).catch((err) => logError({ error: err.message, event: 'HEARTBEAT_FAILED' }));

  const done = (async () => {
    await pool.query('SELECT 1');
    log({ event: 'DATABASE_OK' });
    let timer: NodeJS.Timeout | undefined;
    if (options.heartbeat !== false) {
      await beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    }
    options.onState?.(true);
    log({ event: 'WORKER_STARTED', workerId });

    while (!stopping) {
      try {
        const messages = await adapters.queue.receive<GenerationMessage>('generation', { max: 10, waitSec: 20 });
        if (messages.length) log({ event: 'MESSAGES_RECEIVED', count: messages.length });
        for (const message of messages) {
          if (stopping) break;
          await processMessage(deps, message);
        }
      } catch (err) {
        logError({ event: 'RECEIVE_LOOP_ERROR', error: (err as Error).message });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (timer) clearInterval(timer);
    options.onState?.(false);
    if (options.heartbeat !== false) {
      await pool.query('DELETE FROM worker_heartbeats WHERE worker_id=$1', [workerId]).catch(() => undefined);
    }
    log({ event: 'WORKER_STOPPED' });
  })();

  return async () => {
    stopping = true;
    await done;
  };
}
