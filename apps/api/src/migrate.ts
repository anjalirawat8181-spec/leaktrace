import { connectDeployPool } from './deploy-db';
import { MIGRATIONS } from './migrations.generated';

const LOCK_ID = 727101;
const INITIAL = MIGRATIONS[0].name;

async function main() {
  const pool = await connectDeployPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );

    const applied = new Set<string>(
      (await client.query('SELECT name FROM app_migrations')).rows.map((r) => r.name),
    );
    if (!applied.size) {
      const existing = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'centres'",
      );
      if (existing.rows.length) {
        await client.query('INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [INITIAL]);
        applied.add(INITIAL);
        console.log(`Existing schema found; recorded ${INITIAL} as applied.`);
      }
    }

    let ran = 0;
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO app_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`);
      }
      console.log(`Applied ${migration.name}`);
      ran++;
    }
    console.log(ran ? `Migrations done (${ran} applied).` : 'Database is up to date.');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
