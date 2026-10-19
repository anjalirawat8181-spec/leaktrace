import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.loadEnvFile('.env');

const API_PORT = 4101;
const WEB_PORT = 5181;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const DB_NAME = 'leaktrace_shots';
const DB_URL = `postgres://leaktrace:leaktrace@localhost:5434/${DB_NAME}`;
const PASSWORD = process.env.DEMO_PASSWORD;
const OUT = path.resolve(root, process.env.SCREENSHOT_DIR ?? path.join('docs', 'screenshots', 'after'));
const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaktrace-shots-'));

const env = {
  ...process.env,
  DATABASE_URL: DB_URL,
  API_PORT: String(API_PORT),
  WEB_PORT: String(WEB_PORT),
  API_PROXY_TARGET: API,
  DATA_DIR: path.join(root, 'data', 'screenshots'),
  LOGIN_RATE_LIMIT: '200',
  TRUST_PROXY: 'false',
};

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', env, cwd: root, encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function start(name, args, cwd = root) {
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, { env, cwd, stdio: ['ignore', log, log] });
  children.push({ name, child });
  return child;
}

function stopAll() {
  for (const { child } of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  }
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { }
    await sleep(500);
  }
  const logs = children.map(({ name }) => `--- ${name}\n${fs.readFileSync(path.join(LOG_DIR, `${name}.log`), 'utf8').slice(-1500)}`);
  throw new Error(`${label} did not start\n${logs.join('\n')}`);
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  return found;
}

const waitText = (page, text, timeout = 30_000) =>
  page.waitForFunction(
    (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text,
  );

async function clickText(page, text, selector = 'button, a') {
  const ok = await page.evaluate((t, sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t) && !e.disabled);
    if (el) el.click();
    return Boolean(el);
  }, text, selector);
  if (!ok) throw new Error(`No enabled element with text "${text}"`);
}

async function setValue(page, selector, value) {
  await page.$eval(selector, (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function login(page, email) {
  await page.goto(WEB, { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', PASSWORD);
  await clickText(page, 'Sign in');
  await waitText(page, 'Sign out');
}

async function logout(page) {
  await clickText(page, 'Sign out');
  await page.waitForSelector('#email');
}

async function shot(page, name, fullPage = false) {
  await sleep(400);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('  saved', path.relative(root, file));
}

async function apiLogin(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`API login failed for ${email}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Preparing isolated database…');
  run('docker', ['compose', 'up', '-d', '--wait']);
  run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'leaktrace', '-d', 'postgres', '-c',
    `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`]);
  run('docker', ['compose', 'exec', '-T', 'postgres', 'createdb', '-U', 'leaktrace', DB_NAME]);
  fs.rmSync(env.DATA_DIR, { recursive: true, force: true });
  run(process.execPath, ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', '-m', 'db/migrations', 'up']);
  run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'db/seed/seed.ts']);

  console.log('Starting API, worker and web…');
  const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  start('api', [tsx, 'apps/api/src/server.ts']);
  start('worker', [tsx, 'apps/worker/src/main.ts']);
  const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
  const viteBin = path.join(path.dirname(webRequire.resolve('vite/package.json')), 'bin', 'vite.js');
  start('web', [viteBin], path.join(root, 'apps/web'));
  await waitFor(`${API}/api/health`, 'API');
  await waitFor(WEB, 'web');

  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true, args: ['--no-sandbox'],
    defaultViewport: { width: 1360, height: 860 },
  });
  const page = await browser.newPage();

  try {
    console.log('Controller flow…');
    await page.goto(WEB, { waitUntil: 'networkidle0' });
    await page.type('#email', 'controller@demo');
    await page.type('#password', PASSWORD);
    await shot(page, '01-login');
    await clickText(page, 'Sign in');
    await waitText(page, 'Cloud Computing Unit Test 1');
    await shot(page, '02-dashboard');

    await clickText(page, 'Cloud Computing Unit Test 1', 'a');
    await page.waitForSelector('.cm-editor');
    await waitText(page, 'variation points');
    await waitText(page, 'bits');
    const examId = page.url().split('/exams/')[1];
    await shot(page, '03-editor', true);

    await clickText(page, 'Spot the difference', 'button');
    await page.waitForSelector('mark.diff-hit');
    await page.evaluate(() => document.querySelector('mark.diff-hit').scrollIntoView({ block: 'start' }));
    await shot(page, '04-spot-the-difference');

    await page.goto(`${WEB}/centres`, { waitUntil: 'networkidle0' });
    await waitText(page, '20 / 20 copies');
    await shot(page, '05-centres', true);

    await page.goto(`${WEB}/exams/${examId}/generation`, { waitUntil: 'networkidle0' });
    await waitText(page, 'Workers online');
    await clickText(page, 'Generate', 'button');
    await waitText(page, 'DONE · 20 / 20 copies', 90_000);
    await shot(page, '06-generation');

    await page.goto(`${WEB}/exams/${examId}/schedule`, { waitUntil: 'networkidle0' });
    await clickText(page, 'Create schedules', 'button');
    await waitText(page, 'leaktrace-release-');
    await shot(page, '07-schedule');
    await logout(page);

    console.log('Superintendent flow…');
    await login(page, 'supt.c1@demo');
    await waitText(page, 'Paper unlocks in');
    await shot(page, '08-centre-portal-locked');
    await page.evaluate(async (id) => {
      await fetch(`/api/centre/exams/${id}/download`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
    }, examId);

    await db.query("UPDATE exams SET starts_at = now() + interval '5 minutes' WHERE id = $1", [examId]);
    const controllerCookie = await apiLogin('controller@demo');
    const rescheduled = await fetch(`${API}/api/exams/${examId}/schedule`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: controllerCookie }, body: '{}',
    });
    if (!rescheduled.ok) throw new Error('reschedule failed');
    for (let i = 0; i < 60; i++) {
      const { rows } = await db.query('SELECT status FROM exams WHERE id = $1', [examId]);
      if (rows[0].status === 'RELEASED') break;
      if (i === 59) throw new Error('exam was not released in time');
      await sleep(1000);
    }
    await page.reload({ waitUntil: 'networkidle0' });
    await waitText(page, 'Paper available');
    await clickText(page, 'Download papers', 'button');
    await waitText(page, 'open PDF');
    await shot(page, '09-centre-portal-download');
    await logout(page);

    console.log('Trace Lab…');
    const { renderTemplate } = createRequire(import.meta.url)('./../packages/fingerprint');
    const { rows: [copy] } = await db.query(
      `SELECT c.choice_vector, t.parsed FROM copies c
       JOIN paper_templates t ON t.exam_id = c.exam_id WHERE c.exam_id = $1 AND c.serial = 3`, [examId],
    );
    const paper = renderTemplate(copy.parsed, copy.choice_vector);
    const leak = paper.split(/\n\n/).filter((p) => /^\d+\./.test(p.trim())).slice(0, 3).join('\n\n')
      .replace('storage', 'storge')
      .replace('Amazon', 'Amazn');

    await login(page, 'controller@demo');
    await page.goto(`${WEB}/trace`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('textarea');
    await setValue(page, 'input[placeholder^="e.g."]', 'Telegram screenshot, 18 Oct');
    await setValue(page, 'textarea', leak);
    await clickText(page, 'Run trace', 'button');
    await waitText(page, 'LEAK TRACED', 60_000);
    await shot(page, '10-trace-verdict', true);

    await page.goto(`${WEB}/audit`, { waitUntil: 'networkidle0' });
    await waitText(page, 'DOWNLOAD_DENIED');
    await shot(page, '11-audit-log', true);

    await page.goto(`${WEB}/outbox`, { waitUntil: 'networkidle0' });
    await waitText(page, 'LEAK TRACED');
    await shot(page, '12-outbox', true);
    console.log('Done.');
  } finally {
    await browser.close().catch(() => {});
    await db.end().catch(() => {});
  }
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  stopAll();
  try {
    run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'leaktrace', '-d', 'postgres', '-c',
      `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`]);
  } catch { }
  fs.rmSync(path.join(root, 'data', 'screenshots'), { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
