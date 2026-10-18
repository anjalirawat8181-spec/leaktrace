import type { Pool } from 'pg';
import type { Config, MetricName, Metrics, Notifier, NotifyTopic, WorkerFleet } from '../interfaces';

export class LocalNotifier implements Notifier {
  constructor(private readonly pool: Pool, private readonly log: (o: object) => void = (o) => console.log(JSON.stringify(o))) {}

  async publish(topic: NotifyTopic, subject: string, body: string): Promise<void> {
    await this.pool.query('INSERT INTO notifications (topic, subject, body) VALUES ($1,$2,$3)', [
      topic, subject, body,
    ]);
    this.log({ event: 'NOTIFICATION', topic, subject });
  }
}

export class LocalMetrics implements Metrics {
  readonly counters = new Map<string, number>();

  constructor(private readonly log: (o: object) => void = (o) => console.log(JSON.stringify(o))) {}

  count(name: MetricName, value = 1): void {
    const total = (this.counters.get(name) ?? 0) + value;
    this.counters.set(name, total);
    this.log({ event: 'METRIC', name, value, total });
  }
}

export class EnvConfig implements Config {
  constructor(requiredKeys: string[] = [], private readonly env: NodeJS.ProcessEnv = process.env) {
    const missing = requiredKeys.filter((key) => !env[key]);
    if (missing.length) throw new Error(`Missing required config: ${missing.join(', ')}`);
  }

  get(key: string): string | undefined {
    return this.env[key];
  }
}

export const HEARTBEAT_WINDOW_SEC = 30;

export async function recordHeartbeat(pool: Pool, workerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO worker_heartbeats (worker_id, at) VALUES ($1, now())
     ON CONFLICT (worker_id) DO UPDATE SET at = now()`,
    [workerId],
  );
}

export class LocalWorkerFleet implements WorkerFleet {
  constructor(private readonly pool: Pool, private readonly desired = 1) {}

  async status() {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM worker_heartbeats
       WHERE at > now() - make_interval(secs => $1)`,
      [HEARTBEAT_WINDOW_SEC],
    );
    return { desired: this.desired, inService: rows[0].n as number };
  }
}
