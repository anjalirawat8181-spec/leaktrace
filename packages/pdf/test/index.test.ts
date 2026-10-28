import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { renderCopyPdf } from '../src/index';

const question = 'Explain the shared responsibility model in cloud computing and give two examples. '.repeat(6);
const longText = Array.from({ length: 12 }, (_, i) => `Q${i + 1}. ${question}`).join('\n\n');

async function pageContent(buf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((page) => {
    const stream = page.node.Contents() as unknown as PDFRawStream;
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  });
}

const render = (text: string) =>
  renderCopyPdf({ title: 'Unit test', startsAt: new Date('2026-01-01T04:00:00Z'), centreCode: 'C1', seatNo: 3, visibleCode: 'QZ7K2M', text });

describe('renderCopyPdf pagination', () => {
  it('keeps body text flowing normally across page breaks', async () => {
    const pages = await pageContent(await render(longText));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.length).toBeLessThan(5);
  });

  it('draws the footer (seat and code) exactly once per page', async () => {
    const pages = await pageContent(await render(longText));
    for (const content of pages) {
      const footerOps = [...content.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].filter((m) => Number(m[1]) < 60);
      expect(footerOps).toHaveLength(2);
    }
  });

  it('renders a short paper as a single page', async () => {
    const pages = await pageContent(await render('Q1. One short question.'));
    expect(pages).toHaveLength(1);
  });
});
