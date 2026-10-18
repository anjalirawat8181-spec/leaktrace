import { Pool, type QueryResultRow } from 'pg';
import { config } from './config';

let pool: Pool | undefined;

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: config.databaseUrl });
  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function audit(
  actorUserId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await query(
    'INSERT INTO audit_events (actor_user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
    [actorUserId, action, entity, entityId, JSON.stringify(details)],
  );
}
