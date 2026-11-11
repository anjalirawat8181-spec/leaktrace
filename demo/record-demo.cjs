const fs = require('fs');
const http = require('http');
const path = require('path');
const { createRequire } = require('module');

const tools = process.env.DEMO_TOOLS;
if (!tools) throw new Error('Set DEMO_TOOLS to a folder where playwright and pdfjs-dist are installed');
const toolRequire = createRequire(path.join(tools, 'x.js'));
const { chromium } = toolRequire('playwright');
const PDFJS_DIR = path.dirname(toolRequire.resolve('pdfjs-dist/package.json'));

const repo = path.resolve(__dirname, '..');
const BASE = process.env.BASE;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!BASE || !PASSWORD) throw new Error('Set BASE and DEMO_PASSWORD');
const OUT = process.env.OUT ?? path.join(repo, 'demo', 'out');
const { seedPaper } = require(path.join(repo, 'packages', 'fingerprint', 'dist', 'seed-paper.js'));

const SIZE = { width: 1280, height: 720 };
fs.mkdirSync(OUT, { recursive: true });
const marks = [];
const clips = [];
const chapters = [];
let current;

const initScript = () => {
  const ipRe = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const mask = () => {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (ipRe.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(ipRe, 'x.x.x.x');
    }
  };
  const setup = () => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;display:none;transition:transform 0.03s linear';
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    const bar = document.createElement('div');
    bar.id = 'demo-subtitle';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:14px 24px;background:rgba(0,0,0,0.78);color:#fff;font:600 22px system-ui,sans-serif;text-align:center;z-index:2147483646;pointer-events:none;display:none';
    document.documentElement.appendChild(bar);
    document.addEventListener('mousemove', (e) => {
      cursor.style.display = 'block';
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }, true);
    new MutationObserver(mask).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms > 1500 ? Math.round(ms * 0.75) : ms));
const showSubtitle = (page, text) => {
  if (current && /^Step [0-9]+/.test(text)) chapters.push({ title: text, clip: current.name, t: current.now() });
  return showSubtitleNow(page, text);
};
const showSubtitleNow = (page, text) => page.evaluate((t) => {
  const bar = document.getElementById('demo-subtitle');
  if (!bar) return;
  bar.textContent = t;
  bar.style.display = t ? 'block' : 'none';
}, text);

async function ensureVisible(page, locator) {
  await locator.waitFor({ state: 'visible', timeout: 60_000 });
  await locator.scrollIntoViewIfNeeded();
  await sleep(300);
}

async function moveAndClick(page, locator) {
  await ensureVisible(page, locator);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await sleep(350);
  await locator.click();
  await sleep(500);
}

async function typeSlowly(page, locator, text, delay = 55) {
  await moveAndClick(page, locator);
  await locator.pressSequentially(text, { delay });
}

async function panElements(page, selector, pauseMs = 900) {
  const items = page.locator(selector);
  const n = Math.min(await items.count(), 6);
  for (let i = 0; i < n; i++) {
    const box = await items.nth(i).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await sleep(pauseMs);
  }
}

async function newClip(browser, name, storageState) {
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: path.join(OUT, `video-${name}`), size: SIZE },
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  const t0 = Date.now();
  current = { name, now: () => Math.round((Date.now() - t0) / 100) / 10 };
  return { name, context, page, t0, now: current.now };
}

async function closeClip(clip) {
  const video = clip.page.video();
  await clip.context.close();
  const file = path.join(OUT, `${clip.name}.webm`);
  fs.copyFileSync(await video.path(), file);
  clips.push({ name: clip.name, file: path.basename(file) });
}

function card(html) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#070b14;color:#e8eef9;font-family:system-ui,sans-serif;text-align:center">${html}</body>`;
}

async function login(clip, email) {
  const { page } = clip;
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await typeSlowly(page, page.locator('input[autocomplete="username"]'), email);
  await typeSlowly(page, page.locator('input[type="password"]'), PASSWORD, 70);
  await moveAndClick(page, page.getByRole('button', { name: 'Sign in' }));
}

function istLocal(offsetMin) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(' ', 'T');
}

async function pdfText(buffer) {
  const pdfjs = await import(path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    let lastY = null;
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += item.str;
      lastY = y;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function serveViewer(pdfBuffer) {
  const viewer = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#2b2f3a;display:grid;place-items:center;height:100vh"><canvas id="c"></canvas><script type="module">
import * as pdfjs from '/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
const doc = await pdfjs.getDocument({ url: '/doc.pdf' }).promise;
const page = await doc.getPage(1);
const base = page.getViewport({ scale: 1 });
const scale = (window.innerHeight - 20) / base.height;
const vp = page.getViewport({ scale });
const c = document.getElementById('c');
c.width = vp.width; c.height = vp.height;
await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
document.title = 'ready';
</script></body>`;
  const server = http.createServer((req, res) => {
    const send = (type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
    if (req.url === '/viewer.html') return send('text/html', viewer);
    if (req.url === '/doc.pdf') return send('application/pdf', pdfBuffer);
    if (req.url === '/pdf.mjs') return send('text/javascript', fs.readFileSync(path.join(PDFJS_DIR, 'build', 'pdf.mjs')));
    if (req.url === '/pdf.worker.mjs') return send('text/javascript', fs.readFileSync(path.join(PDFJS_DIR, 'build', 'pdf.worker.mjs')));
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

(async () => {
  const browser = await chromium.launch();
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ').replace(':', '');
  const titleFile = path.join(OUT, 'exam-title.txt');
  const examTitle = process.env.TAIL_ONLY === '1' ? fs.readFileSync(titleFile, 'utf8') : `Cloud Computing Live Demo ${stamp}`;
  fs.writeFileSync(titleFile, examTitle);
  let leakText = '';
  let examId = '';
  const tail = process.env.TAIL_ONLY === '1';
  const controllerState = path.join(OUT, 'controller-state.json');
  if (tail) leakText = fs.readFileSync(path.join(OUT, 'leak-lines.txt'), 'utf8');

  if (!tail) {
  const title = await newClip(browser, '01-title');
  await title.page.setContent(card('<div><div style="font:700 44px system-ui;letter-spacing:6px;color:#22c55e">LEAKTRACE</div><div style="font:600 34px system-ui;margin-top:24px;max-width:900px">Every exam copy is unique, so every leak can be traced</div></div>'));
  await sleep(3200);
  await closeClip(title);

  const a1 = await newClip(browser, '02-controller');
  const p1 = a1.page;
  await showSubtitle(p1, '');
  await login(a1, 'controller@demo');
  await showSubtitle(p1, 'Step 1 – Controller signs in');
  await p1.getByText('Cloud Computing Unit Test 1').first().waitFor({ timeout: 60_000 });
  await sleep(1200);
  await showSubtitle(p1, 'Step 2 – Exams dashboard with the 5-step bar');
  await panElements(p1, 'main h2, main h3', 700);
  await sleep(1200);
  await moveAndClick(p1, p1.getByRole('button', { name: 'New exam' }));
  await showSubtitle(p1, 'Step 3 – Create a fresh exam');
  await typeSlowly(p1, p1.getByLabel('Exam title'), examTitle, 45);
  await typeSlowly(p1, p1.getByLabel('Subject'), 'Cloud Computing', 45);
  await p1.getByLabel(/Exam starts/).fill(istLocal(60 * 24));
  await sleep(600);
  await moveAndClick(p1, p1.getByRole('button', { name: 'Create exam' }));
  await p1.waitForURL(/\/exams\/[0-9a-f-]{36}/);
  examId = p1.url().match(/exams\/([0-9a-f-]{36})/)[1];
  await sleep(1500);
  await showSubtitle(p1, 'Step 4 – Paper editor: variations are written as {{this|that}}');
  const editor = p1.locator('.cm-content').first();
  await moveAndClick(p1, editor);
  await p1.keyboard.insertText(seedPaper);
  await sleep(2500);
  await showSubtitle(p1, 'Step 4 – Capacity meter and copies indicator update as you type');
  await sleep(3000);
  await moveAndClick(p1, p1.getByRole('button', { name: /Save paper|Save changes/ }).first());
  await sleep(2500);
  await showSubtitle(p1, 'Step 5 – Spot the difference between two copies');
  await moveAndClick(p1, p1.getByRole('button', { name: 'Spot the difference' }));
  await sleep(6000);
  await moveAndClick(p1, p1.getByRole('button', { name: 'Close' }));
  await p1.goto(`${BASE}/exams/${examId}/generation`, { waitUntil: 'networkidle' });
  await showSubtitle(p1, 'Step 6 – Generate one unique PDF per seat');
  await sleep(1500);
  await moveAndClick(p1, p1.getByRole('button', { name: 'Generate copies' }));
  await showSubtitle(p1, 'Step 6 – Waiting for a worker to start (auto-scaled from 0 → 1)');
  const waitFrom = a1.now();
  await p1.getByText('A worker is online').waitFor({ timeout: 8 * 60_000 });
  const waitTo = a1.now();
  marks.push({ clip: a1.name, from: waitFrom + 2, to: waitTo, speed: 10, caption: 'worker auto-scaled from 0 → 1' });
  await showSubtitle(p1, 'Step 6 – The worker is online and "Copies done" climbs to the total');
  await p1.getByRole('link', { name: /Schedule release/ }).waitFor({ timeout: 5 * 60_000 });
  await sleep(3500);
  await moveAndClick(p1, p1.getByRole('link', { name: /Schedule release/ }));
  await showSubtitle(p1, 'Step 7 – Schedule release and close times (India time)');
  const inputs = p1.locator('input[type="datetime-local"]');
  await inputs.nth(0).waitFor();
  await sleep(2500);
  const release = istLocal(3);
  await inputs.nth(0).fill(release);
  await inputs.nth(1).fill(istLocal(40));
  await sleep(1200);
  await moveAndClick(p1, p1.getByRole('button', { name: 'Schedule release' }));
  await p1.getByRole('button', { name: 'Save new times' }).waitFor({ timeout: 30_000 });
  await sleep(3500);
  await a1.context.storageState({ path: controllerState });
  await closeClip(a1);

  const b = await newClip(browser, '03-superintendent');
  const p2 = b.page;
  await login(b, 'supt.c1@demo');
  await showSubtitle(p2, 'Step 8 – Superintendent (separate browser): locked until the release time');
  await p2.getByText(/Locked until/).first().waitFor({ timeout: 60_000 });
  await sleep(3500);
  const btn = p2.locator(`xpath=//*[contains(text(),"${examTitle}")]/ancestor::*[.//button[contains(.,"Download papers")]][1]//button[contains(.,"Download papers")]`).first();
  const lockFrom = b.now();
  for (;;) {
    await p2.reload({ waitUntil: 'networkidle' });
    await sleep(1200);
    if ((await btn.count()) && (await btn.isEnabled().catch(() => false))) break;
    await sleep(7000);
  }
  marks.push({ clip: b.name, from: lockFrom + 4, to: b.now() - 1, speed: 8, caption: 'waiting for the scheduled release time' });
  await showSubtitle(p2, 'Step 8 – "Download now" unlocked automatically');
  await sleep(2000);
  await moveAndClick(p2, btn);
  const link = p2.getByRole('link').filter({ hasText: /open PDF/ }).first();
  await ensureVisible(p2, link);
  await showSubtitle(p2, 'Step 9 – Download papers: short-lived signed links, one PDF per room');
  await sleep(3000);
  const href = await link.getAttribute('href');
  const pdfRes = await b.context.request.get(href);
  const pdfBuffer = Buffer.from(await pdfRes.body());
  const text = await pdfText(pdfBuffer);
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => /^[1-6]\.\s/.test(l)).slice(0, 6);
  leakText = lines.join('\n').replace('storage', 'storge');
  fs.writeFileSync(path.join(OUT, 'leak-lines.txt'), leakText);
  const { server, port } = await serveViewer(pdfBuffer);
  await p2.goto(`http://127.0.0.1:${port}/viewer.html`);
  await p2.waitForFunction(() => document.title === 'ready', null, { timeout: 30_000 });
  await showSubtitle(p2, 'Step 9 – The downloaded PDF: this copy carries its own unique wording');
  await sleep(6000);
  server.close();
  await closeClip(b);
  }

  const a2 = await newClip(browser, '04-find-a-leak', controllerState);
  const p3 = a2.page;
  await p3.goto(`${BASE}/trace`, { waitUntil: 'networkidle' });
  await showSubtitle(p3, 'Step 10 – Controller: Find a leak');
  await sleep(2000);
  const examSelect = p3.locator('select').first();
  await examSelect.locator('option', { hasText: examTitle }).first().waitFor({ state: 'attached', timeout: 60_000 });
  const options = await examSelect.locator('option').allTextContents();
  await examSelect.selectOption({ index: options.findIndex((o) => o.includes(examTitle)) });
  await typeSlowly(p3, p3.getByLabel('Case title'), 'Paper leaked after release', 45);
  await moveAndClick(p3, p3.getByLabel(/Leaked text/));
  await showSubtitle(p3, 'Step 10 – Paste a few lines from the leaked paper, with one deliberate typo');
  await p3.keyboard.insertText(leakText);
  await sleep(4000);
  await moveAndClick(p3, p3.getByRole('button', { name: /Find|Trace|Run/ }).last());
  await p3.waitForURL(/\/trace\/[0-9a-f-]{36}/, { timeout: 60_000 });
  if (process.env.DEBUG_SHOT) { await sleep(8000); await p3.screenshot({ path: path.join(OUT, 'debug.png'), fullPage: true }); }
  await p3.getByText(/LEAK TRACED/i).first().waitFor({ timeout: 60_000 });
  await showSubtitle(p3, 'Step 10 – Verdict: the copy, centre, room, seat and invigilator');
  await sleep(6000);
  await p3.mouse.wheel(0, 520);
  await showSubtitle(p3, 'Step 10 – The matching differences are highlighted as evidence');
  await sleep(6000);
  await moveAndClick(p3, p3.getByRole('link', { name: 'Alerts' }));
  await showSubtitle(p3, 'Step 11 – The leak alert in the notification outbox');
  await sleep(5000);
  await closeClip(a2);

  const c = await newClip(browser, '05-auditor');
  const p4 = c.page;
  await login(c, 'auditor@demo');
  await showSubtitle(p4, 'Step 12 – Auditor: read-only audit log');
  await p4.getByText('Audit log').first().waitFor();
  await moveAndClick(p4, p4.getByRole('link', { name: 'Audit log' }));
  await sleep(3000);
  await showSubtitle(p4, 'Step 12 – Blocked attempts are shown in red');
  await p4.mouse.wheel(0, 700);
  await sleep(5000);
  await closeClip(c);

  const end = await newClip(browser, '06-end');
  await end.page.setContent(card('<div><div style="font:700 40px system-ui">Built by Anjali Rawat &amp; Pranav</div><div style="font:500 24px system-ui;margin-top:22px;color:#9fb0cc">React · Express · Postgres · SQS · S3 · EventBridge Scheduler · EC2 Auto Scaling</div><div style="font:600 26px system-ui;margin-top:22px;color:#22c55e">Ran on AWS (ap-south-1)</div><div style="font:500 22px system-ui;margin-top:22px">github.com/anjalirawat8181-spec/leaktrace</div></div>'));
  await sleep(4200);
  await closeClip(end);

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify({ clips, marks, chapters, examTitle, examId }, null, 2));
  console.log(`recorded ${clips.length} clips`);
})().catch((err) => { console.error(err); process.exit(1); });
