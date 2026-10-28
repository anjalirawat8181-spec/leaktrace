import type { Pool } from 'pg';
import { LocalWorkerFleet } from '../local/misc';

/**
 * Workers online in AWS mode. Each worker writes a row to worker_heartbeats every ~15 s; this counts the rows
 * from the last 60 s. It needs no AWS permissions, only the database the API already uses.
 */
export class DbWorkerFleet extends LocalWorkerFleet {
  constructor(pool: Pool, desired = 1) {
    super(pool, desired, 60);
  }
}
