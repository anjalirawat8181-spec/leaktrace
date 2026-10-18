import { createHash } from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import {
  permutationAt, renderTemplate, type ParsedTemplate, type VariationPoint,
} from '@leaktrace/fingerprint';

const FONT_DIR = path.resolve(__dirname, '../fonts');
const FIXED_DATE = new Date(0);

/** 6 hex chars printed in the footer; a decoy that carries no trace information. */
export function visibleCode(serial: number, key: string): string {
  return createHash('sha256').update(`${serial}${key}`).digest('hex').slice(0, 6);
}

/**
 * Per-copy answer key. By convention the option written first (A) in the template
 * is the correct one; the key records the letter it lands on after permutation.
 */
export function buildAnswerKey(points: VariationPoint[], vector: number[]): Record<string, string> {
  const key: Record<string, string> = {};
  points.forEach((point, i) => {
    if (point.kind !== 'OPTION_ORDER' || !point.items) return;
    const position = permutationAt(point.items, vector[i]).indexOf(0);
    key[point.id] = String.fromCharCode(65 + position);
  });
  return key;
}

export interface CopyPdfInput {
  title: string;
  startsAt: Date;
  centreCode: string;
  seatNo: number;
  visibleCode: string;
  text: string;
}

/** Deterministic: the same input always yields byte-identical output. */
export function renderCopyPdf(input: CopyPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 90, bottom: 80, left: 56, right: 56 },
      info: { Title: input.title, Producer: 'LeakTrace', Creator: 'LeakTrace', CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
      compress: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Regular', path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
    doc.registerFont('Bold', path.join(FONT_DIR, 'NotoSans-Bold.ttf'));

    const when = input.startsAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const decorate = () => {
      const { left, right } = doc.page.margins;
      const width = doc.page.width - left - right;
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // allow writing inside the bottom margin without paging
      doc.font('Bold').fontSize(11).fillColor('#000')
        .text(input.title, left, 36, { width: width * 0.65, lineBreak: false });
      doc.font('Regular').fontSize(9)
        .text(`${when} · Centre ${input.centreCode}`, left, 52, { width, align: 'left', lineBreak: false });
      doc.moveTo(left, 72).lineTo(left + width, 72).strokeColor('#999').lineWidth(0.5).stroke();
      doc.font('Regular').fontSize(9).fillColor('#333')
        .text(`Seat ${input.seatNo}`, left, doc.page.height - 48, { width: width / 2, lineBreak: false })
        .text(input.visibleCode, left + width / 2, doc.page.height - 48, { width: width / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = saved;
      doc.fillColor('#000');
    };

    decorate();
    doc.on('pageAdded', decorate);
    doc.font('Regular').fontSize(11).text(input.text, { lineGap: 3, paragraphGap: 4 });
    doc.end();
  });
}

export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PdfLibDocument.create({ updateMetadata: false });
  for (const buffer of buffers) {
    const source = await PdfLibDocument.load(buffer, { updateMetadata: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  merged.setCreationDate(FIXED_DATE);
  merged.setModificationDate(FIXED_DATE);
  merged.setProducer('LeakTrace');
  merged.setCreator('LeakTrace');
  return Buffer.from(await merged.save({ useObjectStreams: false }));
}

export interface CopyRenderInput extends Omit<CopyPdfInput, 'text'> {
  template: ParsedTemplate;
  vector: number[];
}

/** Resolves the template with the stored vector and renders it. */
export function renderCopy(input: CopyRenderInput): Promise<Buffer> {
  const { template, vector, ...rest } = input;
  return renderCopyPdf({ ...rest, text: renderTemplate(template, vector) });
}
