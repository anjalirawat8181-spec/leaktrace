import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import pino from 'pino';
import { createAdapters, recordHeartbeat } from '@leaktrace/adapters';
import { processMessage, type GenerationMessage } from './process';

const logger = pino();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapters = createAdapters('local', { pool });
const workerId = `worker-${randomUUID().slice(0, 8)}`;
const deps = { pool, adapters, log: (o: object) => logger.info(o) };

let stopping = false;
const stop = () => { stopping = true; };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function main() {
  const beat = () => recordHeartbeat(pool, workerId).catch((err) => logger.error({ err }, 'heartbeat failed'));
  await beat();
  const timer = setInterval(beat, 10_000);
  logger.info({ workerId }, 'worker started');

  while (!stopping) {
    try {
      const messages = await adapters.queue.receive<GenerationMessage>('generation', { max: 10, waitSec: 20 });
      for (const message of messages) {
        if (stopping) break; // unstarted messages become visible again after the timeout
        await processMessage(deps, message);
      }
    } catch (err) {
      logger.error({ err }, 'receive loop error');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  clearInterval(timer);
  await pool.query('DELETE FROM worker_heartbeats WHERE worker_id=$1', [workerId]);
  await pool.end();
  logger.info('worker stopped');
}

main().catch((err) => { logger.error({ err }, 'fatal'); process.exit(1); });
