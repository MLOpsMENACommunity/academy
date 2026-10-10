import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import qrcode from 'qrcode-generator';
import { CERTIFICATE_ORGANIZATION, type InstructorName } from '@academy/shared';

/**
 * The certificate PDF: landscape A4, bilingual, drawn with PDFKit (pure JavaScript, no browser
 * or native dependency in the container). IBM Plex Sans Arabic (bundled under ./assets, OFL)
 * covers both Latin and Arabic; fontkit shapes Arabic words and this file orders words for
 * right-to-left lines (PDFKit itself only lays text out left to right).
 */

export interface CertificatePdfData {
  serial: string;
  name: string;
  nameAr: string | null;
  courseTitleEn: string;
  courseTitleAr: string;
  instructors: InstructorName[];
  issuedAt: Date;
  grade: string | null;
  verifyUrl: string;
}

/** Built files sit in dist/src/certificates/assets (nest-cli copies them); sources in src/certificates/assets. */
const ASSETS = join(__dirname, 'assets');
const asset = (name: string) => {
  const p = join(ASSETS, name);
  if (!existsSync(p)) throw new Error(`Certificate asset missing: ${name}`);
  return p;
};

const W = 841.89; // A4 landscape, points
const H = 595.28;
const INK = '#08142e';
const MUTED = '#566580';
const TEAL = '#0b7a71';
const CYAN = '#16C6D8';
const ORANGE = '#FF9912';

// ------------------------------------------------------------------ bidi (word level)

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
export const isRtl = (s: string) => RTL_CHAR.test(s);

/**
 * Words of one line in visual (left-to-right) order. Enough bidi for names and titles:
 * words are grouped into runs of one direction; on a right-to-left line the runs go right to
 * left, and inside a right-to-left run the words do too. Each Arabic word is shaped (and its
 * glyphs ordered) by fontkit. Digits are their own left-to-right words, so dates read right.
 */
export function visualWords(text: string, baseRtl = isRtl(text)): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const runs: { rtl: boolean; words: string[] }[] = [];
  for (const w of words) {
    const rtl = isRtl(w);
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.words.push(w);
    else runs.push({ rtl, words: [w] });
  }
  const ordered = baseRtl ? runs.reverse() : runs;
  return ordered.flatMap((r) => (r.rtl ? [...r.words].reverse() : r.words));
}

type Doc = PDFKit.PDFDocument;
type Font = 'regular' | 'semibold' | 'bold';

interface TextOpts {
  font: Font;
  size: number;
  color?: string;
  /** Box to align in (defaults to the page width). */
  x?: number;
  width?: number;
  align?: 'left' | 'center' | 'right';
  /** Shrink the font until the line fits the box (long names). */
  minSize?: number;
  /** Base direction; by default right to left when the line has any Arabic. Bilingual labels ("Issued · تاريخ") pass false. */
  rtl?: boolean;
}

function lineWidth(doc: Doc, words: string[]): number {
  const space = doc.widthOfString(' ');
  return words.reduce((n, w) => n + doc.widthOfString(w), 0) + space * Math.max(0, words.length - 1);
}

/** One line of text, never wrapped, word-ordered for its direction. Returns the line's height. */
function line(doc: Doc, text: string, y: number, o: TextOpts): number {
  const x0 = o.x ?? 0;
  const width = o.width ?? W;
  const words = visualWords(text, o.rtl);
  let size = o.size;
  doc.font(o.font).fillColor(o.color ?? INK);
  doc.fontSize(size);
  while (o.minSize && size > o.minSize && lineWidth(doc, words) > width) doc.fontSize((size -= 1));
  const total = lineWidth(doc, words);
  const align = o.align ?? 'center';
  let x = align === 'left' ? x0 : align === 'right' ? x0 + width - total : x0 + (width - total) / 2;
  const space = doc.widthOfString(' ');
  for (const w of words) {
    doc.text(w, x, y, { lineBreak: false });
    x += doc.widthOfString(w) + space;
  }
  return doc.currentLineHeight();
}

function qr(doc: Doc, text: string, x: number, y: number, size: number): void {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const n = code.getModuleCount();
  const cell = size / n;
  doc.save().fillColor(INK);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // Slightly oversized cells so neighbouring squares never show hairline gaps.
      if (code.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.05, cell + 0.05).fill();
    }
  }
  doc.restore();
}

const dateEn = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
// Latin digits: Arabic-Indic digits inside a right-to-left line would need full bidi.
const dateAr = (d: Date) => d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });

/** Renders the certificate to a PDF buffer. */
export function renderCertificatePdf(c: CertificatePdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: `${c.courseTitleEn}: certificate ${c.serial}`,
      Author: CERTIFICATE_ORGANIZATION,
      Subject: `Certificate of completion for ${c.name}`,
      Creator: 'MLOps MENA Academy',
    },
  });
  doc.registerFont('regular', asset('IBMPlexSansArabic-Regular.ttf'));
  doc.registerFont('semibold', asset('IBMPlexSansArabic-SemiBold.ttf'));
  doc.registerFont('bold', asset('IBMPlexSansArabic-Bold.ttf'));

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Frame: a thin brand gradient band on top, a double border.
  const band = doc.linearGradient(0, 0, W, 0);
  band.stop(0, CYAN).stop(0.5, '#72B97B').stop(1, ORANGE);
  doc.rect(0, 0, W, 10).fill(band);
  doc.lineWidth(1.2).strokeColor(TEAL).rect(24, 30, W - 48, H - 54).stroke();
  doc.lineWidth(0.5).strokeColor('#c9d3e0').rect(30, 36, W - 60, H - 66).stroke();

  // Header: logo and the academy's name in both languages.
  doc.image(asset('logo-mark.png'), 60, 54, { width: 52 });
  line(doc, 'MLOps MENA Academy', 62, { font: 'bold', size: 15, color: TEAL, x: 122, width: 300, align: 'left' });
  line(doc, 'أكاديمية MLOps MENA', 82, { font: 'regular', size: 12, color: MUTED, x: 122, width: 300, align: 'left' });
  line(doc, 'Certificate of Completion', 60, { font: 'semibold', size: 13, color: MUTED, x: W - 360, width: 300, align: 'right' });
  line(doc, 'شهادة إتمام', 80, { font: 'semibold', size: 13, color: MUTED, x: W - 360, width: 300, align: 'right' });

  // Body.
  let y = 138;
  line(doc, 'This certifies that  ·  تشهد الأكاديمية بأن', y, { rtl: false, font: 'regular', size: 13, color: MUTED });
  y += 30;
  const nameBox = { x: 70, width: W - 140 };
  const hasName = c.name.trim().length > 0;
  y += line(doc, hasName ? c.name : c.nameAr ?? '', y, { font: 'bold', size: 40, minSize: 22, ...nameBox }) + 2;
  if (hasName && c.nameAr) y += line(doc, c.nameAr, y, { font: 'semibold', size: 24, minSize: 14, color: INK, ...nameBox });
  y += 14;
  doc.moveTo(W / 2 - 120, y).lineTo(W / 2 + 120, y).lineWidth(1).strokeColor(ORANGE).stroke();
  y += 16;
  line(doc, 'has successfully completed the course  ·  أتمّ بنجاح دورة', y, { rtl: false, font: 'regular', size: 13, color: MUTED });
  y += 28;
  y += line(doc, c.courseTitleEn, y, { font: 'bold', size: 24, minSize: 14, ...nameBox });
  if (c.courseTitleAr && c.courseTitleAr !== c.courseTitleEn) y += line(doc, c.courseTitleAr, y + 2, { font: 'semibold', size: 18, minSize: 12, ...nameBox });
  if (c.grade) {
    y += 14;
    line(doc, `Grade: ${c.grade}`, y, { font: 'semibold', size: 14, color: TEAL });
  }

  // Footer: date and instructors on the left, signature in the middle, QR and serial on the right.
  const fy = H - 150;
  line(doc, 'Issued  ·  تاريخ الإصدار', fy, { rtl: false, font: 'regular', size: 9.5, color: MUTED, x: 60, width: 250, align: 'left' });
  line(doc, dateEn(c.issuedAt), fy + 14, { font: 'semibold', size: 12, x: 60, width: 250, align: 'left' });
  line(doc, dateAr(c.issuedAt), fy + 31, { font: 'regular', size: 11, x: 60, width: 250, align: 'left' });
  if (c.instructors.length) {
    line(doc, 'Instructors  ·  المدربون', fy + 56, { rtl: false, font: 'regular', size: 9.5, color: MUTED, x: 60, width: 250, align: 'left' });
    const names = c.instructors.map((i) => i.name).join(', ');
    line(doc, names, fy + 70, { font: 'semibold', size: 11, minSize: 7, x: 60, width: 250, align: 'left' });
  }

  const sx = W / 2 - 110;
  doc.moveTo(sx, fy + 58).lineTo(sx + 220, fy + 58).lineWidth(0.8).strokeColor(INK).stroke();
  line(doc, CERTIFICATE_ORGANIZATION, fy + 64, { font: 'semibold', size: 12, x: sx, width: 220 });
  line(doc, 'مجتمع MLOps MENA', fy + 81, { font: 'regular', size: 10.5, color: MUTED, x: sx, width: 220 });

  const qs = 78;
  const qx = W - 60 - qs;
  qr(doc, c.verifyUrl, qx, fy - 4, qs);
  line(doc, 'Verify  ·  تحقّق', fy + 2, { rtl: false, font: 'regular', size: 9.5, color: MUTED, x: qx - 190, width: 180, align: 'right' });
  line(doc, c.serial, fy + 16, { font: 'semibold', size: 12, x: qx - 190, width: 180, align: 'right' });
  line(doc, c.verifyUrl.replace(/^https?:\/\//, ''), fy + 90, { font: 'regular', size: 7.5, color: MUTED, minSize: 5, x: W - 360, width: 300, align: 'right' });

  doc.end();
  return done;
}
