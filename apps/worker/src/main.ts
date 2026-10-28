import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import pino from 'pino';
import { bootstrapAwsAdapters, createAdapters, recordHeartbeat, type Adapters } from '@leaktrace/adapters';
import { processMessage, type GenerationMessage } from './process';

const logger = pino();
const appMode = process.env.APP_MODE === 'aws' ? 'aws' : 'local';
const HEARTBEAT_MS = 15_000;

async function main() {
  let pool: Pool;
  let adapters: Adapters;
  logger.info({ event: 'WORKER_STARTING', mode: appMode, node: process.version }, 'worker starting');
  if (appMode === 'aws') {
    const runtime = await bootstrapAwsAdapters('worker');
    pool = runtime.pool;
    adapters = runtime.adapters;
    logger.info({ event: 'CONFIG_LOADED', source: 'SSM Parameter Store' }, 'settings loaded');
  } else {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    adapters = createAdapters('local', { pool });
  }

  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const deps = {
    pool,
    adapters,
    log: (o: object) => logger.info(o),
    logError: (o: object) => logger.error(o),
  };

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const beat = () => recordHeartbeat(pool, workerId).catch((err) => logger.error({ err: err.message }, 'heartbeat failed'));
  await pool.query('SELECT 1');
  logger.info({ event: 'DATABASE_OK' }, 'database connection works');
  await beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  logger.info({ event: 'WORKER_STARTED', workerId }, 'worker started, waiting for messages');

  while (!stopping) {
    try {
      const messages = await adapters.queue.receive<GenerationMessage>('generation', { max: 10, waitSec: 20 });
      if (messages.length) logger.info({ event: 'MESSAGES_RECEIVED', count: messages.length }, 'messages received');
      for (const message of messages) {
        if (stopping) break;
        await processMessage(deps, message);
      }
    } catch (err) {
      logger.error({ event: 'RECEIVE_LOOP_ERROR', error: (err as Error).message }, 'receive loop error');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  clearInterval(timer);
  await pool.query('DELETE FROM worker_heartbeats WHERE worker_id=$1', [workerId]).catch(() => undefined);
  await pool.end();
  logger.info({ event: 'WORKER_STOPPED' }, 'worker stopped');
}

main().catch((err) => { logger.error({ event: 'WORKER_FATAL', error: err.message, stack: err.stack }, 'fatal'); process.exit(1); });
