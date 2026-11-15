import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import qrcode from 'qrcode-generator';
import { CERTIFICATE_ORGANIZATION } from '@academy/shared';
import { dateEn } from './dates';

/**
 * The certificate PDF, drawn on the community's own designs (the attendance and completion
 * templates from the operations team, v2): the artwork is a fixed background image, and the
 * name, course, description, QR code, ID, date and instructors are placed where the templates
 * put them. English only. Coordinates below are the templates' own (SVG pixels); the page is
 * scaled to A4 landscape width. Fonts: Montserrat (OFL), static instances of the template's
 * variable font. IBM Plex Sans Arabic is only a fallback for a name typed in Arabic letters,
 * so it never prints as empty boxes.
 */

export interface CertificatePdfInstructor {
  name: string;
  title?: string | null;
}

export interface CertificatePdfData {
  kind?: 'COMPLETION' | 'ATTENDANCE';
  serial: string;
  name: string;
  courseTitle: string;
  /** Up to two lines under the course name; longer text is shortened with an ellipsis. */
  courseDescription?: string | null;
  instructors: CertificatePdfInstructor[];
  issuedAt: Date;
  verifyUrl: string;
}

/** Built files sit in dist/src/certificates/assets (nest-cli copies them); sources in src/certificates/assets. */
const ASSETS = join(__dirname, 'assets');
const asset = (name: string) => {
  const p = join(ASSETS, name);
  if (!existsSync(p)) throw new Error(`Certificate asset missing: ${name}`);
  return p;
};

/** The founder's own signature is part of the artwork, so she is never drawn again as an instructor. */
const FOUNDER = /^(eng\.?\s+)?aya\s+nasser(\s+salama)?$/i;

/** 0 is the handwriting font used for instructors' signatures. */
type Weight = 0 | 400 | 500 | 700 | 800 | 900;
const SCRIPT = 0;
const FONT_FILES: Record<Weight, string> = {
  0: 'GreatVibes-Regular.ttf',
  400: 'Montserrat-Regular.ttf',
  500: 'Montserrat-Medium.ttf',
  700: 'Montserrat-Bold.ttf',
  800: 'Montserrat-ExtraBold.ttf',
  900: 'Montserrat-Black.ttf',
};

interface Box {
  x: number;
  y: number;
  size: number;
  minSize: number;
  maxWidth: number;
  weight: Weight;
  color: string;
}

interface Layout {
  file: string;
  width: number;
  height: number;
  name: Box & { letterSpacing: number };
  course: Box & { wrapBelow: number; lineHeight: number };
  description: Box & { lineHeight: number };
  qr: { x: number; y: number; size: number };
  id: Box;
  date: { x: number; y: number; size: number };
  /** The founder's block (signature, rule, name, title) as it sits in the artwork, and where her copy goes when someone else teaches. */
  founder: { file: string; paper: string; x: number; y: number; w: number; h: number; ruleY: number; left: { x: number; w: number } };
  /** Another instructor, drawn in the founder's place and style. */
  signer: { ruleX1: number; ruleX2: number; ruleY: number; nameY: number; nameSize: number; titleY: number; titleSize: number };
}

/** From completion_template_v2.svg and attendance_template_v2.svg. */
const LAYOUTS: Record<'COMPLETION' | 'ATTENDANCE', Layout> = {
  COMPLETION: {
    file: 'completion-background.png',
    width: 1491,
    height: 1055,
    name: { x: 146, y: 494, size: 58, minSize: 30, maxWidth: 1080, weight: 900, color: '#080E3C', letterSpacing: 0.5 },
    course: { x: 143, y: 630, size: 34, minSize: 22, maxWidth: 1080, weight: 700, color: '#19A3BA', wrapBelow: 27, lineHeight: 36 },
    description: { x: 145, y: 679, size: 21, minSize: 15, maxWidth: 800, weight: 400, color: '#767482', lineHeight: 33 },
    qr: { x: 497, y: 819, size: 100 },
    id: { x: 630, y: 887, size: 20, minSize: 12, maxWidth: 245, weight: 700, color: '#080E3C' },
    date: { x: 630, y: 916, size: 16 },
    founder: { file: 'completion-founder.png', paper: 'completion-paper.png', x: 945, y: 785, w: 420, h: 160, ruleY: 865, left: { x: 140, w: 330 } },
    signer: { ruleX1: 958, ruleX2: 1351, ruleY: 865, nameY: 902, nameSize: 21, titleY: 930, titleSize: 18 },
  },
  ATTENDANCE: {
    file: 'attendance-background.png',
    width: 1536,
    height: 1024,
    name: { x: 148, y: 478, size: 40, minSize: 24, maxWidth: 1080, weight: 900, color: '#080E3C', letterSpacing: 0.5 },
    course: { x: 148, y: 614, size: 38, minSize: 24, maxWidth: 1080, weight: 700, color: '#09A4BF', wrapBelow: 30, lineHeight: 40 },
    description: { x: 150, y: 659, size: 20, minSize: 15, maxWidth: 880, weight: 400, color: '#6D6C7B', lineHeight: 31 },
    qr: { x: 516, y: 795, size: 96 },
    id: { x: 650, y: 862, size: 16, minSize: 11, maxWidth: 255, weight: 700, color: '#080E3C' },
    date: { x: 650, y: 890, size: 15 },
    founder: { file: 'attendance-founder.png', paper: 'attendance-paper.png', x: 975, y: 765, w: 425, h: 155, ruleY: 840, left: { x: 145, w: 338 } },
    signer: { ruleX1: 988, ruleX2: 1392, ruleY: 840, nameY: 876, nameSize: 20, titleY: 904, titleSize: 17 },
  },
};

const INK = '#080E3C';
const GREY = '#5A6075';
const TITLE_GREY = '#7A8194';
/** The page is A4 landscape wide; the height follows the artwork's proportions. */
const PAGE_WIDTH = 841.89;

// ------------------------------------------------------------------ text helpers

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
export const isRtl = (s: string) => RTL_CHAR.test(s);

/**
 * Words of one line in visual (left-to-right) order, for the rare name typed in Arabic letters:
 * runs of one direction; on a right-to-left line the runs go right to left, and so do the words
 * inside a right-to-left run (fontkit shapes each word).
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

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function useFont(doc: Doc, weight: Weight, text: string, size: number): void {
  doc.font(isRtl(text) ? (weight >= 700 ? 'arabic-bold' : 'arabic') : `m${weight}`).fontSize(size);
}

function width(doc: Doc, text: string, weight: Weight, size: number, spacing = 0): number {
  useFont(doc, weight, text, size);
  return doc.widthOfString(text, { characterSpacing: spacing });
}

/** One line at a baseline (as SVG text is placed); `anchor` middle centres it on x. */
function draw(doc: Doc, text: string, x: number, y: number, o: { weight: Weight; size: number; color: string; spacing?: number; anchor?: 'start' | 'middle' }): void {
  if (!text) return;
  const spacing = o.spacing ?? 0;
  const line = isRtl(text) ? visualWords(text).join(' ') : text;
  const w = width(doc, line, o.weight, o.size, spacing);
  const left = o.anchor === 'middle' ? x - w / 2 : x;
  doc.fillColor(o.color).text(line, left, y, { lineBreak: false, baseline: 'alphabetic', characterSpacing: spacing });
}

/** The largest size from `size` down to `minSize` at which the text fits `maxWidth`. */
function fitSize(doc: Doc, text: string, b: { size: number; minSize: number; maxWidth: number; weight: Weight }, spacing = 0): number {
  let s = b.size;
  while (s > b.minSize && width(doc, text, b.weight, s, spacing) > b.maxWidth) s -= 0.5;
  return s;
}

/** Greedy word wrap into at most `max` lines; the last line is cut with an ellipsis if needed. */
function wrap(doc: Doc, text: string, weight: Weight, size: number, maxWidth: number, max: number): { lines: string[]; overflow: boolean } {
  const words = text.split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (!cur || width(doc, next, weight, size) <= maxWidth) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = words[i]!;
    if (lines.length === max) break;
  }
  if (lines.length < max && cur) {
    lines.push(cur);
    i = words.length;
  }
  const overflow = i < words.length || lines.some((l) => width(doc, l, weight, size) > maxWidth);
  return { lines, overflow };
}

function ellipsize(doc: Doc, text: string, weight: Weight, size: number, maxWidth: number): string {
  if (width(doc, text, weight, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && width(doc, `${t}…`, weight, size) > maxWidth) t = t.slice(0, -1).trimEnd();
  return `${t}…`;
}

/**
 * Text that may take up to `maxLines` lines: one line, shrinking down to `wrapBelow`; then
 * wrapped, shrinking down to `minSize`; at the smallest size, the last line gets an ellipsis.
 */
function multiline(doc: Doc, text: string, b: Box, maxLines: number, wrapBelow = b.size): { lines: string[]; size: number } {
  for (let s = b.size; s >= wrapBelow; s -= 0.5) if (width(doc, text, b.weight, s) <= b.maxWidth) return { lines: [text], size: s };
  for (let s = Math.min(wrapBelow, b.size); s >= b.minSize; s -= 0.5) {
    const r = wrap(doc, text, b.weight, s, b.maxWidth, maxLines);
    if (!r.overflow) return { lines: r.lines, size: s };
  }
  const { lines } = wrap(doc, text, b.weight, b.minSize, b.maxWidth, maxLines);
  const last = lines.length - 1;
  const rest = text.split(' ').slice(lines.slice(0, last).join(' ').split(' ').filter(Boolean).length).join(' ');
  lines[last] = ellipsize(doc, rest, b.weight, b.minSize, b.maxWidth);
  return { lines, size: b.minSize };
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

/**
 * Signatures. The founder signs every certificate: her block is part of the artwork, on the right.
 * When she teaches the course (or it lists no instructor) that one signature stands for both.
 * When someone else teaches, her block moves to the left and the instructor signs on the right,
 * in the same style; two other instructors share the right side. The instructors' signatures
 * are their names in a handwriting font (Great Vibes, OFL).
 */
function signatures(doc: Doc, list: CertificatePdfInstructor[], L: Layout): void {
  const others = list.filter((i) => clean(i.name) && !FOUNDER.test(clean(i.name))).slice(0, 2);
  if (!others.length) return;
  const f = L.founder;
  // Clear the founder's place on the right, then put her block on the left at the same rule height.
  doc.image(asset(f.paper), f.x, f.y, { width: f.w, height: f.h });
  const k = f.left.w / f.w;
  doc.image(asset(f.file), f.left.x, f.ruleY - (f.ruleY - f.y) * k, { width: f.left.w, height: f.h * k });

  const s = L.signer;
  const gap = 24;
  const colW = (s.ruleX2 - s.ruleX1 - gap * (others.length - 1)) / others.length;
  others.forEach((p, i) => {
    const x1 = s.ruleX1 + i * (colW + gap);
    const cx = x1 + colW / 2;
    const name = clean(p.name);
    const sigSize = fitSize(doc, name, { size: others.length === 1 ? 54 : 40, minSize: 24, maxWidth: colW * 0.92, weight: SCRIPT });
    draw(doc, name, cx, s.ruleY - 12, { weight: SCRIPT, size: sigSize, color: INK, anchor: 'middle' });
    doc.save().moveTo(x1, s.ruleY).lineTo(x1 + colW, s.ruleY).lineWidth(2).strokeColor(INK).stroke().restore();
    const upper = name.toUpperCase();
    const nameSize = fitSize(doc, upper, { size: others.length === 1 ? s.nameSize : s.nameSize - 4, minSize: 11, maxWidth: colW, weight: 800 });
    draw(doc, upper, cx, s.nameY, { weight: 800, size: nameSize, color: INK, anchor: 'middle' });
    const title = clean(p.title);
    if (title) {
      const size = fitSize(doc, title, { size: others.length === 1 ? s.titleSize : s.titleSize - 3, minSize: 10, maxWidth: colW, weight: 400 });
      draw(doc, ellipsize(doc, title, 400, size, colW), cx, s.titleY, { weight: 400, size, color: TITLE_GREY, anchor: 'middle' });
    }
  });
}

/** Renders the certificate to a PDF buffer. */
export function renderCertificatePdf(c: CertificatePdfData): Promise<Buffer> {
  const attendance = c.kind === 'ATTENDANCE';
  const L = LAYOUTS[attendance ? 'ATTENDANCE' : 'COMPLETION'];
  const k = PAGE_WIDTH / L.width;
  const doc = new PDFDocument({
    size: [PAGE_WIDTH, L.height * k],
    margin: 0,
    info: {
      Title: `${c.courseTitle}: certificate ${c.serial}`,
      Author: CERTIFICATE_ORGANIZATION,
      Subject: `Certificate of ${attendance ? 'attendance' : 'completion'} for ${c.name}`,
      Creator: 'MLOps MENA Academy',
    },
  });
  for (const [w, file] of Object.entries(FONT_FILES)) doc.registerFont(`m${w}`, asset(file));
  doc.registerFont('arabic', asset('IBMPlexSansArabic-Regular.ttf'));
  doc.registerFont('arabic-bold', asset('IBMPlexSansArabic-Bold.ttf'));

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Everything below is in the template's own pixels.
  doc.scale(k);
  doc.image(asset(L.file), 0, 0, { width: L.width, height: L.height });

  const name = clean(c.name);
  draw(doc, name, L.name.x, L.name.y, { ...L.name, size: fitSize(doc, name, L.name, L.name.letterSpacing), spacing: L.name.letterSpacing });

  const course = multiline(doc, clean(c.courseTitle), L.course, 2, L.course.wrapBelow);
  course.lines.forEach((t, i) => draw(doc, t, L.course.x, L.course.y + i * L.course.lineHeight, { ...L.course, size: course.size }));
  // A second course line pushes the description down.
  const push = (course.lines.length - 1) * L.course.lineHeight;

  const description = clean(c.courseDescription);
  if (description) {
    const d = multiline(doc, description, L.description, 2);
    d.lines.forEach((t, i) => draw(doc, t, L.description.x, L.description.y + push + i * L.description.lineHeight, { ...L.description, size: d.size }));
  }

  qr(doc, c.verifyUrl, L.qr.x, L.qr.y, L.qr.size);
  draw(doc, c.serial, L.id.x, L.id.y, { ...L.id, size: fitSize(doc, c.serial, L.id) });
  draw(doc, 'Issued:', L.date.x, L.date.y, { weight: 500, size: L.date.size, color: GREY });
  draw(doc, dateEn(c.issuedAt), L.date.x + width(doc, 'Issued:', 500, L.date.size) + 6, L.date.y, { weight: 700, size: L.date.size, color: INK });

  signatures(doc, c.instructors, L);

  doc.end();
  return done;
}
