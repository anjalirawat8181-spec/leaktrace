import { afterEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient,
} from '@aws-sdk/client-sqs';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  ConflictException, CreateScheduleCommand, CreateScheduleGroupCommand, DeleteScheduleCommand,
  ResourceNotFoundException, SchedulerClient, UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
import {
  DbWorkerFleet, EventBridgeScheduler, S3Storage, SnsNotifier, SqsQueue, SsmConfig, bootstrapAwsAdapters,
} from '../src';

const ssm = mockClient(SSMClient);
const sqs = mockClient(SQSClient);
const sns = mockClient(SNSClient);
const scheduler = mockClient(SchedulerClient);
const s3 = mockClient(S3Client);

afterEach(() => {
  for (const m of [ssm, sqs, sns, scheduler, s3]) m.reset();
});

const PARAMS: Record<string, string> = {
  DB_HOST: 'db.example', DB_NAME: 'leaktrace', DB_USER: 'app', DB_PASSWORD: 'pw', DB_ADMIN_PASSWORD: 'admin',
  JWT_SECRET: 'jwt', FINGERPRINT_KEY: 'fp', DATA_BUCKET: 'leaktrace-data-ccl2026',
  GENERATION_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/1/gen',
  EXAM_EVENTS_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/1/events',
  EXAM_EVENTS_QUEUE_ARN: 'arn:aws:sqs:ap-south-1:1:events',
  LEAK_ALERTS_TOPIC_ARN: 'arn:leak', OPS_ALERTS_TOPIC_ARN: 'arn:ops', RELEASE_NOTICES_TOPIC_ARN: 'arn:release',
  SCHEDULER_ROLE_ARN: 'arn:role', WORKER_ASG_NAME: 'leaktrace-workers',
};

function mockParams() {
  const entries = Object.entries(PARAMS).map(([k, v]) => ({ Name: `/leaktrace/prod/sub/${k}`, Value: v }));
  ssm.on(GetParametersByPathCommand, { NextToken: undefined })
    .resolves({ Parameters: entries.slice(0, 8), NextToken: 'page2' });
  ssm.on(GetParametersByPathCommand, { NextToken: 'page2' }).resolves({ Parameters: entries.slice(8) });
}

describe('SsmConfig', () => {
  it('loads every page recursively with decryption, keyed by last path segment', async () => {
    mockParams();
    const config = await SsmConfig.load('ap-south-1', '/leaktrace/prod');
    for (const [k, v] of Object.entries(PARAMS)) expect(config.get(k)).toBe(v);
    const first = ssm.commandCalls(GetParametersByPathCommand)[0].args[0].input;
    expect(first).toMatchObject({ Path: '/leaktrace/prod', Recursive: true, WithDecryption: true });
    expect(ssm.commandCalls(GetParametersByPathCommand)).toHaveLength(2);
  });
});

describe('bootstrapAwsAdapters', () => {
  it('builds an SSL pool and the full adapter set from SSM', async () => {
    mockParams();
    const runtime = await bootstrapAwsAdapters();
    const opts = (runtime.pool as any).options;
    expect(opts).toMatchObject({ host: 'db.example', database: 'leaktrace', user: 'app', password: 'pw' });
    expect(opts.ssl).toBeTruthy();
    expect(Object.keys(runtime.adapters).sort()).toEqual(['config', 'fleet', 'metrics', 'notifier', 'queue', 'scheduler', 'storage']);
    await runtime.pool.end();
  });

  it('fails clearly when a required parameter is missing', async () => {
    ssm.on(GetParametersByPathCommand).resolves({ Parameters: [{ Name: '/leaktrace/prod/DB_HOST', Value: 'x' }] });
    await expect(bootstrapAwsAdapters()).rejects.toThrow(/Missing SSM parameters: DB_NAME, DB_USER/);
  });

  it('lets a worker start with only the settings it uses, and blocks the API-only adapters', async () => {
    const needed = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DATA_BUCKET', 'GENERATION_QUEUE_URL'];
    ssm.on(GetParametersByPathCommand).resolves({
      Parameters: needed.map((k) => ({ Name: `/leaktrace/prod/${k}`, Value: PARAMS[k] })),
    });
    const runtime = await bootstrapAwsAdapters('worker');
    expect(await runtime.adapters.queue.depth('generation-dlq')).toBe(0);
    expect(() => runtime.adapters.scheduler.cancel('x')).toThrow(/not available in this process/);
    await runtime.pool.end();
  });

  it('only the API insists on the scheduler and queue settings', async () => {
    const needed = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DATA_BUCKET', 'GENERATION_QUEUE_URL'];
    ssm.on(GetParametersByPathCommand).resolves({
      Parameters: needed.map((k) => ({ Name: `/leaktrace/prod/${k}`, Value: PARAMS[k] })),
    });
    await expect(bootstrapAwsAdapters('api')).rejects.toThrow(/EXAM_EVENTS_QUEUE_URL, EXAM_EVENTS_QUEUE_ARN, SCHEDULER_ROLE_ARN/);
  });

  it('uses an optional dead-letter queue URL when one is configured', async () => {
    ssm.on(GetParametersByPathCommand).resolves({
      Parameters: [
        ...Object.entries(PARAMS).map(([k, v]) => ({ Name: `/leaktrace/prod/${k}`, Value: v })),
        { Name: '/leaktrace/prod/GENERATION_DLQ_URL', Value: 'https://sqs.ap-south-1.amazonaws.com/1/dlq' },
      ],
    });
    sqs.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '2' } });
    const runtime = await bootstrapAwsAdapters('worker');
    expect(await runtime.adapters.queue.depth('generation-dlq')).toBe(2);
    expect(sqs.commandCalls(GetQueueAttributesCommand)[0].args[0].input.QueueUrl).toBe('https://sqs.ap-south-1.amazonaws.com/1/dlq');
    await runtime.pool.end();
  });
});

describe('SqsQueue', () => {
  const queue = new SqsQueue('ap-south-1', { generation: 'https://q/gen' });

  it('sends JSON, long-polls with receive counts, and deletes by receipt handle', async () => {
    sqs.on(ReceiveMessageCommand).resolves({
      Messages: [{ MessageId: 'm1', Body: '{"examId":"e1"}', ReceiptHandle: 'r1', Attributes: { ApproximateReceiveCount: '2' } }],
    });
    await queue.send('generation', { examId: 'e1' });
    expect(sqs.commandCalls(SendMessageCommand)[0].args[0].input).toEqual({ QueueUrl: 'https://q/gen', MessageBody: '{"examId":"e1"}' });
    const msgs = await queue.receive('generation', { max: 50, waitSec: 60 });
    expect(msgs).toEqual([{ id: 'm1', body: { examId: 'e1' }, receiptHandle: 'r1', receiveCount: 2 }]);
    expect(sqs.commandCalls(ReceiveMessageCommand)[0].args[0].input).toMatchObject({ MaxNumberOfMessages: 10, WaitTimeSeconds: 20 });
    await queue.delete('generation', 'r1');
    expect(sqs.commandCalls(DeleteMessageCommand)[0].args[0].input).toEqual({ QueueUrl: 'https://q/gen', ReceiptHandle: 'r1' });
  });

  it('reports depth, and 0 for a queue with no configured URL (the DLQ)', async () => {
    sqs.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '7' } });
    expect(await queue.depth('generation')).toBe(7);
    expect(await queue.depth('generation-dlq')).toBe(0);
    await expect(queue.send('nope', {})).rejects.toThrow(/No SQS queue URL/);
  });
});

describe('SnsNotifier', () => {
  it('publishes to the topic mapped for each alert type', async () => {
    const notifier = new SnsNotifier('ap-south-1', { 'leak-alerts': 'arn:leak', 'ops-alerts': 'arn:ops', 'release-notices': undefined });
    await notifier.publish('leak-alerts', 'LEAK TRACED: x', 'body');
    expect(sns.commandCalls(PublishCommand)[0].args[0].input).toEqual({ TopicArn: 'arn:leak', Subject: 'LEAK TRACED: x', Message: 'body' });
    await expect(notifier.publish('release-notices', 's', 'b')).rejects.toThrow(/No SNS topic ARN/);
  });
});

describe('EventBridgeScheduler', () => {
  const sched = new EventBridgeScheduler('ap-south-1', 'leaktrace', 'arn:aws:sqs:ap-south-1:1:events', 'arn:role');

  it('creates a one-time schedule in local time targeting the queue, updating on conflict', async () => {
    scheduler.on(CreateScheduleGroupCommand).rejects(new ConflictException({ message: 'exists', $metadata: {} }));
    scheduler.on(CreateScheduleCommand).rejectsOnce(new ConflictException({ message: 'exists', $metadata: {} }));
    await sched.scheduleOnce('leaktrace-release-e1', '2026-10-21T09:15:00', 'Asia/Kolkata', { type: 'RELEASE', examId: 'e1' });
    const input = scheduler.commandCalls(UpdateScheduleCommand)[0].args[0].input;
    expect(input).toMatchObject({
      Name: 'leaktrace-release-e1', GroupName: 'leaktrace', ScheduleExpression: 'at(2026-10-21T09:15:00)',
      ScheduleExpressionTimezone: 'Asia/Kolkata', FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
      Target: { Arn: 'arn:aws:sqs:ap-south-1:1:events', RoleArn: 'arn:role', Input: '{"type":"RELEASE","examId":"e1"}' },
    });
  });

  it('ignores cancel of a missing schedule', async () => {
    scheduler.on(DeleteScheduleCommand).rejects(new ResourceNotFoundException({ message: 'gone', $metadata: {} }));
    await expect(sched.cancel('x')).resolves.toBeUndefined();
  });
});

describe('S3Storage', () => {
  const storage = new S3Storage('leaktrace-data-ccl2026', 'ap-south-1');

  it('puts, gets bytes, checks existence and presigns URLs for the bucket', async () => {
    s3.on(GetObjectCommand).resolves({ Body: sdkStreamMixin(Readable.from([Buffer.from('%PDF')])) });
    s3.on(HeadObjectCommand, { Key: 'missing' }).rejects(new Error('NotFound'));
    await storage.put('papers/a.pdf', Buffer.from('x'), 'application/pdf');
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({ Bucket: 'leaktrace-data-ccl2026', Key: 'papers/a.pdf', ContentType: 'application/pdf' });
    expect((await storage.get('papers/a.pdf')).toString()).toBe('%PDF');
    expect(await storage.exists('papers/a.pdf')).toBe(true);
    expect(await storage.exists('missing')).toBe(false);
    await storage.delete('papers/a.pdf');
    expect(s3.commandCalls(DeleteObjectCommand)[0].args[0].input).toEqual({ Bucket: 'leaktrace-data-ccl2026', Key: 'papers/a.pdf' });
    const url = await storage.signedDownloadUrl('papers/a.pdf', 120);
    expect(url).toMatch(/^https:\/\/leaktrace-data-ccl2026\.s3\.ap-south-1\.amazonaws\.com\/papers\/a\.pdf\?.*X-Amz-Expires=120/);
  });
});

describe('DbWorkerFleet', () => {
  it('counts heartbeats from the last 60 seconds, with no AWS calls', async () => {
    const calls: any[] = [];
    const pool: any = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows: [{ n: 2 }] }; } };
    expect(await new DbWorkerFleet(pool, 1).status()).toEqual({ desired: 1, inService: 2 });
    expect(calls[0].sql).toMatch(/worker_heartbeats/);
    expect(calls[0].params).toEqual([60]);
  });
});
