const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = process.env.OUT;
const DEST = process.env.DEST ?? __dirname;
if (!OUT) throw new Error('Set OUT to the folder written by record-demo.cjs');
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'clips.json'), 'utf8'));
meta.chapters ??= [];
const WORK = path.join(OUT, 'work');
fs.mkdirSync(WORK, { recursive: true });
const FONT = process.env.FONT ?? 'C\\:/Windows/Fonts/arialbd.ttf';

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
const norm = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x070b14,fps=30,format=yuv420p';

const captionFixes = JSON.parse(process.env.CAPTION_FIXES ?? '[]');

function captionFixFilter(clip, total) {
  const own = meta.chapters.filter((c) => c.clip === clip.name);
  const parts = [];
  captionFixes.forEach((fix, k) => {
    own.forEach((c, i) => {
      if (!c.title.includes(fix.match)) return;
      const to = i + 1 < own.length ? own[i + 1].t : total;
      const file = path.join(WORK, `fix-${clip.name}-${k}-${i}.txt`);
      fs.writeFileSync(file, fix.text);
      const textFile = file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
      const on = `enable='between(t,${c.t},${to})'`;
      parts.push(`drawbox=x=0:y=ih-62:w=iw:h=62:color=black@1:t=fill:${on}`);
      parts.push(`drawtext=fontfile='${FONT}':textfile='${textFile}':fontcolor=white:fontsize=22:x=(w-text_w)/2:y=h-44:${on}`);
    });
  });
  return parts.length ? `,${parts.join(',')}` : '';
}

function normalizeClip(clip) {
  const src = path.join(OUT, clip.file);
  const total = duration(src);
  const marks = meta.marks.filter((m) => m.clip === clip.name && m.to > m.from).sort((a, b) => a.from - b.from);
  const out = path.join(WORK, `${clip.name}.mp4`);
  if (!marks.length) {
    ff(['-i', src, '-vf', `${norm}${captionFixFilter(clip, total)}`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
    return { out, marks: [], total };
  }
  const parts = [];
  const filters = [];
  let cursor = 0;
  let n = 0;
  const addPlain = (from, to) => {
    if (to - from < 0.05) return;
    filters.push(`[0:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,${norm}[p${n}]`);
    parts.push(`[p${n}]`);
    n++;
  };
  for (const m of marks) {
    addPlain(cursor, m.from);
    const captionFile = path.join(WORK, `caption-${clip.name}-${n}.txt`);
    fs.writeFileSync(captionFile, m.caption);
    const textFile = captionFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
    filters.push(`[0:v]trim=start=${m.from}:end=${Math.min(m.to, total)},setpts=(PTS-STARTPTS)/${m.speed},${norm},drawtext=fontfile='${FONT}':textfile='${textFile}':fontcolor=white:fontsize=34:box=1:boxcolor=0x000000b0:boxborderw=14:x=(w-text_w)/2:y=h-120[p${n}]`);
    parts.push(`[p${n}]`);
    n++;
    cursor = Math.min(m.to, total);
  }
  addPlain(cursor, total);
  filters.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0[v]`);
  ff(['-i', src, '-filter_complex', filters.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
  return { out, marks, total };
}

function mapTime(info, t) {
  let removed = 0;
  for (const m of info.marks) {
    const to = Math.min(m.to, info.total);
    if (t >= to) removed += (to - m.from) * (1 - 1 / m.speed);
    else if (t > m.from) removed += (t - m.from) * (1 - 1 / m.speed);
  }
  return Math.max(0, t - removed);
}

const infos = meta.clips.map((clip) => ({ clip, ...normalizeClip(clip) }));
let offset = 0;
for (const info of infos) {
  info.len = duration(info.out);
  info.offset = offset;
  offset += info.len;
}

const listFile = path.join(WORK, 'list.txt');
fs.writeFileSync(listFile, infos.map((i) => `file '${i.out.replace(/\\/g, '/')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(DEST, 'leaktrace-demo.mp4')]);

const rawList = path.join(WORK, 'raw.txt');
const rawMp4s = [];
for (const clip of meta.clips) {
  const out = path.join(WORK, `raw-${clip.name}.mp4`);
  ff(['-i', path.join(OUT, clip.file), '-vf', norm, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
  rawMp4s.push(out);
}
fs.writeFileSync(rawList, rawMp4s.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', rawList, '-c:v', 'libvpx', '-b:v', '2M', '-an', path.join(DEST, 'leaktrace-demo.webm')]);

ff(['-i', path.join(DEST, 'leaktrace-demo.mp4'), '-vf', 'scale=1080:-2,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=0x070b14,format=yuv420p', '-c:v', 'libx264', '-crf', '21', '-movflags', '+faststart', '-an', path.join(DEST, 'leaktrace-demo-square.mp4')]);

const stepStart = (n) => {
  const c = meta.chapters.find((x) => new RegExp(`^Step ${n} `).test(x.title));
  if (!c) return null;
  const info = infos.find((i) => i.clip.name === c.clip);
  return info ? info.offset + mapTime(info, c.t) : null;
};

const chapterLines = [];
const seen = new Set();
chapterLines.push('00:00 Title');
for (const c of meta.chapters) {
  const n = c.title.match(/^Step (\d+)/)[1];
  if (seen.has(n)) continue;
  seen.add(n);
  const info = infos.find((i) => i.clip.name === c.clip);
  if (!info) continue;
  const t = Math.round(info.offset + mapTime(info, c.t));
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  chapterLines.push(`${mm}:${ss} ${c.title.replace(/^Step \d+ – /, '')}`);
}
const total = Math.round(offset);
chapterLines.push(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')} End`);
fs.writeFileSync(path.join(DEST, 'chapters.txt'), `${chapterLines.join('\n')}\n`);

const title = infos[0];
const pieces = [
  { from: 0, len: 2.6 },
  { from: stepStart(4), len: 7 },
  { from: stepStart(5), len: 6.5 },
  { from: stepStart(10), len: 18 },
].filter((p) => p.from !== null);
const shortParts = [];
pieces.forEach((p, i) => {
  const out = path.join(WORK, `short-${i}.mp4`);
  ff(['-ss', String(p.from), '-t', String(p.len), '-i', path.join(DEST, 'leaktrace-demo.mp4'), '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', out]);
  shortParts.push(out);
});
const shortList = path.join(WORK, 'short.txt');
fs.writeFileSync(shortList, shortParts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', shortList, '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(DEST, 'leaktrace-demo-short.mp4')]);

const gifStart = Math.max(0, duration(path.join(DEST, 'leaktrace-demo-short.mp4')) - 15);
const palette = path.join(WORK, 'palette.png');
ff(['-ss', String(gifStart), '-t', '15', '-i', path.join(DEST, 'leaktrace-demo-short.mp4'), '-vf', 'fps=8,scale=800:-1:flags=lanczos,palettegen=max_colors=96', palette]);
ff(['-ss', String(gifStart), '-t', '15', '-i', path.join(DEST, 'leaktrace-demo-short.mp4'), '-i', palette, '-lavfi', 'fps=8,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4', path.join(DEST, 'demo-preview.gif')]);

for (const f of ['leaktrace-demo.mp4', 'leaktrace-demo.webm', 'leaktrace-demo-square.mp4', 'leaktrace-demo-short.mp4', 'demo-preview.gif']) {
  const file = path.join(DEST, f);
  console.log(`${f}: ${Math.round(duration(file) * 10) / 10}s ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
}
