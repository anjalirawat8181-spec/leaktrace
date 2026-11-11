import { Pool } from 'pg';
import type { Adapters } from '../interfaces';
import { EnvConfig, LocalMetrics, LocalNotifier } from '../local/misc';
import { LocalQueue } from '../local/queue';
import { LocalScheduler } from '../local/scheduler';
import { S3Storage } from '../aws/storage';
import { ActivityGate } from './activity';
import { InProcessFleet } from './fleet';
import { GatedQueue } from './queue';

export const CLOUD_REQUIRED_KEYS = [
  'DATABASE_URL', 'JWT_SECRET', 'FINGERPRINT_KEY',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
];

export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export interface CloudRuntime {
  config: EnvConfig;
  pool: Pool;
  adapters: Adapters;
  gate: ActivityGate;
  fleet: InProcessFleet;
  startBackground(onError: (err: unknown) => void): () => void;
}

export function bootstrapCloudAdapters(env: NodeJS.ProcessEnv = process.env): CloudRuntime {
  const config = new EnvConfig(CLOUD_REQUIRED_KEYS, env);
  const pool = new Pool({
    connectionString: config.get('DATABASE_URL'),
    max: Number(config.get('DB_POOL_MAX') ?? 5),
    ssl: { rejectUnauthorized: true },
  });
  const gate = new ActivityGate(Number(config.get('IDLE_AFTER_SEC') ?? 600) * 1000);
  const fleet = new InProcessFleet();
  const queue = new GatedQueue(new LocalQueue(pool), gate);
  const scheduler = new LocalScheduler(pool, queue);

  const adapters: Adapters = {
    storage: new S3Storage(config.get('R2_BUCKET')!, 'auto', {
      endpoint: r2Endpoint(config.get('R2_ACCOUNT_ID')!),
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY')!,
      },
    }),
    queue,
    scheduler,
    notifier: new LocalNotifier(pool),
    metrics: new LocalMetrics(),
    config,
    fleet,
  };

  const startBackground = (onError: (err: unknown) => void) => {
    const timer = setInterval(() => {
      if (gate.isActive()) scheduler.fireDue().catch(onError);
    }, 10_000);
    timer.unref();
    return () => clearInterval(timer);
  };

  return { config, pool, adapters, gate, fleet, startBackground };
}
