import { z } from 'zod';
import { parseCsv } from './csv';
import { normalizeSerial } from './certificates';
import type { CertificateKind } from './enums';

/**
 * Certificates issued before the academy (the n8n workflow and its public verification sheet),
 * imported so their codes keep verifying here, and the code handling shared by the verify page.
 */

/** Any printed code: letters and digits in 2 to 6 dash-separated groups, 6 to 40 characters (e.g. MLOPS-01-2026-00023). */
export const CERTIFICATE_CODE_PATTERN = /^(?=.{6,40}$)[A-Z0-9]+(?:-[A-Z0-9]+){1,5}$/;

/** A code as typed, pasted or scanned (any case, spaces) in its canonical form, or null if it can't be one. */
export function normalizeCertificateCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return normalizeSerial(s) ?? (CERTIFICATE_CODE_PATTERN.test(s) ? s : null);
}

/**
 * The code in what a QR scanner read: the bare code (certificates issued before the academy), or a
 * link to a verification page (/certificates/<code>, or ?code=<code> on the verify pages).
 */
export function codeFromScan(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const q = u.searchParams.get('code');
      if (q) return normalizeCertificateCode(q);
      const m = u.pathname.match(/\/certificates\/([^/]+)\/?$/);
      return m ? normalizeCertificateCode(decodeURIComponent(m[1]!)) : null;
    } catch {
      return null;
    }
  }
  return normalizeCertificateCode(t);
}

// ------------------------------------------------------------------ CSV import

export const MAX_EARLIER_CERTIFICATES = 5000;

export interface EarlierCertificateRow {
  line: number;
  code: string;
  holderName: string;
  courseTitle: string;
  /** YYYY-MM-DD */
  issuedOn: string;
  kind: CertificateKind;
  revoked: boolean;
  revokeReason: string | null;
  email: string | null;
}

/** 2026/11/15 or 2026-11-15 → 2026-11-15, if it is a real date. */
function isoDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The public verification sheet's columns, in any order and case: code, holder_name, course,
 * issued_on, and optionally status (valid / revoked), email, kind (attendance / completion),
 * revoke_reason. Errors are per line; a file with any error is not imported.
 */
export function parseEarlierCertificatesCsv(text: string): { rows: EarlierCertificateRow[]; errors: { line: number; message: string }[] } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const errors: { line: number; message: string }[] = [];
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const i = {
    code: col('code', 'certificateid', 'id'),
    name: col('holdername', 'name', 'recipientname'),
    course: col('course', 'coursetitle', 'coursename'),
    issued: col('issuedon', 'issuedate', 'date'),
    status: col('status'),
    email: col('email'),
    kind: col('kind', 'type'),
    reason: col('revokereason', 'reason'),
  };
  if (i.code < 0 || i.name < 0 || i.course < 0 || i.issued < 0) {
    return { rows: [], errors: [{ line: 1, message: 'The first row must name the columns: code, holder_name, course, issued_on (status, email, kind optional)' }] };
  }
  if (table.length - 1 > MAX_EARLIER_CERTIFICATES) return { rows: [], errors: [{ line: 1, message: `At most ${MAX_EARLIER_CERTIFICATES} rows per file` }] };
  const rows: EarlierCertificateRow[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const cell = (k: keyof typeof i) => (i[k] >= 0 ? (r[i[k]] ?? '').trim() : '');
    const code = normalizeCertificateCode(cell('code'));
    if (!code) return errors.push({ line, message: 'Not a valid certificate code' });
    if (seen.has(code)) return errors.push({ line, message: `The same code as line ${seen.get(code)}` });
    seen.set(code, line);
    const holderName = cell('name').replace(/\s+/g, ' ');
    if (holderName.length < 2 || holderName.length > 200) return errors.push({ line, message: 'The name must be 2 to 200 characters' });
    const courseTitle = cell('course').replace(/\s+/g, ' ');
    if (courseTitle.length < 2 || courseTitle.length > 200) return errors.push({ line, message: 'The course must be 2 to 200 characters' });
    const issuedOn = isoDate(cell('issued'));
    if (!issuedOn) return errors.push({ line, message: 'The date must be YYYY/MM/DD or YYYY-MM-DD' });
    const status = cell('status').toLowerCase() || 'valid';
    if (status !== 'valid' && status !== 'revoked') return errors.push({ line, message: 'Status must be valid or revoked' });
    const kind = cell('kind').toLowerCase() || 'attendance';
    if (kind !== 'attendance' && kind !== 'completion') return errors.push({ line, message: 'Kind must be attendance or completion' });
    const email = cell('email').toLowerCase() || null;
    if (email !== null && !z.string().email().safeParse(email).success) return errors.push({ line, message: 'Not a valid email' });
    rows.push({
      line,
      code,
      holderName,
      courseTitle,
      issuedOn,
      kind: kind === 'completion' ? 'COMPLETION' : 'ATTENDANCE',
      revoked: status === 'revoked',
      revokeReason: status === 'revoked' ? cell('reason').slice(0, 500) || null : null,
      email,
    });
  });
  return { rows, errors };
}

export const earlierCertificatesImportSchema = z.object({
  csv: z.string().max(2_000_000),
  /** Check the file and count what would change, without saving. */
  dryRun: z.boolean().default(true),
});
export type EarlierCertificatesImportInput = z.infer<typeof earlierCertificatesImportSchema>;

export interface EarlierCertificatesImportResultDto {
  dryRun: boolean;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Certificates attached to an existing account (verified email matches). */
  linked: number;
  /** Per-line problems; when there are any, nothing was saved. */
  errors: { line: number; message: string }[];
  /** Imported (or would be) in total, with this file. */
  total: number;
}
