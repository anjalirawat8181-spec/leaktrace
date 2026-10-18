import { describe, expect, it } from 'vitest';
import {
  alternativesCount,
  capacityBits,
  detectLeak,
  generateVectors,
  hammingDistance,
  mapNormalizedRange,
  parseTemplate,
  renderTemplate,
} from '../src';
import { seedPaper } from '../src/seed-paper';

function makeBinaryPoints(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `P${idx + 1}`,
    idx,
    kind: 'PHRASE' as const,
    alternatives: [`choice-${idx}-alpha`, `choice-${idx}-bravo`],
    leftCtx: '',
    rightCtx: '',
    start: idx,
    end: idx + 1,
  }));
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function injectTypos(text: string, alternatives: string[], random: () => number): string {
  const occurrences = alternatives.flatMap((alternative) => {
    const start = text.indexOf(alternative);
    if (start < 0) {
      return [];
    }

    return [...alternative.matchAll(/\b[\p{L}]{5,}\b/gu)]
      .map((match) => ({
        start: start + (match.index ?? 0),
        word: match[0],
      }));
  });
  const selected = new Set<number>();
  while (selected.size < 2) {
    selected.add(Math.floor(random() * occurrences.length));
  }

  let result = text;
  for (const index of [...selected].sort((left, right) => (
    occurrences[right].start - occurrences[left].start
  ))) {
    const { start, word } = occurrences[index];
    const charIndex = Math.floor(random() * word.length);
    const replacement = word[charIndex] === 'x' ? 'z' : 'x';
    result = `${result.slice(0, start + charIndex)}${replacement}${result.slice(start + charIndex + 1)}`;
  }

  return result;
}

describe('fingerprint template parser', () => {
  it('preserves the seed paper and parses variation points in document order', () => {
    const parsed = parseTemplate(seedPaper);

    expect(parsed.source).toBe(seedPaper);
    expect(parsed.points.filter((point) => point.kind === 'PHRASE')).toHaveLength(64);
    expect(parsed.points.slice(0, 4).map((point) => point.kind)).toEqual([
      'PHRASE',
      'PHRASE',
      'PHRASE',
      'PHRASE',
    ]);
    expect(parsed.points.some((point) => point.kind === 'OPTION_ORDER')).toBe(true);
    expect(parsed.points.some((point) => point.kind === 'QUESTION_ORDER')).toBe(true);
    expect(renderTemplate(parsed, parsed.points.map(() => 0))).not.toContain('{{');
    expect(parsed.points.map((point) => point.id)).toEqual(
      parsed.points.map((_, index) => `P${index + 1}`),
    );
  });

  it('classifies optional and number alternatives and resolves all point types', () => {
    const parsed = parseTemplate(
      'Keep{{,|}} {{10|ten}}.\n::options\n(A) One\n(B) Two\n::end\n::shuffle\n1. First\n\n2. Second\n::end',
    );

    expect(parsed.points.map((point) => point.kind)).toEqual([
      'OPTIONAL',
      'NUMBER',
      'OPTION_ORDER',
      'QUESTION_ORDER',
    ]);
    expect(alternativesCount(parsed.points[2])).toBe(2);
    expect(renderTemplate(parsed, [1, 1, 1, 1])).toContain('(A) Two\n(B) One');
    expect(renderTemplate(parsed, [1, 1, 1, 1])).toContain('2. Second\n\n1. First');
  });

  it('rejects malformed and ambiguous variation syntax', () => {
    expect(() => parseTemplate('Unclosed {{one|two')).toThrow('Unclosed variation point');
    expect(() => parseTemplate('{{same|same}}')).toThrow('duplicate alternatives');
    expect(() => parseTemplate('::options\n(A) only one\n::end')).toThrow('at least two');
    expect(() => parseTemplate('::shuffle\nOnly one question\n::end')).toThrow('at least two');
    expect(() => parseTemplate('::options\n(A) Same\n(B) same\n::end')).toThrow('duplicate option text');
  });
});

describe('fingerprint vectors', () => {
  it('generates 20 unique vectors with minimum pairwise distance four', () => {
    const parsed = parseTemplate(seedPaper);
    const vectors = generateVectors('exam-1', 20, parsed.points, 'test-key');

    expect(vectors).toHaveLength(20);
    expect(new Set(vectors.map((vector) => vector.join(','))).size).toBe(20);
    for (let left = 0; left < vectors.length; left += 1) {
      for (let right = left + 1; right < vectors.length; right += 1) {
        expect(hammingDistance(vectors[left], vectors[right])).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('calculates capacity and rejects low-capacity or out-of-range requests', () => {
    const parsed = parseTemplate('{{10|ten}}.');
    expect(capacityBits(parsed.points)).toBe(1);
    expect(() => generateVectors('exam-1', 20, parsed.points, 'key')).toThrow('Capacity too low');
    expect(() => generateVectors('exam-1', 21, makeBinaryPoints(40), 'key')).toThrow(
      'between 1 and 20',
    );
  });
});

describe('leak detection', () => {
  it('identifies the correct copy from 3-question excerpts with two typos in at least 99% of trials', () => {
    const template = parseTemplate(seedPaper);
    const vectors = generateVectors('detection-exam', 20, template.points, 'detection-key');
    const copies = vectors.map((vector, index) => ({ serial: index + 1, vector }));
    const questions = seedPaper
      .split(/\r?\n/)
      .filter((line) => /^\d+\.\s/.test(line));
    expect(questions).toHaveLength(8);
    const random = createRandom(7);
    let identified = 0;
    const trialCount = 500;

    for (let trial = 0; trial < trialCount; trial += 1) {
      const serialIndex = Math.floor(random() * copies.length);
      const selectedQuestions = new Set<number>();
      while (selectedQuestions.size < 3) {
        selectedQuestions.add(Math.floor(random() * 8));
      }

      const rendered = renderTemplate(template, vectors[serialIndex]);
      const renderedQuestions = rendered
        .split(/\r?\n/)
        .filter((line) => /^\d+\.\s/.test(line));
      const renderedByNumber = new Map(renderedQuestions.map((question) => [
        Number(question.match(/^(\d+)\./)?.[1]),
        question,
      ]));
      const excerpt = [...selectedQuestions]
        .sort((left, right) => left - right)
        .map((index) => renderedByNumber.get(index + 1)!)
        .join('\n');
      const selectedAlternatives = template.points
        .filter((point) => [...selectedQuestions].some((questionIndex) => {
          const sourceQuestion = questions[questionIndex];
          const questionStart = seedPaper.indexOf(sourceQuestion);
          return point.start >= questionStart && point.start < questionStart + sourceQuestion.length;
        }))
        .map((point) => point.alternatives[vectors[serialIndex][point.idx]]);
      const leakedText = injectTypos(excerpt, selectedAlternatives, random);
      const result = detectLeak(template, copies, leakedText);
      if (result.status === 'IDENTIFIED' && result.topCandidate?.serial === serialIndex + 1) {
        identified += 1;
      }
    }

    expect(identified).toBeGreaterThanOrEqual(Math.ceil(trialCount * 0.99));
  });

  it('returns insufficient for a one-line excerpt', () => {
    const template = parseTemplate(seedPaper);
    const vectors = generateVectors('short-exam', 20, template.points, 'short-key');
    const copies = vectors.map((vector, index) => ({ serial: index + 1, vector }));
    const oneLine = renderTemplate(template, vectors[0]).split(/\r?\n/)[2];

    expect(detectLeak(template, copies, oneLine).status).toBe('INSUFFICIENT');
  });

  it('detects the rendered order of shuffled questions', () => {
    const template = parseTemplate(seedPaper);
    const orderPoint = template.points.find((point) => point.kind === 'QUESTION_ORDER')!;
    const vectors = generateVectors('order-exam', 20, template.points, 'order-key');
    const copies = vectors.map((vector, index) => ({ serial: index + 1, vector }));
    const serialIndex = vectors.findIndex((vector) => vector[orderPoint.idx] === 1);
    const rendered = renderTemplate(template, vectors[serialIndex]);
    const excerpt = rendered
      .split(/\r?\n/)
      .filter((line) => /^[78]\.\s/.test(line))
      .join('\n');
    expect(excerpt.indexOf('8.') < excerpt.indexOf('7.')).toBe(true);
    const result = detectLeak(template, copies, excerpt);
    const orderEvidence = result.evidence.find((item) => item.pointId === orderPoint.id);

    expect(serialIndex).toBeGreaterThanOrEqual(0);
    expect(orderEvidence?.alternativeIndex).toBe(1);
  });
});

describe('mapNormalizedRange', () => {
  it('maps normalised positions back onto the original text', () => {
    const original = '  Hello   WORLD  foo bar';
    // normalised: "hello world foo bar"
    const range = mapNormalizedRange(original, { start: 6, end: 15 });
    expect(original.slice(range.start, range.end)).toBe('WORLD  foo');
  });
});
