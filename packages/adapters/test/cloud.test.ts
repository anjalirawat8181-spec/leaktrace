import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ActivityGate, GatedQueue, InProcessFleet, bootstrapCloudAdapters, r2Endpoint, type Queue,
} from '../src';

const s3 = mockClient(S3Client);

afterEach(() => {
  s3.reset();
  vi.useRealTimers();
});

const ENV = {
  DATABASE_URL: 'postgres://u:p@db.example/neondb',
  JWT_SECRET: 'jwt',
  FINGERPRINT_KEY: 'fp',
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIATESTKEY',
  R2_SECRET_ACCESS_KEY: 'secret-test-value',
  R2_BUCKET: 'leaktrace-test',
};

function fakeQueue(): Queue & { received: number } {
  const q = {
    received: 0,
    send: vi.fn(async () => undefined),
    receive: vi.fn(async () => { q.received += 1; return []; }),
    delete: vi.fn(async () => undefined),
    depth: vi.fn(async () => 0),
  };
  return q as unknown as Queue & { received: number };
}

describe('bootstrapCloudAdapters', () => {
  it('refuses to start when a required value is missing', () => {
    const { R2_BUCKET: _omit, ...rest } = ENV;
    expect(() => bootstrapCloudAdapters(rest as NodeJS.ProcessEnv)).toThrow(/R2_BUCKET/);
  });

  it('builds every adapter from environment variables', async () => {
    const runtime = bootstrapCloudAdapters(ENV as NodeJS.ProcessEnv);
    expect(Object.keys(runtime.adapters).sort()).toEqual(
      ['config', 'fleet', 'metrics', 'notifier', 'queue', 'scheduler', 'storage'],
    );
    expect(runtime.adapters.config.get('R2_BUCKET')).toBe('leaktrace-test');
    expect(await runtime.adapters.fleet.status()).toEqual({ desired: 1, inService: 0 });
    runtime.fleet.setRunning(true);
    expect(await runtime.adapters.fleet.status()).toEqual({ desired: 1, inService: 1 });
    await runtime.pool.end();
  });

  it('keeps the connection pool small', async () => {
    const runtime = bootstrapCloudAdapters(ENV as NodeJS.ProcessEnv);
    expect((runtime.pool as unknown as { options: { max: number } }).options.max).toBe(5);
    await runtime.pool.end();
  });

  it('points storage at the R2 endpoint and signs short-lived URLs', async () => {
    const runtime = bootstrapCloudAdapters(ENV as NodeJS.ProcessEnv);
    const down = new URL(await runtime.adapters.storage.signedDownloadUrl('exams/a.pdf', 120));
    expect(down.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(down.pathname).toBe('/leaktrace-test/exams/a.pdf');
    expect(down.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(down.searchParams.get('X-Amz-Credential')).toContain('AKIATESTKEY/');
    expect(down.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');

    const up = new URL(await runtime.adapters.storage.signedUploadUrl('leaks/b.png', 'image/png', 300));
    expect(up.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(up.searchParams.get('X-Amz-Expires')).toBe('300');
    await runtime.pool.end();
  });

  it('writes objects to the configured bucket', async () => {
    s3.on(PutObjectCommand).resolves({});
    const runtime = bootstrapCloudAdapters(ENV as NodeJS.ProcessEnv);
    await runtime.adapters.storage.put('exams/a.pdf', Buffer.from('x'), 'application/pdf');
    const call = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(call).toMatchObject({ Bucket: 'leaktrace-test', Key: 'exams/a.pdf', ContentType: 'application/pdf' });
    await runtime.pool.end();
  });

  it('builds the R2 endpoint from the account id', () => {
    expect(r2Endpoint('abc')).toBe('https://abc.r2.cloudflarestorage.com');
  });
});

describe('ActivityGate and GatedQueue', () => {
  it('is active only for a while after the last touch', () => {
    vi.useFakeTimers();
    const gate = new ActivityGate(1000);
    expect(gate.isActive()).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(gate.isActive()).toBe(false);
    gate.touch();
    expect(gate.isActive()).toBe(true);
  });

  it('reads the database while active', async () => {
    const inner = fakeQueue();
    const queue = new GatedQueue(inner, new ActivityGate(60_000));
    await queue.receive('generation', { waitSec: 20 });
    expect(inner.received).toBe(1);
  });

  it('does not touch the database while idle, and wakes up when a message is sent', async () => {
    vi.useFakeTimers();
    const inner = fakeQueue();
    const gate = new ActivityGate(1000);
    const queue = new GatedQueue(inner, gate);
    vi.advanceTimersByTime(5000);
    expect(gate.isActive()).toBe(false);

    const pending = queue.receive('generation', { waitSec: 20 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual([]);
    expect(inner.received).toBe(0);

    const second = queue.receive('generation', { waitSec: 20 });
    await queue.send('generation', { a: 1 });
    expect(await second).toEqual([]);
    expect(gate.isActive()).toBe(true);
    expect(inner.received).toBe(0);
  });
});

describe('InProcessFleet', () => {
  it('reports a worker only while the loop is running', async () => {
    const fleet = new InProcessFleet();
    expect((await fleet.status()).inService).toBe(0);
    fleet.setRunning(true);
    expect((await fleet.status()).inService).toBe(1);
  });
});
