import { Pool } from 'pg';
import type { Adapters, NotifyTopic } from '../interfaces';
import { SsmConfig } from './config';
import { DbWorkerFleet } from './fleet';
import { LoggingMetrics } from './metrics';
import { SnsNotifier } from './notifier';
import { SqsQueue } from './queue';
import { EventBridgeScheduler } from './scheduler';
import { S3Storage } from './storage';

export const AWS_REGION_DEFAULT = 'ap-south-1';
export const SSM_PATH_DEFAULT = '/leaktrace/prod';
export const SCHEDULE_GROUP_DEFAULT = 'leaktrace';

export type AwsRole = 'api' | 'worker';

const DB_KEYS = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const SHARED_KEYS = [...DB_KEYS, 'DATA_BUCKET', 'GENERATION_QUEUE_URL'];
const API_ONLY_KEYS = ['EXAM_EVENTS_QUEUE_URL', 'EXAM_EVENTS_QUEUE_ARN', 'SCHEDULER_ROLE_ARN'];

export function requireKeys(config: SsmConfig, keys: string[]): void {
  const missing = keys.filter((key) => !config.get(key));
  if (missing.length) throw new Error(`Missing SSM parameters: ${missing.join(', ')}`);
}

function val(config: SsmConfig, key: string): string {
  return config.get(key) as string;
}

export function awsRegion(): string {
  return process.env.AWS_REGION ?? AWS_REGION_DEFAULT;
}

export async function loadSsmConfig(): Promise<SsmConfig> {
  return SsmConfig.load(awsRegion(), process.env.SSM_PATH ?? SSM_PATH_DEFAULT);
}

export function poolFromConfig(config: SsmConfig): Pool {
  requireKeys(config, DB_KEYS);
  return new Pool({
    host: val(config, 'DB_HOST'),
    database: val(config, 'DB_NAME'),
    user: val(config, 'DB_USER'),
    password: val(config, 'DB_PASSWORD'),
    ssl: { rejectUnauthorized: false },
  });
}

function unavailable<T extends object>(what: string): T {
  return new Proxy({}, {
    get: (_target, prop) => () => {
      throw new Error(`${what} is not available in this process (called ${String(prop)})`);
    },
  }) as T;
}

export interface AwsRuntime {
  config: SsmConfig;
  pool: Pool;
  adapters: Adapters;
}

export async function bootstrapAwsAdapters(role: AwsRole = 'api'): Promise<AwsRuntime> {
  const region = awsRegion();
  const config = await loadSsmConfig();
  requireKeys(config, role === 'api' ? [...SHARED_KEYS, ...API_ONLY_KEYS] : SHARED_KEYS);
  const pool = poolFromConfig(config);

  const queueUrls: Record<string, string> = { generation: val(config, 'GENERATION_QUEUE_URL') };
  if (config.get('EXAM_EVENTS_QUEUE_URL')) queueUrls['exam-events'] = val(config, 'EXAM_EVENTS_QUEUE_URL');
  if (config.get('GENERATION_DLQ_URL')) queueUrls['generation-dlq'] = val(config, 'GENERATION_DLQ_URL');

  const adapters: Adapters = {
    storage: new S3Storage(val(config, 'DATA_BUCKET'), region),
    queue: new SqsQueue(region, queueUrls),
    scheduler: role === 'api'
      ? new EventBridgeScheduler(region, SCHEDULE_GROUP_DEFAULT, val(config, 'EXAM_EVENTS_QUEUE_ARN'), val(config, 'SCHEDULER_ROLE_ARN'))
      : unavailable('Scheduler'),
    notifier: role === 'api'
      ? new SnsNotifier(region, {
        'leak-alerts': config.get('LEAK_ALERTS_TOPIC_ARN'),
        'ops-alerts': config.get('OPS_ALERTS_TOPIC_ARN'),
        'release-notices': config.get('RELEASE_NOTICES_TOPIC_ARN'),
      } as Record<NotifyTopic, string | undefined>)
      : unavailable('Notifier'),
    metrics: new LoggingMetrics(),
    config,
    fleet: new DbWorkerFleet(pool, 1),
  };
  return { config, pool, adapters };
}
