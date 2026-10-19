import path from 'node:path';
import { Pool } from 'pg';
import type { Adapters } from './interfaces';
import { EnvConfig, LocalMetrics, LocalNotifier, LocalWorkerFleet } from './local/misc';
import { LocalQueue } from './local/queue';
import { LocalScheduler } from './local/scheduler';
import { LocalStorage } from './local/storage';

export * from './interfaces';
export * from './local/misc';
export * from './local/queue';
export * from './local/scheduler';
export * from './local/storage';

export const REQUIRED_CONFIG_KEYS = ['DATABASE_URL', 'JWT_SECRET', 'FINGERPRINT_KEY'];

export interface LocalOptions {
  pool?: Pool;
  dataDir?: string;
  visibilitySec?: number;
}

export function createAdapters(mode: 'local' | 'aws', options: LocalOptions = {}): Adapters {
  if (mode !== 'local') throw new Error('AWS adapters not implemented yet');

  const config = new EnvConfig(REQUIRED_CONFIG_KEYS);
  const pool = options.pool ?? new Pool({ connectionString: config.get('DATABASE_URL') });
  const repoRoot = path.resolve(__dirname, '../../..');
  const dataDir = options.dataDir ?? path.resolve(config.get('DATA_DIR') ?? path.join(repoRoot, 'data'));
  const queue = new LocalQueue(pool, options.visibilitySec);

  return {
    storage: new LocalStorage(dataDir, config.get('LOCAL_FILES_SECRET') ?? config.get('JWT_SECRET')!),
    queue,
    scheduler: new LocalScheduler(pool, queue),
    notifier: new LocalNotifier(pool),
    metrics: new LocalMetrics(),
    config,
    fleet: new LocalWorkerFleet(pool, Number(config.get('WORKER_DESIRED') ?? 1)),
  };
}
