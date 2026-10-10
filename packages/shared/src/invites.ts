import { z } from 'zod';
import { emailSchema } from './auth';
import { LOCALES, type CourseInviteStatus, type Role } from './enums';
import { parseCsv } from './points';

/**
 * "Enrol by email": an admin adds people to a course by their email address, without the
 * application form. Addresses with a verified student account are enrolled at once; every
 * other address gets a PENDING invite that enrols the account once it owns a verified email
 * with that address (email confirmation or Google sign-in), never before.
 */

/** Most addresses in one preview or one enrolment (applied in one transaction). */
export const MAX_INVITE_BATCH = 300;
/** Pending (and revoked) invites are deleted by the daily retention job after this many days. */
export const INVITE_RETENTION_DAYS = 180;
/** A pending invite's email can be resent at most once a minute. */
export const INVITE_RESEND_INTERVAL_MS = 60_000;

/**
 * What enrolling an address would do (the preview), or did (the result).
 * - ENROL: a verified student account: enrolled now.
 * - INVITE: no account yet: invited, enrolled once they sign up and confirm the address.
 * - INVITE_UNVERIFIED: an account that hasn't confirmed its email yet: invited, enrolled once it does.
 * - ALREADY_ENROLLED / ALREADY_INVITED: nothing to do.
 * - SPEAKER / ADMIN: speaker and admin accounts can't be students here: skipped.
 * - CLOSED: the account was deleted: skipped.
 * - INVALID: not an email address. DUPLICATE: listed more than once (counted once).
 */
export const INVITE_OUTCOMES = [
  'ENROL',
  'INVITE',
  'INVITE_UNVERIFIED',
  'ALREADY_ENROLLED',
  'ALREADY_INVITED',
  'SPEAKER',
  'ADMIN',
  'CLOSED',
  'INVALID',
  'DUPLICATE',
] as const;
export type InviteOutcome = (typeof INVITE_OUTCOMES)[number];

/** Outcomes that write something when applied. */
export const ACTIONABLE_INVITE_OUTCOMES: readonly InviteOutcome[] = ['ENROL', 'INVITE', 'INVITE_UNVERIFIED'];

export interface InviteEntryInput {
  /** As typed or found in the file; normalised on the server. */
  email: string;
  name?: string | null;
  note?: string | null;
}

const entrySchema = z.object({
  email: z.string().max(320),
  name: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(500).nullish(),
});

export const invitePreviewSchema = z.object({
  entries: z.array(entrySchema).min(1).max(MAX_INVITE_BATCH),
});
export type InvitePreviewInput = z.infer<typeof invitePreviewSchema>;

export const inviteApplySchema = invitePreviewSchema.extend({
  /** Email the enrolled students and the invited addresses (default on). */
  sendEmail: z.boolean().default(true),
  /** Paid courses: the admin confirms these people are enrolled without paying. Required for paid courses. */
  skipPayment: z.boolean().default(false),
  /** Language of the invitation email to addresses without an account (accounts use their own). */
  locale: z.enum(LOCALES).default('en'),
});
export type InviteApplyInput = z.infer<typeof inviteApplySchema>;

export interface InvitePreviewRow {
  email: string;
  name: string | null;
  note: string | null;
  outcome: InviteOutcome;
}

export interface InvitePreviewDto {
  rows: InvitePreviewRow[];
  counts: Partial<Record<InviteOutcome, number>>;
  course: { type: 'FREE' | 'PAID'; capacity: number | null; seatsTaken: number };
}

export interface InviteApplyResultDto extends InvitePreviewDto {
  enrolled: number;
  invited: number;
  emailed: number;
}

export interface CourseInviteDto {
  id: string;
  email: string;
  status: CourseInviteStatus;
  note: string | null;
  locale: 'en' | 'ar';
  invitedBy: string | null;
  createdAt: string;
  enrolledAt: string | null;
  lastEmailedAt: string | null;
  /** The enrolled student's name, when there is one. */
  name: string | null;
}

export interface CourseInvitesDto {
  counts: Record<CourseInviteStatus, number>;
  items: CourseInviteDto[];
}

// ------------------------------------------------------------------ parsing

/**
 * One address as people paste it: `Name <a@b.com>`, `mailto:a@b.com`, quoted, with stray
 * punctuation. Returns the lower-cased address, or null when it isn't one.
 */
export function normaliseEmail(raw: string): string | null {
  let s = raw.trim();
  const angled = s.match(/<([^<>]+)>/);
  if (angled) s = angled[1]!;
  s = s
    .replace(/^mailto:/i, '')
    .replace(/^["'([{]+|["')\]};:.,]+$/g, '')
    .trim();
  const parsed = emailSchema.safeParse(s);
  return parsed.success ? parsed.data : null;
}

export interface ParsedInviteList {
  /** Unique addresses in the order first seen (raw text kept for invalid ones). */
  entries: { email: string; name: string | null; note: string | null; valid: boolean; duplicate: boolean }[];
}

/** Normalises, validates and marks repeats (first occurrence wins). Used by both parsers and by the API. */
export function normaliseInviteEntries(items: InviteEntryInput[]): ParsedInviteList {
  const seen = new Set<string>();
  const entries: ParsedInviteList['entries'] = [];
  for (const it of items) {
    const raw = it.email.trim();
    if (!raw) continue;
    const email = normaliseEmail(raw);
    const name = it.name?.trim() || null;
    const note = it.note?.trim() || null;
    if (!email) {
      entries.push({ email: raw.slice(0, 320), name, note, valid: false, duplicate: false });
      continue;
    }
    const duplicate = seen.has(email);
    seen.add(email);
    entries.push({ email, name, note, valid: true, duplicate });
  }
  return { entries };
}

/** Pasted text: addresses separated by commas, semicolons, spaces or new lines. `Name <a@b.com>` works too. */
export function parseEmailList(text: string): ParsedInviteList {
  const tokens: string[] = [];
  for (const segment of text.split(/[,;\r\n]+/)) {
    // "Name <address>": the address is the part in angle brackets.
    const angled = [...segment.matchAll(/<([^<>]+)>/g)].map((m) => m[1]!);
    if (angled.length) {
      tokens.push(...angled);
      continue;
    }
    const words = segment.split(/\s+/).filter(Boolean);
    // "Mona Ali mona@x.com": the words next to an address are a name, not addresses.
    const withAt = words.filter((w) => w.includes('@'));
    tokens.push(...(withAt.length ? withAt : words));
  }
  return normaliseInviteEntries(tokens.map((email) => ({ email })));
}

/**
 * A CSV file: `email[, name, note]`. With a header row the columns can be in any order
 * ("email", "name"/"full name", "note"/"notes"); without one the first three columns are used.
 */
export function parseInviteCsv(text: string): ParsedInviteList {
  const table = parseCsv(text);
  if (!table.length) return { entries: [] };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const hasHeader = header.some((h) => ['email', 'emailaddress', 'e-mail', 'mail'].includes(h));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iEmail = hasHeader ? col('email', 'emailaddress', 'e-mail', 'mail') : 0;
  const iName = hasHeader ? col('name', 'fullname', 'student', 'studentname') : 1;
  const iNote = hasHeader ? col('note', 'notes', 'comment') : 2;
  const rows = hasHeader ? table.slice(1) : table;
  return normaliseInviteEntries(
    rows.map((r) => ({
      email: r[iEmail] ?? '',
      name: iName >= 0 ? (r[iName] ?? null) : null,
      note: iNote >= 0 ? (r[iNote] ?? null) : null,
    })),
  );
}

// ------------------------------------------------------------------ classification

/** What the server knows about one address when classifying it. */
export interface InviteFacts {
  valid: boolean;
  duplicate: boolean;
  account: { role: Role; verified: boolean; deleted: boolean } | null;
  enrolled: boolean;
  /** Status of an existing invite for this course and address. */
  invite: CourseInviteStatus | null;
}

export function classifyInvite(f: InviteFacts): InviteOutcome {
  if (!f.valid) return 'INVALID';
  if (f.duplicate) return 'DUPLICATE';
  if (f.enrolled) return 'ALREADY_ENROLLED';
  if (f.account?.deleted) return 'CLOSED';
  if (f.account?.role === 'SPEAKER') return 'SPEAKER';
  if (f.account?.role === 'ADMIN') return 'ADMIN';
  // A verified account is enrolled even with a pending invite (enrolling settles the invite).
  if (f.account?.verified) return 'ENROL';
  if (f.invite === 'PENDING') return 'ALREADY_INVITED';
  return f.account ? 'INVITE_UNVERIFIED' : 'INVITE';
}

export function countOutcomes(rows: { outcome: InviteOutcome }[]): Partial<Record<InviteOutcome, number>> {
  const counts: Partial<Record<InviteOutcome, number>> = {};
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
}
