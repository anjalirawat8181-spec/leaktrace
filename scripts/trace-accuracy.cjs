const path = require('path');
const root = path.join(__dirname, '..', 'packages', 'fingerprint', 'dist') + path.sep;
const fp = require(root + 'index.js');
const { seedPaper } = require(root + 'seed-paper.js');

const parsed = fp.parseTemplate(seedPaper);
const key = 'accuracy-test-key';
const examId = '00000000-0000-4000-8000-000000000001';
const total = 20;
const vectors = fp.generateVectors(examId, total, parsed.points, key);
const copies = vectors.map((v, i) => ({ serial: i + 1, vector: v }));
const texts = vectors.map((v) => fp.renderTemplate(parsed, v));

function typo(line, seed) {
  const words = line.split(' ').filter((w) => w.length > 5);
  if (!words.length) return line;
  const w = words[seed % words.length];
  const i = 2 + (seed % (w.length - 3));
  return line.replace(w, w.slice(0, i) + w.slice(i + 1));
}

const rows = [];
for (let k = 1; k <= 8; k++) {
  let identified = 0, correct = 0, possible = 0, wrong = 0, trials = 0, obs = 0;
  for (let c = 0; c < total; c++) {
    const lines = texts[c].split('\n').map((l) => l.trim()).filter((l) => /^[0-9]+\.\s/.test(l));
    for (let variant = 0; variant < 3; variant++) {
      const chosen = lines.slice(0, k).map((l, j) => (j === variant % k ? typo(l, c + variant) : l)).join('\n');
      const r = fp.detectLeak(parsed, copies, chosen);
      trials++;
      obs += r.evidence.length;
      if (r.status === 'IDENTIFIED') {
        identified++;
        if (Number(r.topCandidate.serial) === c + 1) correct++; else wrong++;
      } else possible++;
    }
  }
  rows.push({ lines: k, trials, avgObservedPoints: +(obs / trials).toFixed(1), identified, correct, wrongIdentifications: wrong, notIdentified: possible });
}
console.log(JSON.stringify({ points: parsed.points.length, copies: total, rows }, null, 1));
