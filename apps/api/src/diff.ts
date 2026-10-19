export interface Range {
  start: number;
  end: number;
}

function tokenize(text: string): Array<{ value: string; start: number }> {
  return Array.from(text.matchAll(/\S+/g), (m) => ({ value: m[0], start: m.index ?? 0 }));
}

export function wordDiff(a: string, b: string): { a: Range[]; b: Range[] } {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = ta[i].value === tb[j].value
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ra: Range[] = [];
  const rb: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i].value === tb[j].value) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ra.push({ start: ta[i].start, end: ta[i].start + ta[i].value.length }); i++;
    } else {
      rb.push({ start: tb[j].start, end: tb[j].start + tb[j].value.length }); j++;
    }
  }
  for (; i < n; i++) ra.push({ start: ta[i].start, end: ta[i].start + ta[i].value.length });
  for (; j < m; j++) rb.push({ start: tb[j].start, end: tb[j].start + tb[j].value.length });
  return { a: ra, b: rb };
}
