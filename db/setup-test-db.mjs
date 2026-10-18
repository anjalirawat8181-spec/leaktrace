import { spawnSync } from 'node:child_process';

const url = 'postgres://leaktrace:leaktrace@localhost:5434/leaktrace_test';
spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'createdb', '-U', 'leaktrace', 'leaktrace_test'], {
  stdio: 'ignore',
});
const result = spawnSync(
  process.execPath,
  ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', '-m', 'db/migrations', 'up'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } },
);
process.exit(result.status ?? 1);
