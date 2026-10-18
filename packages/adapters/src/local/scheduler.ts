import type { Pool } from 'pg';
import type { Queue, Scheduler } from '../interfaces';

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock ISO string in `timeZone` ("2026-10-19T12:45:00") to a UTC Date. */
export function localIsoToUtc(atLocalISO: string, timeZone: string): Date {
  if (HAS_OFFSET.test(atLocalISO)) return new Date(atLocalISO);
  const wallAsUtc = new Date(`${atLocalISO}Z`).getTime();
  if (Number.isNaN(wallAsUtc)) throw new Error(`Invalid date ${atLocalISO}`);
  let utc = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  utc = wallAsUtc - zoneOffsetMs(utc, timeZone);
  return new Date(utc);
}

export class LocalScheduler implements Scheduler {
  private timer?: NodeJS.Timeout;

  constructor(private readonly pool: Pool, private readonly queue: Queue) {}

  async scheduleOnce(name: string, atLocalISO: string, timezone: string, payload: unknown) {
    const fireAt = localIsoToUtc(atLocalISO, timezone);
    await this.pool.query(
      `INSERT INTO local_schedules (name, fire_at, payload, fired) VALUES ($1,$2,$3,false)
       ON CONFLICT (name) DO UPDATE SET fire_at = $2, payload = $3, fired = false`,
      [name, fireAt.toISOString(), JSON.stringify(payload)],
    );
  }

  async cancel(name: string): Promise<void> {
    await this.pool.query('DELETE FROM local_schedules WHERE name = $1', [name]);
  }

  /** Delivers every due schedule to the "exam-events" queue. Returns how many fired. */
  async fireDue(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT name, payload FROM local_schedules WHERE NOT fired AND fire_at <= now()
         ORDER BY fire_at FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows) {
        await this.queue.send('exam-events', row.payload);
        await client.query('UPDATE local_schedules SET fired = true WHERE name = $1', [row.name]);
      }
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  startPoller(intervalMs = 10_000, onError: (err: unknown) => void = console.error): void {
    this.stopPoller();
    this.timer = setInterval(() => this.fireDue().catch(onError), intervalMs);
    this.timer.unref();
  }

  stopPoller(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
