import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { sdkStreamMixin } from '@smithy/util-stream';
import {
  DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient,
} from '@aws-sdk/client-sqs';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  CreateScheduleCommand, CreateScheduleGroupCommand, DeleteScheduleCommand, SchedulerClient,
} from '@aws-sdk/client-scheduler';
import {
  DbWorkerFleet, EnvConfig, EventBridgeScheduler, LoggingMetrics, S3Storage, SnsNotifier, SqsQueue,
  recordHeartbeat, type Adapters,
} from '@leaktrace/adapters';
import { seedPaper } from '@leaktrace/fingerprint/dist/seed-paper';
import { setAdapters } from '../../api/src/adapters';
import { createApp } from '../../api/src/app';
import { closePool, getPool, query } from '../../api/src/db';
import { wallClockIso } from '../../api/src/time';
import { processMessage, type GenerationMessage } from '../src/process';

process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_REGION = 'ap-south-1';
process.env.AWS_EC2_METADATA_DISABLED = 'true';

const GEN_URL = 'https://sqs.ap-south-1.amazonaws.com/1/leaktrace-generation';
const EVENTS_URL = 'https://sqs.ap-south-1.amazonaws.com/1/leaktrace-exam-events';
const EVENTS_ARN = 'arn:aws:sqs:ap-south-1:1:leaktrace-exam-events';
const BUCKET = 'leaktrace-data-test';
const ist = (minutesAhead: number) => wallClockIso(new Date(Date.now() + minutesAhead * 60_000)).slice(0, 16);

interface FakeMessage { MessageId: string; Body: string; ReceiptHandle: string; receives: number; queue: string }
const messages: FakeMessage[] = [];
const objects = new Map<string, Buffer>();
const schedules = new Map<string, any>();
const published: any[] = [];
let failNextPut: Error | null = null;
let failNextSend: Error | null = null;
let failNextSchedule: Error | null = null;

const sqs = mockClient(SQSClient);
const s3 = mockClient(S3Client);
const sns = mockClient(SNSClient);
const scheduler = mockClient(SchedulerClient);

sqs.on(SendMessageCommand).callsFake(async (input: any) => {
  if (failNextSend) { const err = failNextSend; failNextSend = null; throw err; }
  const msg = { MessageId: randomUUID(), Body: input.MessageBody, ReceiptHandle: randomUUID(), receives: 0, queue: input.QueueUrl };
  messages.push(msg);
  return { MessageId: msg.MessageId };
});
sqs.on(ReceiveMessageCommand).callsFake(async (input: any) => {
  const batch = messages.filter((m) => m.queue === input.QueueUrl).slice(0, input.MaxNumberOfMessages ?? 1);
  for (const m of batch) m.receives++;
  return {
    Messages: batch.map((m) => ({
      MessageId: m.MessageId, Body: m.Body, ReceiptHandle: m.ReceiptHandle,
      Attributes: { ApproximateReceiveCount: String(m.receives) },
    })),
  };
});
sqs.on(DeleteMessageCommand).callsFake(async (input: any) => {
  const i = messages.findIndex((m) => m.ReceiptHandle === input.ReceiptHandle);
  if (i >= 0) messages.splice(i, 1);
  return {};
});
sqs.on(GetQueueAttributesCommand).callsFake(async (input: any) => ({
  Attributes: { ApproximateNumberOfMessages: String(messages.filter((m) => m.queue === input.QueueUrl).length) },
}));
s3.on(PutObjectCommand).callsFake(async (input: any) => {
  if (failNextPut) { const err = failNextPut; failNextPut = null; throw err; }
  objects.set(input.Key, Buffer.from(input.Body));
  return {};
});
s3.on(HeadObjectCommand).callsFake(async (input: any) => {
  if (!objects.has(input.Key)) throw new Error('NotFound');
  return {};
});
s3.on(GetObjectCommand).callsFake(async (input: any) => ({ Body: sdkStreamMixin(Readable.from([objects.get(input.Key)!])) }));
s3.on(DeleteObjectCommand).callsFake(async (input: any) => { objects.delete(input.Key); return {}; });
sns.on(PublishCommand).callsFake(async (input: any) => { published.push(input); return {}; });
scheduler.on(CreateScheduleGroupCommand).resolves({});
scheduler.on(CreateScheduleCommand).callsFake(async (input: any) => {
  if (failNextSchedule) { const err = failNextSchedule; failNextSchedule = null; throw err; }
  schedules.set(input.Name, input);
  return {};
});
scheduler.on(DeleteScheduleCommand).callsFake(async (input: any) => { schedules.delete(input.Name); return {}; });

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1 FROM worker_heartbeats LIMIT 1');
    return true;
  } catch {
    console.warn('Postgres not reachable or not migrated: skipping AWS flow tests');
    return false;
  }
}

describe('AWS mode end to end (SQS, S3, EventBridge, heartbeat fleet)', async () => {
  if (!(await dbReachable())) {
    it.skip('needs Postgres', () => {});
    return;
  }

  const adapters: Adapters = {
    storage: new S3Storage(BUCKET, 'ap-south-1'),
    queue: new SqsQueue('ap-south-1', { generation: GEN_URL, 'exam-events': EVENTS_URL }),
    scheduler: new EventBridgeScheduler('ap-south-1', 'leaktrace', EVENTS_ARN, 'arn:aws:iam::1:role/scheduler'),
    notifier: new SnsNotifier('ap-south-1', {
      'leak-alerts': 'arn:leak', 'ops-alerts': 'arn:ops', 'release-notices': 'arn:release',
    }),
    metrics: new LoggingMetrics(() => undefined),
    config: new EnvConfig([]),
    fleet: new DbWorkerFleet(getPool(), 1),
  };
  setAdapters(adapters);
  const previousMode = process.env.APP_MODE;
  process.env.APP_MODE = 'aws';

  const server = createApp().listen(0);
  server.keepAliveTimeout = 120_000;
  const controller = request.agent(server);
  const supt = request.agent(server);
  const logs: any[] = [];
  const deps = { pool: getPool(), adapters, log: (o: object) => logs.push(o), logError: (o: object) => logs.push(o) };
  let examId = '';

  const workerPass = async () => {
    const received = await adapters.queue.receive<GenerationMessage>('generation', { max: 10, waitSec: 0 });
    for (const m of received) await processMessage(deps, m);
    return received.length;
  };

  beforeAll(async () => {
    await query(
      `TRUNCATE local_queue, local_schedules, notifications, worker_heartbeats, trace_results, trace_cases,
       downloads, copies, variation_points, paper_templates, generation_jobs, exams, rooms, users, centres CASCADE`,
    );
    const hash = await bcrypt.hash('pw-123456', 4);
    await query("INSERT INTO users (email, password_hash, name, role) VALUES ('c@test', $1, 'Ctrl', 'CONTROLLER')", [hash]);
    await controller.post('/api/auth/login').send({ email: 'c@test', password: 'pw-123456' }).expect(200);
    const centre = await controller.post('/api/centres').send({ code: 'A', name: 'Centre A', city: 'Pune' }).expect(201);
    for (const name of ['R1', 'R2', 'R3', 'R4']) {
      await controller.post(`/api/centres/${centre.body.id}/rooms`).send({ name, seats: 5, invigilatorName: 'Inv' }).expect(201);
    }
    await query(
      "INSERT INTO users (email, password_hash, name, role, centre_id) VALUES ('s@test', $1, 'Supt', 'SUPERINTENDENT', $2)",
      [hash, centre.body.id],
    );
    await supt.post('/api/auth/login').send({ email: 's@test', password: 'pw-123456' }).expect(200);
    const exam = await controller.post('/api/exams').send({
      title: 'AWS exam', subject: 'CC', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), durationMin: 60,
    }).expect(201);
    examId = exam.body.id;
    await controller.put(`/api/exams/${examId}/template`).send({ source: seedPaper }).expect(200);
  });
  afterAll(async () => {
    if (previousMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previousMode;
    server.close();
    await closePool();
  });

  it('Generate puts one correct message per room on the SQS generation queue', async () => {
    const res = await controller.post(`/api/exams/${examId}/generate`).expect(202);
    expect(res.body).toMatchObject({ rooms: 4, copies: 20 });
    expect(messages).toHaveLength(4);
    for (const m of messages) {
      expect(m.queue).toBe(GEN_URL);
      const body = JSON.parse(m.Body);
      expect(body).toMatchObject({ examId, jobId: res.body.jobId, rerender: false });
      expect(body.copyIds).toHaveLength(5);
      expect(body.roomId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const status = await controller.get(`/api/exams/${examId}/generation`).expect(200);
    expect(status.body).toMatchObject({
      mode: 'aws', queueDepth: 4, examStatus: 'GENERATING', workers: { desired: 1, inService: 0 }, warnings: [],
    });
    expect(status.body.job).toMatchObject({ total: 20, done: 0, status: 'RUNNING' });
  });

  it('Workers online comes from database heartbeats, not from AWS', async () => {
    await recordHeartbeat(getPool(), 'worker-test');
    const status = await controller.get(`/api/exams/${examId}/generation`).expect(200);
    expect(status.body.workers).toEqual({ desired: 1, inService: 1 });
  });

  it('a worker error is stored and shown, the message stays on the queue, and a retry finishes the job', async () => {
    failNextPut = new Error('AccessDenied: s3:PutObject on arn:aws:s3:::leaktrace-data-test/papers');
    expect(await workerPass()).toBe(4);
    const failing = await controller.get(`/api/exams/${examId}/generation`).expect(200);
    expect(failing.body.job.lastError).toMatch(/AccessDenied: s3:PutObject/);
    expect(failing.body.job.done).toBe(15);
    expect(failing.body.queueDepth).toBe(1);
    expect(logs.some((l) => l.event === 'GENERATION_FAILED' && /AccessDenied/.test(l.error))).toBe(true);

    expect(await workerPass()).toBe(1);
    const done = await controller.get(`/api/exams/${examId}/generation`).expect(200);
    expect(done.body).toMatchObject({ examStatus: 'READY', queueDepth: 0 });
    expect(done.body.job).toMatchObject({ status: 'DONE', done: 20, total: 20, lastError: null });
    expect(messages).toHaveLength(0);
  });

  it('the worker logs each step and uploads each room PDF to the data bucket', async () => {
    const events = logs.map((l) => l.event);
    for (const wanted of ['MESSAGE_RECEIVED', 'ROOM_RENDERING', 'ROOM_RENDERED', 'S3_UPLOAD_START', 'S3_UPLOAD_DONE', 'ROOM_SAVED', 'MESSAGE_DELETED']) {
      expect(events).toContain(wanted);
    }
    const keys = [...objects.keys()].sort();
    expect(keys).toEqual(['R1', 'R2', 'R3', 'R4'].map((r) => `papers/${examId}/A/${r}.pdf`));
    for (const buf of objects.values()) expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    const rows = await query('SELECT DISTINCT storage_key FROM copies WHERE exam_id=$1', [examId]);
    expect(rows.map((r) => r.storage_key).sort()).toEqual(keys);
  });

  it('scheduling creates the two EventBridge schedules aimed at the exam-events queue', async () => {
    await controller.post(`/api/exams/${examId}/schedule`).send({ releaseAt: ist(5), closeAt: ist(60) }).expect(200);
    expect([...schedules.keys()].sort()).toEqual([`leaktrace-close-${examId}`, `leaktrace-release-${examId}`]);
    const release = schedules.get(`leaktrace-release-${examId}`);
    expect(release).toMatchObject({
      GroupName: 'leaktrace', ScheduleExpressionTimezone: 'Asia/Kolkata', ActionAfterCompletion: 'DELETE',
      Target: { Arn: EVENTS_ARN, RoleArn: 'arn:aws:iam::1:role/scheduler' },
    });
    expect(release.ScheduleExpression).toMatch(/^at\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\)$/);
    expect(JSON.parse(release.Target.Input)).toEqual({ type: 'RELEASE', examId });
  });

  it('a failed EventBridge call is shown in plain words and leaves the exam Ready, not falsely Scheduled', async () => {
    const exam = await controller.post('/api/exams').send({
      title: 'Schedule fail exam', subject: 'CC', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), durationMin: 60,
    }).expect(201);
    const id = exam.body.id;
    await controller.put(`/api/exams/${id}/template`).send({ source: seedPaper }).expect(200);
    await controller.post(`/api/exams/${id}/generate`).expect(202);
    while (await workerPass()) { /* drain */ }
    const before = schedules.size;
    failNextSchedule = new Error('AccessDeniedException: scheduler:CreateSchedule');
    const res = await controller.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(5), closeAt: ist(60) });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Could not create the schedule, so nothing was saved: AccessDeniedException/);
    expect((await query('SELECT status, release_at FROM exams WHERE id=$1', [id]))[0]).toMatchObject({ status: 'READY', release_at: null });
    expect(schedules.size).toBe(before);
    await controller.post(`/api/exams/${id}/schedule`).send({ releaseAt: ist(5), closeAt: ist(60) }).expect(200);
    expect((await query('SELECT status FROM exams WHERE id=$1', [id]))[0].status).toBe('SCHEDULED');
    await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'Schedule fail exam' }).expect(200);
  });

  it('a failed SQS send is stored on the job, shown on the page, and Try again recovers', async () => {
    const exam = await controller.post('/api/exams').send({
      title: 'Queue fail exam', subject: 'CC', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), durationMin: 60,
    }).expect(201);
    const id = exam.body.id;
    await controller.put(`/api/exams/${id}/template`).send({ source: seedPaper }).expect(200);
    failNextSend = new Error('AccessDenied: sqs:SendMessage');
    const res = await controller.post(`/api/exams/${id}/generate`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Could not put the job on the queue: AccessDenied: sqs:SendMessage/);
    const status = await controller.get(`/api/exams/${id}/generation`).expect(200);
    expect(status.body.examStatus).toBe('GENERATING');
    expect(status.body.job).toMatchObject({ status: 'FAILED', done: 0 });
    expect(status.body.job.lastError).toMatch(/AccessDenied: sqs:SendMessage/);
    expect(messages).toHaveLength(0);

    await controller.post(`/api/exams/${id}/rerender`).expect(202);
    while (await workerPass()) { /* drain */ }
    const done = await controller.get(`/api/exams/${id}/generation`).expect(200);
    expect(done.body).toMatchObject({ examStatus: 'READY' });
    expect(done.body.job).toMatchObject({ status: 'DONE', done: 20, lastError: null });
    await controller.delete(`/api/exams/${id}`).send({ confirmTitle: 'Queue fail exam' }).expect(200);
  });

  it('the superintendent gets absolute S3 download links once the paper is released', async () => {
    await query("UPDATE exams SET status='RELEASED', release_at = now() - interval '1 minute' WHERE id=$1", [examId]);
    const res = await supt.post(`/api/centre/exams/${examId}/download`).send({}).expect(200);
    expect(res.body.rooms).toHaveLength(4);
    for (const room of res.body.rooms) {
      expect(room.url).toMatch(new RegExp(`^https://${BUCKET}\\.s3\\.ap-south-1\\.amazonaws\\.com/papers/${examId}/A/R\\d\\.pdf\\?`));
      expect(room.url).toContain('X-Amz-Expires=120');
    }
  });

  it('deleting the exam removes its S3 files and EventBridge schedules', async () => {
    expect(objects.size).toBe(4);
    const res = await controller.delete(`/api/exams/${examId}`).send({ confirmTitle: 'AWS exam' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, filesRemoved: 4, filesFailed: 0, schedulesFailed: 0 });
    expect(objects.size).toBe(0);
    expect(schedules.size).toBe(0);
    expect((await query('SELECT 1 FROM exams WHERE id=$1', [examId])).length).toBe(0);
    const trail = await query("SELECT details FROM audit_events WHERE action='EXAM_DELETED' AND entity_id=$1", [examId]);
    expect(trail[0].details).toMatchObject({ title: 'AWS exam', files: 4 });
  });

  it('a failed S3 delete is logged and reported but does not block the delete', async () => {
    const exam = await controller.post('/api/exams').send({
      title: 'Second AWS exam', subject: 'CC', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), durationMin: 60,
    }).expect(201);
    await controller.put(`/api/exams/${exam.body.id}/template`).send({ source: seedPaper }).expect(200);
    await controller.post(`/api/exams/${exam.body.id}/generate`).expect(202);
    while (await workerPass()) { /* drain */ }
    expect(objects.size).toBe(4);
    s3.on(DeleteObjectCommand).rejects(new Error('AccessDenied: s3:DeleteObject'));
    const res = await controller.delete(`/api/exams/${exam.body.id}`).send({ confirmTitle: 'Second AWS exam' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, filesRemoved: 0, filesFailed: 4 });
    expect((await query('SELECT 1 FROM exams WHERE id=$1', [exam.body.id])).length).toBe(0);
  });
});
