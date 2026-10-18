export interface Storage {
  put(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  signedDownloadUrl(key: string, ttlSec: number): Promise<string>;
  signedUploadUrl(key: string, contentType: string, ttlSec: number): Promise<string>;
}

export type QueueName = 'generation' | 'exam-events' | 'generation-dlq' | (string & {});

export interface QueueMessage<T = any> {
  id: string;
  body: T;
  receiptHandle: string;
  receiveCount: number;
}

export interface Queue {
  send(queue: QueueName, body: unknown): Promise<void>;
  receive<T = any>(queue: QueueName, opts?: { max?: number; waitSec?: number }): Promise<QueueMessage<T>[]>;
  delete(queue: QueueName, receiptHandle: string): Promise<void>;
  depth(queue: QueueName): Promise<number>;
}

export interface Scheduler {
  scheduleOnce(name: string, atLocalISO: string, timezone: string, payload: unknown): Promise<void>;
  cancel(name: string): Promise<void>;
}

export type NotifyTopic = 'leak-alerts' | 'ops-alerts' | 'release-notices';

export interface Notifier {
  publish(topic: NotifyTopic, subject: string, body: string): Promise<void>;
}

export type MetricName =
  | 'DownloadsOutsideWindow' | 'CopiesGenerated' | 'TraceRuns' | 'LeaksIdentified';

export interface Metrics {
  count(name: MetricName, value?: number): void;
}

export interface Config {
  get(key: string): string | undefined;
}

export interface WorkerFleet {
  status(): Promise<{ desired: number; inService: number }>;
}

export interface Adapters {
  storage: Storage;
  queue: Queue;
  scheduler: Scheduler;
  notifier: Notifier;
  metrics: Metrics;
  config: Config;
  fleet: WorkerFleet;
}
