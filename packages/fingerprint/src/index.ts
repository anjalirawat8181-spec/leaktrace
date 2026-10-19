import { createHmac } from 'node:crypto';

export type PointKind =
  | 'PHRASE'
  | 'OPTIONAL'
  | 'NUMBER'
  | 'OPTION_ORDER'
  | 'QUESTION_ORDER';

export interface VariationPoint {
  id: string;
  idx: number;
  kind: PointKind;
  alternatives: string[];
  items?: string[];
  itemRanges?: Array<{ start: number; end: number }>;
  labels?: string[];
  leftCtx: string;
  rightCtx: string;
  start: number;
  end: number;
}

export interface ParsedTemplate {
  source: string;
  points: VariationPoint[];
}

export interface CopyVector {
  serial: string | number;
  vector: number[];
}

export interface TraceEvidence {
  pointId: string;
  pointIndex: number;
  alternativeIndex: number;
  alternative: string;
  position: {
    start: number;
    end: number;
  };
}

export interface TraceCandidate {
  serial: string | number;
  matches: number;
  mismatches: number;
  score: number;
}

export interface DetectionResult {
  status: 'IDENTIFIED' | 'POSSIBLE' | 'INSUFFICIENT';
  topCandidate: TraceCandidate | null;
  candidates: TraceCandidate[];
  evidence: TraceEvidence[];
  coincidenceOdds: {
    probability: number;
    expectedFalseMatches: number;
    oneIn: number | null;
  };
}

const MARKER_PATTERN = /\{\{|\}\}|::options\b|::shuffle\b|::end\b/gi;
const NUMBER_WORDS =
  /^(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)(?:[\s-]+|$)|and$)+$/i;

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b`]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyAlternatives(alternatives: string[]): PointKind {
  if (alternatives.some((alternative) => alternative.trim() === '')) {
    return 'OPTIONAL';
  }

  const isNumber = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return /^\d+(?:[.,]\d+)?$/.test(normalized) || NUMBER_WORDS.test(normalized);
  };

  return alternatives.every(isNumber) ? 'NUMBER' : 'PHRASE';
}

function validateAlternatives(alternatives: string[], position: number): void {
  if (alternatives.length < 2) {
    throw new Error(`Variation point at position ${position} must have at least two alternatives`);
  }

  const normalized = alternatives.map(normalizeText);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Variation point at position ${position} has duplicate alternatives`);
  }
}

function parseOptionsBlock(block: string, position: number): {
  items: string[];
  labels: string[];
} {
  const items: string[] = [];
  const labels: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const option = line.match(/^\s*\(([A-Z])\)\s+(.+?)\s*$/);
    if (!option) {
      throw new Error(`Invalid option in ::options block at position ${position}`);
    }

    labels.push(option[1]);
    items.push(option[2]);
  }

  if (items.length < 2 || new Set(labels).size !== labels.length) {
    throw new Error(`::options block at position ${position} must have at least two uniquely labelled options`);
  }
  if (new Set(items.map(normalizeText)).size !== items.length) {
    throw new Error(`::options block at position ${position} has duplicate option text`);
  }

  return { items, labels };
}

function parseShuffleBlock(
  block: string,
  blockStart: number,
  position: number,
): { items: string[]; ranges: Array<{ start: number; end: number }> } {
  const starts = [...block.matchAll(/^[ \t]*\d{1,3}[.)][ \t]+/gm)];
  const ranges: Array<{ start: number; end: number }> = [];

  if (starts.length >= 2) {
    starts.forEach((match, index) => {
      const rawStart = match.index ?? 0;
      const rawEnd = starts[index + 1]?.index ?? block.length;
      const rawQuestion = block.slice(rawStart, rawEnd);
      const start = rawStart + rawQuestion.length - rawQuestion.trimStart().length;
      const question = rawQuestion.trim();
      ranges.push({ start: blockStart + start, end: blockStart + start + question.length });
    });
  } else {
    const separator = /\r?\n[ \t]*\r?\n/g;
    let cursor = 0;
    for (const match of block.matchAll(separator)) {
      const rawQuestion = block.slice(cursor, match.index);
      const question = rawQuestion.trim();
      if (question) {
        const start = cursor + rawQuestion.length - rawQuestion.trimStart().length;
        ranges.push({ start: blockStart + start, end: blockStart + start + question.length });
      }
      cursor = (match.index ?? cursor) + match[0].length;
    }
    const rawQuestion = block.slice(cursor);
    const question = rawQuestion.trim();
    if (question) {
      const start = cursor + rawQuestion.length - rawQuestion.trimStart().length;
      ranges.push({ start: blockStart + start, end: blockStart + start + question.length });
    }
  }

  if (ranges.length < 2) {
    throw new Error(`::shuffle block at position ${position} must contain at least two questions`);
  }
  const items = ranges.map((range) => block.slice(
    range.start - blockStart,
    range.end - blockStart,
  ));

  if (new Set(items.map(normalizeText)).size !== items.length) {
    throw new Error(`::shuffle block at position ${position} has duplicate questions`);
  }

  return { items, ranges };
}

function pointFromMarker(
  source: string,
  kind: PointKind,
  start: number,
  end: number,
  alternatives: string[],
  items?: string[],
  labels?: string[],
): VariationPoint {
  return {
    id: '',
    idx: -1,
    kind,
    alternatives,
    ...(items ? { items } : {}),
    ...(labels ? { labels } : {}),
    leftCtx: source.slice(0, start),
    rightCtx: source.slice(end),
    start,
    end,
  };
}

export function parseTemplate(source: string): ParsedTemplate {
  const points: VariationPoint[] = [];
  const markers = [...source.matchAll(MARKER_PATTERN)];
  let cursor = 0;

  while (cursor < markers.length) {
    const marker = markers[cursor];
    const token = marker[0].toLowerCase();
    const start = marker.index ?? 0;

    if (token === '{{') {
      const closing = markers[cursor + 1];
      if (!closing || closing[0] !== '}}') {
        throw new Error(`Unclosed variation point at position ${start}`);
      }

      const end = (closing.index ?? start) + closing[0].length;
      const content = source.slice(start + 2, closing.index);
      if (/[{}]/.test(content) || /::(?:options|shuffle|end)\b/i.test(content)) {
        throw new Error(`Nested marker in variation point at position ${start}`);
      }

      const alternatives = content.split('|').map((alternative) => alternative.trim());
      validateAlternatives(alternatives, start);
      points.push(pointFromMarker(
        source,
        classifyAlternatives(alternatives),
        start,
        end,
        alternatives,
      ));
      cursor += 2;
      continue;
    }

    if (token === '::options' || token === '::shuffle') {
      const closing = markers.slice(cursor + 1).find((candidate) => {
        const closingToken = candidate[0].toLowerCase();
        return closingToken === '::end' || closingToken === '::options' || closingToken === '::shuffle';
      });

      if (!closing || closing[0].toLowerCase() !== '::end') {
        throw new Error(`Unclosed ${token} block at position ${start}`);
      }

      const end = (closing.index ?? start) + closing[0].length;
      const content = source.slice(start + marker[0].length, closing.index);

      if (token === '::options') {
        const { items, labels } = parseOptionsBlock(content, start);
        points.push(pointFromMarker(
          source,
          'OPTION_ORDER',
          start,
          end,
          items,
          items,
          labels,
        ));
      } else {
        if (/::(?:options|shuffle|end)\b/i.test(content)) {
          throw new Error(`Nested block in ::shuffle block at position ${start}`);
        }
        const contentStart = start + marker[0].length;
        const { items, ranges } = parseShuffleBlock(content, contentStart, start);
        const point = pointFromMarker(
          source,
          'QUESTION_ORDER',
          start,
          end,
          items,
          items,
        );
        point.itemRanges = ranges;
        points.push(point);

        const nestedPoints = /\{\{([^{}]*)\}\}/g;
        for (const nested of content.matchAll(nestedPoints)) {
          const nestedStart = contentStart + (nested.index ?? 0);
          const alternatives = nested[1].split('|').map((alternative) => alternative.trim());
          validateAlternatives(alternatives, nestedStart);
          points.push(pointFromMarker(
            source,
            classifyAlternatives(alternatives),
            nestedStart,
            nestedStart + nested[0].length,
            alternatives,
          ));
        }
      }

      cursor = markers.indexOf(closing) + 1;
      continue;
    }

    throw new Error(`Unexpected ${marker[0]} at position ${start}`);
  }

  const orderPoints = points.filter((point) => point.kind === 'QUESTION_ORDER');
  const parentOf = (point: VariationPoint): VariationPoint | undefined => (
    orderPoints.find((orderPoint) => (
      point !== orderPoint && point.start > orderPoint.start && point.end < orderPoint.end
    ))
  );

  points.forEach((point, idx) => {
    const parent = parentOf(point);
    const peers = points.filter((candidate) => (
      candidate !== point
      && candidate.kind !== 'QUESTION_ORDER'
      && parentOf(candidate) === parent
    ));
    const previous = peers
      .filter((candidate) => candidate.end <= point.start)
      .sort((left, right) => right.end - left.end)[0];
    const next = peers
      .filter((candidate) => candidate.start >= point.end)
      .sort((left, right) => left.start - right.start)[0];
    const itemRange = parent?.itemRanges?.find((range) => (
      point.start >= range.start && point.end <= range.end
    ));
    const previousEnd = previous?.end ?? itemRange?.start ?? 0;
    const nextStart = next?.start ?? itemRange?.end ?? source.length;
    point.id = `P${idx + 1}`;
    point.idx = idx;
    point.leftCtx = source.slice(previousEnd, point.start).slice(-25);
    point.rightCtx = source.slice(point.end, nextStart).slice(0, 25);
  });

  return { source, points };
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) {
    result *= factor;
    if (!Number.isSafeInteger(result)) {
      throw new Error('Variation point has too many alternatives');
    }
  }
  return result;
}

export function alternativesCount(point: VariationPoint): number {
  let count: number;
  if (point.kind === 'OPTION_ORDER' || point.kind === 'QUESTION_ORDER') {
    const itemCount = point.items?.length ?? point.alternatives.length;
    if (itemCount < 2) {
      throw new Error(`Variation point ${point.id} must contain at least two items`);
    }
    count = factorial(itemCount);
  } else {
    count = point.alternatives.length;
  }
  if (!Number.isSafeInteger(count) || count < 2) {
    throw new Error(`Variation point ${point.id} must have at least two alternatives`);
  }
  return count;
}

export function capacityBits(points: VariationPoint[]): number {
  return points.reduce((bits, point) => bits + Math.log2(alternativesCount(point)), 0);
}

function hmacUint32(key: string, message: string): number {
  return createHmac('sha256', key).update(message).digest().readUInt32BE(0);
}

export function hammingDistance(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('Cannot compare vectors of different lengths');
  }

  return left.reduce((distance, choice, index) => (
    distance + Number(choice !== right[index])
  ), 0);
}

function validateVectorInputs(
  examId: string,
  totalCopies: number,
  points: VariationPoint[],
  key: string,
  minHammingDistance: number,
): void {
  if (!examId.trim() || !key) {
    throw new Error('Exam ID and fingerprint key are required');
  }
  if (!Number.isSafeInteger(totalCopies) || totalCopies < 1 || totalCopies > 20) {
    throw new Error('Total copies must be an integer between 1 and 20');
  }
  if (!Number.isSafeInteger(minHammingDistance) || minHammingDistance < 0) {
    throw new Error('Minimum Hamming distance must be a non-negative integer');
  }

  const requiredBits = Math.log2(totalCopies) + 12;
  const availableBits = capacityBits(points);
  if (availableBits < requiredBits) {
    throw new Error(
      `Capacity too low: ${availableBits.toFixed(2)} bits, required ${requiredBits.toFixed(2)} bits`,
    );
  }
}

export function generateVectors(
  examId: string,
  totalCopies: number,
  points: VariationPoint[],
  key: string,
  minHammingDistance = 4,
): number[][] {
  validateVectorInputs(examId, totalCopies, points, key, minHammingDistance);
  const counts = points.map(alternativesCount);
  const vectors: number[][] = [];
  const maxAttempts = 100_000;

  for (let serial = 1; serial <= totalCopies; serial += 1) {
    let accepted: number[] | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = counts.map((count, index) => (
        hmacUint32(key, `${examId}:${serial}:${attempt}:${index}`) % count
      ));

      if (vectors.every((existing) => (
        hammingDistance(existing, candidate) >= minHammingDistance
      ))) {
        accepted = candidate;
        break;
      }
    }

    if (!accepted) {
      throw new Error(
        `Unable to generate copy ${serial} with minimum Hamming distance ${minHammingDistance}`,
      );
    }

    vectors.push(accepted);
  }

  return vectors;
}

export function permutationAt(items: string[], rank: number): number[] {
  const available = items.map((_, index) => index);
  const permutation: number[] = [];
  let remainder = rank;

  for (let length = available.length; length > 0; length -= 1) {
    const blockSize = factorial(length - 1);
    const choice = Math.floor(remainder / blockSize);
    remainder %= blockSize;
    permutation.push(available.splice(choice, 1)[0]);
  }

  return permutation;
}

function renderPoint(
  point: VariationPoint,
  choice: number,
  renderedItems?: string[],
): string {
  const count = alternativesCount(point);
  if (!Number.isSafeInteger(choice) || choice < 0 || choice >= count) {
    throw new Error(`Invalid choice ${choice} for variation point ${point.id}`);
  }

  if (point.kind !== 'OPTION_ORDER' && point.kind !== 'QUESTION_ORDER') {
    return point.alternatives[choice];
  }

  const items = renderedItems ?? point.items ?? point.alternatives;
  const order = permutationAt(items, choice);
  if (point.kind === 'QUESTION_ORDER') {
    return order.map((index) => items[index]).join('\n\n');
  }

  if (items.length > 26) {
    throw new Error('An ::options block cannot contain more than 26 options');
  }

  return order
    .map((index, position) => `(${String.fromCharCode(65 + position)}) ${items[index]}`)
    .join('\n');
}

function describeAlternative(point: VariationPoint, choice: number): string {
  if (point.kind !== 'OPTION_ORDER' && point.kind !== 'QUESTION_ORDER') {
    return point.alternatives[choice];
  }

  const items = point.items ?? point.alternatives;
  const order = permutationAt(items, choice);
  if (point.kind === 'QUESTION_ORDER') {
    return order
      .map((index) => items[index].match(/^\s*(\d{1,3}[.)])/)?.[1] ?? items[index])
      .join(' → ');
  }
  return order
    .map((index, position) => `(${String.fromCharCode(65 + position)}) ${items[index]}`)
    .join('\n');
}

export function resolveTemplate(
  source: string,
  points: VariationPoint[],
  vector: number[],
): string {
  if (vector.length !== points.length) {
    throw new Error(`Expected ${points.length} choices, received ${vector.length}`);
  }

  const renderRange = (
    start: number,
    end: number,
    rangePoints: VariationPoint[],
  ): string => {
    let result = '';
    let cursor = start;

    for (const point of rangePoints) {
      if (point.start < cursor || point.end <= point.start || point.end > end) {
        throw new Error(`Invalid source range for variation point ${point.id}`);
      }
      result += source.slice(cursor, point.start);

      if (point.kind === 'QUESTION_ORDER') {
        const children = points.filter((candidate) => (
          candidate !== point
          && candidate.start > point.start
          && candidate.end < point.end
        ));
        const renderedItems = (point.itemRanges ?? []).map((range) => (
          renderRange(
            range.start,
            range.end,
            children.filter((child) => child.start >= range.start && child.end <= range.end),
          )
        ));
        result += renderPoint(point, vector[point.idx], renderedItems);
      } else {
        result += renderPoint(point, vector[point.idx]);
      }

      cursor = point.end;
    }

    return result + source.slice(cursor, end);
  };

  const topLevelPoints = points.filter((point) => !parentOfPoint(points, point));
  return renderRange(0, source.length, topLevelPoints);
}

function parentOfPoint(
  points: VariationPoint[],
  point: VariationPoint,
): VariationPoint | undefined {
  return points.find((candidate) => (
    candidate !== point
    && candidate.kind === 'QUESTION_ORDER'
    && point.start > candidate.start
    && point.end < candidate.end
  ));
}

export function renderTemplate(template: ParsedTemplate, vector: number[]): string {
  return resolveTemplate(template.source, template.points, vector);
}

function tokenWords(value: string): Array<{ value: string; start: number; end: number }> {
  const normalized = normalizeText(value);
  return [...normalized.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function editDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let rowMinimum = row;

    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + Number(left[row - 1] !== right[column - 1]),
      );
      rowMinimum = Math.min(rowMinimum, current[column]);
    }

    if (rowMinimum > limit) {
      return limit + 1;
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

function fuzzyOccurrence(
  target: string,
  text: string,
  minimumSimilarity = 0.9,
): { start: number; end: number; similarity: number } | null {
  const targetWords = tokenWords(target);
  const textWords = tokenWords(text);
  if (!targetWords.length || textWords.length < targetWords.length) {
    return null;
  }

  const targetLength = targetWords.reduce((sum, word) => sum + word.value.length, 0);
  const maxDistance = Math.floor(targetLength * (1 - minimumSimilarity) + 1e-9);
  let best: { start: number; end: number; similarity: number } | null = null;

  for (let startIndex = 0; startIndex <= textWords.length - targetWords.length; startIndex += 1) {
    let distance = 0;
    let candidateLength = 0;

    for (let offset = 0; offset < targetWords.length; offset += 1) {
      const targetWord = targetWords[offset].value;
      const candidateWord = textWords[startIndex + offset].value;
      const remaining = maxDistance - distance;
      if (remaining < 0) {
        break;
      }
      distance += editDistance(targetWord, candidateWord, remaining);
      candidateLength += targetWord.length;
      if (distance > maxDistance) {
        break;
      }
    }

    const similarity = 1 - distance / Math.max(1, candidateLength);
    if (distance <= maxDistance && (!best || similarity > best.similarity)) {
      best = {
        start: textWords[startIndex].start,
        end: textWords[startIndex + targetWords.length - 1].end,
        similarity,
      };
    }
  }

  return best;
}

function exactOccurrence(
  target: string,
  text: string,
): { start: number; end: number; similarity: number } | null {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return null;
  }

  const normalizedText = normalizeText(text);
  const start = normalizedText.indexOf(normalizedTarget);
  return start < 0
    ? null
    : { start, end: start + normalizedTarget.length, similarity: 1 };
}

function pointProbe(point: VariationPoint, alternative: string): string {
  return normalizeText(`${point.leftCtx}${alternative}${point.rightCtx}`);
}

function detectSimplePoint(
  point: VariationPoint,
  leak: string,
): { alternativeIndex: number; position: { start: number; end: number } } | null {
  const exactContextMatches = point.alternatives
    .map((alternative, alternativeIndex) => ({
      alternativeIndex,
      match: exactOccurrence(pointProbe(point, alternative), leak),
    }))
    .filter((candidate) => candidate.match !== null);

  if (exactContextMatches.length === 1) {
    const candidate = exactContextMatches[0];
    const match = candidate.match!;
    const alternative = normalizeText(point.alternatives[candidate.alternativeIndex]);
    const alternativeOffset = pointProbe(
      point,
      point.alternatives[candidate.alternativeIndex],
    ).indexOf(alternative);
    return {
      alternativeIndex: candidate.alternativeIndex,
      position: alternative
        ? {
            start: match.start + alternativeOffset,
            end: match.start + alternativeOffset + alternative.length,
          }
        : { start: match.start, end: match.end },
    };
  }

  const exactAlternativeMatches = point.alternatives
    .map((alternative, alternativeIndex) => ({
      alternativeIndex,
      match: exactOccurrence(alternative, leak),
    }))
    .filter((candidate) => candidate.match !== null);

  if (exactAlternativeMatches.length === 1) {
    const match = exactAlternativeMatches[0].match!;
    return {
      alternativeIndex: exactAlternativeMatches[0].alternativeIndex,
      position: { start: match.start, end: match.end },
    };
  }

  const probes = point.alternatives.map((alternative) => {
    if (alternative) {
      return alternative;
    }
    return `${point.leftCtx} ${point.rightCtx}`;
  });
  const fuzzyMatches = probes
    .map((probe, alternativeIndex) => ({
      alternativeIndex,
      match: fuzzyOccurrence(probe, leak),
    }))
    .filter((candidate) => candidate.match !== null)
    .sort((left, right) => right.match!.similarity - left.match!.similarity);

  if (
    fuzzyMatches.length === 0
    || (fuzzyMatches.length > 1
      && fuzzyMatches[0].match!.similarity - fuzzyMatches[1].match!.similarity < 0.02)
  ) {
    return null;
  }

  const match = fuzzyMatches[0].match!;
  return {
    alternativeIndex: fuzzyMatches[0].alternativeIndex,
    position: { start: match.start, end: match.end },
  };
}

function rankPermutation(order: number[]): number {
  let rank = 0;
  const remaining = order.map((_, index) => index);

  for (let index = 0; index < order.length; index += 1) {
    const position = remaining.indexOf(order[index]);
    if (position < 0) {
      throw new Error('Invalid permutation');
    }
    rank += position * factorial(order.length - index - 1);
    remaining.splice(position, 1);
  }

  return rank;
}

function detectOrderPoint(
  point: VariationPoint,
  leak: string,
): { alternativeIndex: number; position: { start: number; end: number } } | null {
  const items = point.items ?? point.alternatives;
  const occurrences = items.map((item) => {
    if (point.kind === 'QUESTION_ORDER') {
      const questionNumber = item.match(/^\s*(\d{1,3})[.)]\s/)?.[1];
      if (questionNumber) {
        const expression = new RegExp(`(?:^|\\r?\\n)[ \\t]*${questionNumber}[.)][ \\t]+`);
        const match = expression.exec(leak);
        if (match) {
          const offset = match[0].search(/\d/);
          const start = (match.index ?? 0) + offset;
          return { start, end: start + questionNumber.length + 1, similarity: 1 };
        }
      }
      return null;
    }
    return exactOccurrence(item, leak) ?? fuzzyOccurrence(item, leak);
  });
  if (occurrences.some((occurrence) => occurrence === null)) {
    return null;
  }

  const orderedItems = occurrences
    .map((occurrence, index) => ({ index, start: occurrence!.start, end: occurrence!.end }))
    .sort((left, right) => left.start - right.start);
  const start = Math.min(...orderedItems.map((item) => item.start));
  const end = Math.max(...orderedItems.map((item) => item.end));

  return {
    alternativeIndex: rankPermutation(orderedItems.map((item) => item.index)),
    position: { start, end },
  };
}

function scoreCandidates(
  copies: CopyVector[],
  evidence: TraceEvidence[],
): TraceCandidate[] {
  return copies
    .map(({ serial, vector }) => {
      let matches = 0;
      let mismatches = 0;
      for (const observation of evidence) {
        if (vector[observation.pointIndex] === observation.alternativeIndex) {
          matches += 1;
        } else {
          mismatches += 1;
        }
      }
      return { serial, matches, mismatches, score: matches - 3 * mismatches };
    })
    .sort((left, right) => (
      right.score - left.score
      || left.mismatches - right.mismatches
      || right.matches - left.matches
      || String(left.serial).localeCompare(String(right.serial))
    ));
}

export function detectLeak(
  template: ParsedTemplate,
  copies: CopyVector[],
  leakedText: string,
): DetectionResult {
  if (copies.length === 0) {
    throw new Error('At least one copy vector is required');
  }
  if (new Set(copies.map((copy) => String(copy.serial))).size !== copies.length) {
    throw new Error('Copy serials must be unique');
  }
  for (const copy of copies) {
    if (copy.vector.length !== template.points.length) {
      throw new Error(`Copy ${copy.serial} has an invalid vector length`);
    }
    copy.vector.forEach((choice, index) => {
      if (!Number.isSafeInteger(choice) || choice < 0 || choice >= alternativesCount(template.points[index])) {
        throw new Error(`Copy ${copy.serial} has an invalid choice at point ${index + 1}`);
      }
    });
  }

  const evidence: TraceEvidence[] = [];
  for (const point of template.points) {
    const result = point.kind === 'OPTION_ORDER' || point.kind === 'QUESTION_ORDER'
      ? detectOrderPoint(point, leakedText)
      : detectSimplePoint(point, leakedText);
    if (result) {
      evidence.push({
        pointId: point.id,
        pointIndex: point.idx,
        alternativeIndex: result.alternativeIndex,
        alternative: describeAlternative(point, result.alternativeIndex),
        position: result.position,
      });
    }
  }

  const ranked = scoreCandidates(copies, evidence);
  const topCandidate = ranked[0] ?? null;
  const secondCandidate = ranked[1] ?? null;
  const requiredObservations = Math.log2(copies.length) + 2;
  const requiredMatches = Math.log2(copies.length) + 4;
  const singleLine = leakedText.split(/\r?\n/).filter((line) => line.trim()).length <= 1;
  const enoughEvidence = !singleLine && evidence.length >= requiredObservations;
  const identified = Boolean(
    enoughEvidence
    && topCandidate
    && topCandidate.mismatches <= 1
    && topCandidate.matches >= requiredMatches
    && (!secondCandidate || secondCandidate.mismatches - topCandidate.mismatches >= 3),
  );

  const probability = evidence.reduce((value, observation) => (
    value / alternativesCount(template.points[observation.pointIndex])
  ), 1);
  const expectedFalseMatches = Math.max(0, copies.length - 1) * probability;

  return {
    status: identified ? 'IDENTIFIED' : enoughEvidence ? 'POSSIBLE' : 'INSUFFICIENT',
    topCandidate,
    candidates: ranked.slice(0, 5),
    evidence,
    coincidenceOdds: {
      probability,
      expectedFalseMatches,
      oneIn: expectedFalseMatches > 0 ? 1 / expectedFalseMatches : null,
    },
  };
}

export function mapNormalizedRange(
  original: string,
  range: { start: number; end: number },
): { start: number; end: number } {
  const prefixLength = (i: number) => normalizeText(`${original.slice(0, i)}|`).length - 1;
  const firstIndexReaching = (target: number): number => {
    let low = 0;
    let high = original.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (prefixLength(mid) >= target) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const start = firstIndexReaching(range.start + 1) - 1;
  const end = firstIndexReaching(range.end);
  return { start: Math.max(0, start), end: Math.max(start + 1, end) };
}
