import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const shared = ['fingerprint', 'shared', 'adapters', 'pdf'];
const apps = [
  { name: 'api', entry: 'dist/server.js' },
  { name: 'worker', entry: 'dist/main.js' },
];

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const capture = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });

fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(release, { recursive: true });
const tarballs = path.join(release, '.tarballs');
fs.mkdirSync(tarballs);

run('npm', ['run', 'build:packages']);
for (const { name } of apps) {
  fs.rmSync(path.join(root, 'apps', name, 'dist'), { recursive: true, force: true });
  run('npm', ['run', 'build', '--workspace', `@leaktrace/${name}`]);
}
run('npm', ['run', 'build', '--workspace', '@leaktrace/web']);

const packed = {};
for (const pkg of shared) {
  const out = capture('npm', ['pack', '--workspace', `@leaktrace/${pkg}`, '--pack-destination', tarballs, '--silent']);
  packed[`@leaktrace/${pkg}`] = out.trim().split('\n').pop();
}

for (const { name, entry } of apps) {
  const appDir = path.join(root, 'apps', name);
  const stage = path.join(release, `.stage-${name}`);
  fs.mkdirSync(stage);
  fs.cpSync(path.join(appDir, 'dist'), path.join(stage, 'dist'), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const dependencies = {};
  for (const [dep, version] of Object.entries(manifest.dependencies)) {
    if (packed[dep]) {
      fs.copyFileSync(path.join(tarballs, packed[dep]), path.join(stage, packed[dep]));
      dependencies[dep] = `file:./${packed[dep]}`;
    } else {
      dependencies[dep] = version;
    }
  }
  const pdfDeps = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'pdf', 'package.json'), 'utf8')).dependencies;
  const overrides = {};
  for (const dep of Object.keys(pdfDeps)) if (packed[dep]) overrides[dep] = `file:./${packed[dep]}`;
  for (const [dep, file] of Object.entries(packed)) {
    if (!dependencies[dep]) {
      fs.copyFileSync(path.join(tarballs, file), path.join(stage, file));
      overrides[dep] = `file:./${file}`;
    }
  }

  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({
    name: `leaktrace-${name}`,
    version: manifest.version,
    private: true,
    main: entry,
    scripts: { start: `node ${entry}` },
    dependencies,
    overrides: { ...overrides, ...Object.fromEntries(Object.entries(dependencies).filter(([d]) => packed[d])) },
  }, null, 2)}\n`);

  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], stage);

  const archive = path.join(release, `${name}.tar.gz`);
  run('tar', ['-czf', archive, '-C', stage, 'package.json', 'dist', 'node_modules']);

  const listing = capture('tar', ['-tzf', archive]).split('\n').map((l) => l.replace(/^\.\//, ''));
  for (const required of ['package.json', entry]) {
    if (!listing.includes(required)) throw new Error(`${name}.tar.gz is missing ${required}`);
  }
  if (name === 'api') {
    for (const required of ['dist/migrate.js', 'dist/seed.js']) {
      if (!listing.includes(required)) throw new Error(`api.tar.gz is missing ${required}`);
    }
  }
  fs.rmSync(stage, { recursive: true, force: true });
}

fs.rmSync(tarballs, { recursive: true, force: true });

const webDist = path.join(root, 'apps', 'web', 'dist');
if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('apps/web/dist/index.html missing');
const webArchive = path.join(release, 'web.tar.gz');
run('tar', ['-czf', webArchive, '-C', webDist, '.']);
const webListing = capture('tar', ['-tzf', webArchive]).split('\n').map((l) => l.replace(/^\.\//, ''));
if (!webListing.includes('index.html')) throw new Error('web.tar.gz must have index.html at its root');
if (!webListing.some((l) => l.startsWith('assets/'))) throw new Error('web.tar.gz is missing its assets folder');

for (const script of ['redeploy-api.sh', 'user-data-api.sh', 'user-data-worker.sh']) {
  fs.copyFileSync(path.join(root, 'infra', script), path.join(release, script));
}

console.log('\nRelease artifacts:');
for (const file of ['api.tar.gz', 'worker.tar.gz', 'web.tar.gz', 'redeploy-api.sh', 'user-data-api.sh', 'user-data-worker.sh']) {
  const full = path.join(release, file);
  console.log(`  ${full}  (${(fs.statSync(full).size / 1024 / 1024).toFixed(1)} MB)`);
}
