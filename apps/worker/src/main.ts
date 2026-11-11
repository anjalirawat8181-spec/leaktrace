import { Pool } from 'pg';
import pino from 'pino';
import { bootstrapAwsAdapters, bootstrapCloudAdapters, createAdapters, type Adapters } from '@leaktrace/adapters';
import { startWorkerLoop } from './loop';

const logger = pino();
const appMode = process.env.APP_MODE === 'aws' ? 'aws' : process.env.APP_MODE === 'cloud' ? 'cloud' : 'local';

async function main() {
  let pool: Pool;
  let adapters: Adapters;
  logger.info({ event: 'WORKER_STARTING', mode: appMode, node: process.version }, 'worker starting');
  if (appMode === 'aws') {
    const runtime = await bootstrapAwsAdapters('worker');
    pool = runtime.pool;
    adapters = runtime.adapters;
    logger.info({ event: 'CONFIG_LOADED', source: 'SSM Parameter Store' }, 'settings loaded');
  } else if (appMode === 'cloud') {
    const runtime = bootstrapCloudAdapters();
    pool = runtime.pool;
    adapters = runtime.adapters;
    runtime.gate.touch();
  } else {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    adapters = createAdapters('local', { pool });
  }

  const stop = startWorkerLoop({
    pool,
    adapters,
    log: (o) => logger.info(o),
    logError: (o) => logger.error(o),
  });
  const shutdown = () => { stop().then(() => pool.end()).then(() => process.exit(0)); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { logger.error({ event: 'WORKER_FATAL', error: err.message, stack: err.stack }, 'fatal'); process.exit(1); });
