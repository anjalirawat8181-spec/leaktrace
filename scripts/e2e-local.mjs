// Full local walkthrough as every role, against real processes (API + worker + Postgres), in its own database.
//
//   npm run e2e
//
// Needs Docker (for Postgres). It waits for a real scheduled release (about 1-2 minutes).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.loadEnvFile('.env');

const PORT = 4102;
const API = `http://127.0.0.1:${PORT}`;
const DB_NAME = 'leaktrace_e2e';
const DB_URL = `postgres://leaktrace:leaktrace@localhost:5434/${DB_NAME}`;
const DATA_DIR = path.join(os.tmpdir(), 'leaktrace-e2e-data');
const PASSWORD = process.env.DEMO_PASSWORD;
const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaktrace-e2e-'));
const env = {
  ...process.env, DATABASE_URL: DB_URL, API_PORT: String(PORT), DATA_DIR, LOGIN_RATE_LIMIT: '500', TRUST_PROXY: 'false',
};
delete env.APP_MODE;

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;

function step(title) { console.log(`\n${title}`); }
function ok(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed++;
  console.log(`  ok  ${message}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', env, cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function start(name, args) {
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, { env, cwd: root, stdio: ['ignore', log, log] });
  children.push(child);
}
async function waitFor(url, label) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${label} did not start; logs in ${LOG_DIR}`);
}

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${API}${url}`, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return {
    get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b),
    login: async (email) => { const r = await call('POST', '/api/auth/login', { email, password: PASSWORD }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`); return r.body; },
  };
}

const ist = (minutes) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(Date.now() + minutes * 60_000)).replace(' ', 'T');

async function until(label, fn, timeoutMs, everyMs = 1000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(everyMs);
  }
}

async function main() {
  console.log('Preparing an isolated database and starting the API and worker…');
  run('docker', ['compose', 'up', '-d', '--wait']);
  run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'leaktrace', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`]);
  run('docker', ['compose', 'exec', '-T', 'postgres', 'createdb', '-U', 'leaktrace', DB_NAME]);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  run(process.execPath, ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', '-m', 'db/migrations', 'up']);
  run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'db/seed/seed.ts']);
  const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  start('api', [tsx, 'apps/api/src/server.ts']);
  start('worker', [tsx, 'apps/worker/src/main.ts']);
  await waitFor(`${API}/api/health`, 'API');

  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const { renderTemplate } = createRequire(import.meta.url)('./../packages/fingerprint');
  const { seedPaper } = createRequire(import.meta.url)('./../packages/fingerprint/dist/seed-paper');

  const controller = client();
  const supt = client();
  const suptOther = client();
  const auditor = client();

  step('1. Controller opens the seeded exam');
  await controller.login('controller@demo');
  const exams = (await controller.get('/api/exams')).body;
  const exam = exams.find((e) => e.title === 'Cloud Computing Unit Test 1');
  ok(exam && exam.status === 'DRAFT', 'the demo exam is in Draft');
  const detail = (await controller.get(`/api/exams/${exam.id}`)).body;
  ok(detail.template && detail.template.sufficient, `its paper is saved with ${detail.template.points.length} choices and enough capacity`);

  step('2. Controller generates 20 copies (real worker)');
  const before = (await controller.get(`/api/exams/${exam.id}/generation`)).body;
  ok(before.job === null && before.mode === 'local', 'before clicking Generate there is no job');
  const gen = await controller.post(`/api/exams/${exam.id}/generate`);
  ok(gen.status === 202 && gen.body.copies === 20 && gen.body.rooms === 4, 'Generate queues 4 rooms / 20 copies');
  const ready = await until('exam READY', async () => {
    const s = (await controller.get(`/api/exams/${exam.id}/generation`)).body;
    return s.examStatus === 'READY' ? s : null;
  }, 90_000);
  ok(ready.job.status === 'DONE' && ready.job.done === 20 && ready.job.lastError === null, 'the job finished 20 / 20 with no error');
  ok(ready.workers.inService === 1 && ready.queueDepth === 0 && ready.deadLetterDepth === 0, 'one worker online, queue empty, no failed rooms');
  const files = fs.readdirSync(path.join(DATA_DIR, 'papers', exam.id), { recursive: true }).filter((f) => f.endsWith('.pdf'));
  ok(files.length === 4, 'four room PDFs were stored');

  step('3. Controller schedules the release 2 minutes ahead');
  let sched = await controller.post(`/api/exams/${exam.id}/schedule`, { releaseAt: ist(2), closeAt: ist(40) });
  if (sched.status === 422) sched = await controller.post(`/api/exams/${exam.id}/schedule`, { releaseAt: ist(3), closeAt: ist(40) });
  ok(sched.status === 200 && sched.body.status === 'SCHEDULED', 'schedule accepted');
  const bad = await controller.post(`/api/exams/${exam.id}/schedule`, { releaseAt: ist(-5), closeAt: ist(40) });
  ok(bad.status === 422 && /at least 1 minute/.test(bad.body.error), 'a release time in the past is refused in plain words');

  step('4. Superintendent sees it Locked, and an early download is blocked');
  await supt.login('supt.c1@demo');
  await suptOther.login('supt.c2@demo');
  const locked = (await supt.get('/api/centre/exams')).body.exams.find((e) => e.id === exam.id);
  ok(locked && locked.state === 'LOCKED' && locked.rooms.length === 2, 'status is LOCKED and only their 2 rooms are listed');
  const early = await supt.post(`/api/centre/exams/${exam.id}/download`);
  ok(early.status === 403 && early.body.reason === 'TOO_EARLY', 'an early download gets 403 TOO_EARLY');

  step('5. Wait for the real scheduled release…');
  const opened = await until('exam released', async () => {
    const e = (await supt.get('/api/centre/exams')).body.exams.find((x) => x.id === exam.id);
    return e && e.state === 'OPEN' ? e : null;
  }, 5 * 60_000, 3000);
  ok(opened.status === 'RELEASED', 'the scheduler released the exam by itself (status Released, state OPEN)');
  const dl = await supt.post(`/api/centre/exams/${exam.id}/download`);
  ok(dl.status === 200 && dl.body.rooms.length === 2, 'superintendent C1 downloads both room PDFs');
  const pdf = Buffer.from(await (await fetch(`${API}${dl.body.rooms[0].url}`)).arrayBuffer());
  ok(pdf.subarray(0, 4).toString() === '%PDF', 'the download link serves a real PDF');
  const otherDl = (await suptOther.post(`/api/centre/exams/${exam.id}/download`));
  ok(otherDl.status === 200 && otherDl.body.rooms.every((r) => r.room.startsWith('C2')), 'the other centre only gets its own rooms');

  step('6. Controller traces leaked text from one copy');
  const { rows: [copy] } = await db.query(
    `SELECT c.serial, c.seat_no, c.choice_vector, ce.code, r.name AS room, r.invigilator_name, t.parsed
     FROM copies c JOIN centres ce ON ce.id=c.centre_id JOIN rooms r ON r.id=c.room_id
     JOIN paper_templates t ON t.exam_id=c.exam_id WHERE c.exam_id=$1 AND c.serial=7`, [exam.id],
  );
  const paper = renderTemplate(copy.parsed, copy.choice_vector);
  const leak = paper.split(/\n\n/).filter((p) => /^\d+\./.test(p.trim())).slice(0, 3).join('\n\n')
    .replace('storage', 'storge').replace('Amazon', 'Amazn');
  const created = await controller.post('/api/trace/cases', { examId: exam.id, title: 'E2E leak', leakText: leak });
  ok(created.status === 201, 'leak case created');
  const traced = await controller.post(`/api/trace/cases/${created.body.id}/run`);
  ok(traced.status === 200 && traced.body.status === 'IDENTIFIED', 'the trace says IDENTIFIED despite two typos');
  ok(traced.body.top.serial === copy.serial && traced.body.top.seat === copy.seat_no && traced.body.top.centre.code === copy.code
    && traced.body.top.room === copy.room && traced.body.top.invigilator === copy.invigilator_name,
  `it names copy #${copy.serial}: centre ${copy.code}, ${copy.room}, seat ${copy.seat_no}, ${copy.invigilator_name}`);
  ok(traced.body.top.downloadedBy.length > 0, 'it says who downloaded that room bundle');

  step('7. Auditor reads the audit log and alerts, and cannot change anything');
  await auditor.login('auditor@demo');
  const feed = (await auditor.get('/api/audit')).body;
  const actions = new Set(feed.map((r) => r.action));
  for (const a of ['EXAM_SCHEDULED', 'EXAM_RELEASED', 'DOWNLOAD', 'DOWNLOAD_DENIED', 'TRACE_RUN', 'LEAK_IDENTIFIED', 'GENERATION_STARTED']) {
    ok(actions.has(a), `audit log has ${a}`);
  }
  ok(feed.find((r) => r.action === 'DOWNLOAD_DENIED').denied === true, 'the blocked attempt is marked as denied (red row)');
  const alerts = (await auditor.get('/api/notifications')).body;
  ok(alerts.some((n) => n.topic === 'leak-alerts') && alerts.some((n) => n.topic === 'ops-alerts') && alerts.some((n) => n.topic === 'release-notices'),
    'alerts contain a leak alert, a blocked-download alert and a release notice');
  ok((await auditor.post(`/api/exams/${exam.id}/generate`)).status === 403, 'auditor cannot generate');
  ok((await auditor.del(`/api/exams/${exam.id}`, { confirmTitle: exam.title })).status === 403, 'auditor cannot delete');
  ok((await supt.del(`/api/exams/${exam.id}`, { confirmTitle: exam.title })).status === 403, 'superintendent cannot delete');
  ok((await supt.get('/api/audit')).status === 403, 'superintendent cannot read the audit log');

  step('8. Controller deletes the exam and it disappears for everyone');
  const wrong = await controller.del(`/api/exams/${exam.id}`, { confirmTitle: 'wrong title' });
  ok(wrong.status === 400, 'deleting needs the exact title');
  const del = await controller.del(`/api/exams/${exam.id}`, { confirmTitle: exam.title });
  ok(del.status === 200 && del.body.deleted && del.body.filesRemoved === 4 && del.body.filesFailed === 0, 'delete succeeds and removes the 4 PDFs');
  ok(!(await controller.get('/api/exams')).body.some((e) => e.id === exam.id), 'gone from the controller list');
  ok(!(await auditor.get('/api/exams')).body.some((e) => e.id === exam.id), 'gone from the auditor list');
  ok(!(await supt.get('/api/centre/exams')).body.exams.some((e) => e.id === exam.id), 'gone from superintendent C1 screen');
  ok(!(await suptOther.get('/api/centre/exams')).body.exams.some((e) => e.id === exam.id), 'gone from superintendent C2 screen');
  ok(!fs.existsSync(path.join(DATA_DIR, 'papers', exam.id)) || fs.readdirSync(path.join(DATA_DIR, 'papers', exam.id), { recursive: true }).filter((f) => f.endsWith('.pdf')).length === 0, 'no PDF files remain');
  const counts = (await db.query(
    `SELECT (SELECT count(*) FROM copies WHERE exam_id=$1)::int AS copies, (SELECT count(*) FROM trace_cases WHERE exam_id=$1)::int AS cases,
            (SELECT count(*) FROM local_schedules WHERE name LIKE '%'||$1)::int AS schedules`, [exam.id],
  )).rows[0];
  ok(counts.copies === 0 && counts.cases === 0 && counts.schedules === 0, 'copies, trace cases and schedules are gone from the database');
  const trail = (await auditor.get('/api/audit?type=EXAM_DELETED')).body;
  ok(trail.length === 1 && trail[0].details.title === exam.title, 'the audit log recorded EXAM_DELETED and still holds the earlier history');
  ok((await auditor.get('/api/audit')).body.some((r) => r.action === 'DOWNLOAD'), 'earlier download history is still in the audit log');

  await db.end();
  console.log(`\nAll ${passed} checks passed.`);
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\n${err.message}`);
  for (const name of ['api', 'worker']) {
    const file = path.join(LOG_DIR, `${name}.log`);
    if (fs.existsSync(file)) console.error(`--- ${name} log (last lines)\n${fs.readFileSync(file, 'utf8').split('\n').slice(-12).join('\n')}`);
  }
} finally {
  for (const child of children) child.kill('SIGTERM');
  try {
    run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'leaktrace', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`]);
  } catch { /* best effort */ }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
