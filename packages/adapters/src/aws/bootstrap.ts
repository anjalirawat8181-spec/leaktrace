import { Pool } from 'pg';
import type { Adapters } from '../interfaces';
import { SsmConfig } from './config';
import { AsgWorkerFleet } from './fleet';
import { LoggingMetrics } from './metrics';
import { SnsNotifier } from './notifier';
import { SqsQueue } from './queue';
import { EventBridgeScheduler } from './scheduler';
import { S3Storage } from './storage';

export const AWS_REGION_DEFAULT = 'ap-south-1';
export const SSM_PATH_DEFAULT = '/leaktrace/prod';
export const SCHEDULE_GROUP_DEFAULT = 'leaktrace';

function required(config: SsmConfig, key: string): string {
  const value = config.get(key);
  if (!value) throw new Error(`Missing SSM parameter ${key}`);
  return value;
}

export function awsRegion(): string {
  return process.env.AWS_REGION ?? AWS_REGION_DEFAULT;
}

export async function loadSsmConfig(): Promise<SsmConfig> {
  return SsmConfig.load(awsRegion(), process.env.SSM_PATH ?? SSM_PATH_DEFAULT);
}

export function poolFromConfig(config: SsmConfig): Pool {
  return new Pool({
    host: required(config, 'DB_HOST'),
    database: required(config, 'DB_NAME'),
    user: required(config, 'DB_USER'),
    password: required(config, 'DB_PASSWORD'),
    ssl: { rejectUnauthorized: false },
  });
}

export interface AwsRuntime {
  config: SsmConfig;
  pool: Pool;
  adapters: Adapters;
}

export async function bootstrapAwsAdapters(): Promise<AwsRuntime> {
  const region = awsRegion();
  const config = await loadSsmConfig();
  const pool = poolFromConfig(config);
  const adapters: Adapters = {
    storage: new S3Storage(required(config, 'DATA_BUCKET'), region),
    queue: new SqsQueue(region, {
      generation: required(config, 'GENERATION_QUEUE_URL'),
      'exam-events': required(config, 'EXAM_EVENTS_QUEUE_URL'),
    }),
    scheduler: new EventBridgeScheduler(
      region,
      SCHEDULE_GROUP_DEFAULT,
      required(config, 'EXAM_EVENTS_QUEUE_ARN'),
      required(config, 'SCHEDULER_ROLE_ARN'),
    ),
    notifier: new SnsNotifier(region, {
      'leak-alerts': config.get('LEAK_ALERTS_TOPIC_ARN'),
      'ops-alerts': config.get('OPS_ALERTS_TOPIC_ARN'),
      'release-notices': config.get('RELEASE_NOTICES_TOPIC_ARN'),
    }),
    metrics: new LoggingMetrics(),
    config,
    fleet: new AsgWorkerFleet(region, required(config, 'WORKER_ASG_NAME')),
  };
  return { config, pool, adapters };
}
