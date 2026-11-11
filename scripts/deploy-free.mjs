import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.deploy');
const REPO = 'https://github.com/anjalirawat8181-spec/leaktrace';
const SERVICE = process.env.RENDER_SERVICE_NAME ?? 'leaktrace-api';
const PROJECT = process.env.VERCEL_PROJECT_NAME ?? 'leaktrace';
const REGION = process.env.RENDER_REGION ?? 'singapore';
const BRANCH = process.env.DEPLOY_BRANCH ?? 'master';

const BUILD = 'npm ci --include=dev && npm run build:packages';
const START = 'DATABASE_URL="$DATABASE_DIRECT_URL" npx tsx apps/api/src/migrate.ts && npx tsx apps/api/src/server.ts';

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function need(env, names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`Missing in .env.deploy: ${missing.join(', ')}`);
}

function ensureSecrets(env) {
  const generated = [];
  for (const name of ['JWT_SECRET', 'FINGERPRINT_KEY', 'DEMO_RESET_TOKEN', 'DEMO_PASSWORD']) {
    if (env[name]) continue;
    env[name] = randomBytes(32).toString('hex');
    const text = fs.readFileSync(envFile, 'utf8');
    fs.appendFileSync(envFile, `${text.endsWith('\n') || !text ? '' : '\n'}${name}=${env[name]}\n`);
    generated.push(name);
  }
  console.log(generated.length ? `Generated and saved: ${generated.join(', ')}` : 'Secrets already present in .env.deploy');
}

const isWin = process.platform === 'win32';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...options });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function migrateAndSeed(env) {
  need(env, ['NEON_DIRECT_URL', 'DEMO_PASSWORD', 'FINGERPRINT_KEY', 'JWT_SECRET']);
  const base = { ...process.env, DATABASE_URL: env.NEON_DIRECT_URL, DEMO_PASSWORD: env.DEMO_PASSWORD, JWT_SECRET: env.JWT_SECRET, FINGERPRINT_KEY: env.FINGERPRINT_KEY };
  run(npm, ['run', 'build:packages']);
  run(npx, ['tsx', 'apps/api/src/migrate.ts'], { env: base });
  run(npx, ['tsx', 'db/seed/seed.ts'], { env: base });
}

function r2Check(env) {
  need(env, ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']);
  run('node', ['scripts/r2-check.mjs'], { env: { ...process.env, ...env } });
}

async function render(env, method, route, body) {
  const res = await fetch(`https://api.render.com/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${env.RENDER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (res.status === 402 || /card|payment|billing/i.test(text)) {
    throw new Error(`Render asks for payment details (HTTP ${res.status}). Stop and confirm before continuing.`);
  }
  if (!res.ok) throw new Error(`Render ${method} ${route} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  return json;
}

function serviceEnv(env, webOrigin) {
  const vars = {
    APP_MODE: 'cloud',
    WORKER_IN_PROCESS: 'true',
    DEMO_MODE: 'true',
    TRUST_PROXY: 'true',
    NODE_VERSION: '22',
    DATABASE_URL: env.NEON_DATABASE_URL,
    DATABASE_DIRECT_URL: env.NEON_DIRECT_URL,
    JWT_SECRET: env.JWT_SECRET,
    FINGERPRINT_KEY: env.FINGERPRINT_KEY,
    DEMO_RESET_TOKEN: env.DEMO_RESET_TOKEN,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: env.R2_BUCKET,
    WEB_ORIGIN: webOrigin ?? env.WEB_ORIGIN ?? 'http://localhost:5173',
    MAX_COPIES_PER_EXAM: '20',
  };
  return Object.entries(vars).map(([key, value]) => ({ key, value }));
}

async function findService(env) {
  const list = await render(env, 'GET', `/services?name=${encodeURIComponent(SERVICE)}&limit=20`);
  return list.map((x) => x.service).find((s) => s.name === SERVICE);
}

async function deployRender(env, webOrigin) {
  need(env, ['RENDER_API_KEY', 'NEON_DATABASE_URL', 'NEON_DIRECT_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'JWT_SECRET', 'FINGERPRINT_KEY', 'DEMO_RESET_TOKEN']);
  let service = await findService(env);
  if (!service) {
    const owners = await render(env, 'GET', '/owners?limit=20');
    const wanted = process.env.RENDER_OWNER_NAME;
    const owner = (wanted ? owners.find((o) => o.owner.name === wanted) : owners[0])?.owner;
    if (!owner) throw new Error('No Render workspace found for this API key');
    const created = await render(env, 'POST', '/services', {
      type: 'web_service',
      name: SERVICE,
      ownerId: owner.id,
      repo: REPO,
      branch: BRANCH,
      autoDeploy: 'yes',
      envVars: serviceEnv(env, webOrigin),
      serviceDetails: {
        runtime: 'node',
        plan: 'free',
        region: REGION,
        healthCheckPath: '/api/health',
        envSpecificDetails: { buildCommand: BUILD, startCommand: START },
      },
    });
    service = created.service ?? created;
    console.log(`Created Render service ${SERVICE} on the free plan`);
  } else {
    await render(env, 'PUT', `/services/${service.id}/env-vars`, serviceEnv(env, webOrigin));
    await render(env, 'POST', `/services/${service.id}/deploys`, { clearCache: 'do_not_clear' });
    console.log(`Updated environment and started a deploy for ${SERVICE}`);
  }
  const url = (await render(env, 'GET', `/services/${service.id}`)).serviceDetails.url;
  return { id: service.id, url };
}

async function waitHealthy(env, svc, timeoutMin = 20) {
  const deadline = Date.now() + timeoutMin * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const deploys = await render(env, 'GET', `/services/${svc.id}/deploys?limit=1`);
    const status = deploys[0]?.deploy?.status ?? 'unknown';
    if (status !== last) console.log(`Render deploy: ${status}`);
    last = status;
    if (['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed'].includes(status)) {
      throw new Error(`Render deploy ended as ${status}. Check the logs in the Render dashboard.`);
    }
    if (status === 'live') {
      const res = await fetch(`${svc.url}/api/health`).catch(() => null);
      if (res?.ok && (await res.json().catch(() => ({}))).status === 'ok') {
        console.log(`${svc.url}/api/health returned {"status":"ok"}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error('Timed out waiting for the API to become healthy');
}

function deployVercel(env, apiUrl) {
  need(env, ['VERCEL_TOKEN']);
  const web = path.join(root, 'apps', 'web');
  fs.writeFileSync(path.join(web, 'vercel.json'), `${JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: 'vite',
    rewrites: [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/((?!api/).*)', destination: '/index.html' },
    ],
  }, null, 2)}\n`);
  const token = ['--token', env.VERCEL_TOKEN];
  const shell = process.platform === 'win32';
  execFileSync(npx, ['vercel', 'link', '--yes', '--project', PROJECT, ...token], { cwd: web, stdio: 'inherit', shell });
  const out = execFileSync(npx, ['vercel', 'deploy', '--prod', '--yes', ...token], { cwd: web, encoding: 'utf8', shell });
  return out;
}

async function vercelAlias(env) {
  const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT}`, { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } });
  if (!res.ok) throw new Error(`Vercel project lookup failed: HTTP ${res.status}`);
  const project = await res.json();
  const aliases = project.targets?.production?.alias ?? [];
  const host = aliases.find((a) => a.endsWith('.vercel.app') && !/-[a-z0-9]{9,}-/.test(a)) ?? aliases[0];
  if (!host) throw new Error('No production domain found for the Vercel project');
  return `https://${host}`;
}

const steps = process.argv.slice(2);
const want = (name) => steps.length === 0 || steps.includes(name);

const env = loadEnv();
ensureSecrets(env);
if (want('database')) migrateAndSeed(env);
if (want('storage')) r2Check(env);

let svc;
if (want('render') || want('vercel')) svc = await deployRender(env);
if (want('render')) await waitHealthy(env, svc);
if (want('vercel')) {
  deployVercel(env, svc.url);
  const webUrl = await vercelAlias(env);
  await deployRender(env, webUrl);
  console.log(`Web origin set to ${webUrl}`);
}
if (steps.includes('origin')) {
  const webUrl = await vercelAlias(env);
  await deployRender(env, webUrl);
  console.log(`Web origin set to ${webUrl}`);
}
if (want('reset')) {
  const res = await fetch(`${svc?.url ?? `https://${SERVICE}.onrender.com`}/api/admin/reset-demo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEMO_RESET_TOKEN}` },
  });
  console.log(`reset-demo: HTTP ${res.status}`);
}
