import { detectLeak, generateVectors, parseTemplate, renderTemplate } from './index';
import { seedPaper } from './seed-paper';

const template = parseTemplate(seedPaper);
const key = process.env.FINGERPRINT_KEY ?? 'leaktrace-demo-key';
const vectors = generateVectors('demo-exam', 20, template.points, key);

for (const [index, vector] of vectors.slice(0, 2).entries()) {
  console.log(`--- Variant ${index + 1} ---`);
  console.log(renderTemplate(template, vector));
}

const firstVariant = renderTemplate(template, vectors[0]);
const defaultExcerpt = firstVariant
  .split(/\r?\n\r?\n/)
  .filter((section) => /^\d+\./.test(section.trim()))
  .slice(0, 5)
  .join('\n\n');
const leakedText = process.argv.slice(2).join(' ') || defaultExcerpt;
const result = detectLeak(
  template,
  vectors.map((vector, index) => ({ serial: index + 1, vector })),
  leakedText,
);

console.log('--- Pasted excerpt ---');
console.log(leakedText);
console.log('--- Trace result ---');
console.log(JSON.stringify(result, null, 2));
