import { z } from 'zod';
import type { BadgeKind, PointsReason } from './enums';

/**
 * Points, badges and course leaderboards. The rules here are pure (no database), so the
 * API, the web app and the tests share them: course weeks in Cairo time, ranking with
 * ties, the ledger's delta math, CSV parsing and the request/response shapes.
 */

// ------------------------------------------------------------------ constants

/** Course weeks run in the academy's time zone, whatever the student's own. */
export const COURSE_TIMEZONE = 'Africa/Cairo';
export const LEADERBOARD_SIZE = 10;
/** "Top of the week" / "Top of the course" go to ranks 1–3 (more than 3 people on a tie). */
export const TOP_AWARD_RANK = 3;
/** With no end date, a course ends this many days after its last session starts. */
export const COURSE_END_GRACE_DAYS = 7;

export const BADGE_CODES = {
  TOP_WEEK: 'top-week',
  TOP_COURSE: 'top-course',
  PERFECT_SCORE: 'perfect-score',
  FINISHER: 'finisher',
  CERTIFIED: 'certified',
  TOP_PERFORMER: 'top-performer',
  COMMUNITY_HELPER: 'community-helper',
  SPEAKER: 'speaker',
} as const;

/** Ledger source types of automatic entries (unique per student with sourceId + sourceSeq). */
export const POINTS_SOURCES = { ASSESSMENT: 'ASSESSMENT', SESSION: 'SESSION', CERTIFICATE: 'CERTIFICATE' } as const;

/** Reasons an admin can pick by hand (the others are automatic). */
export const MANUAL_POINTS_REASONS = ['MANUAL_COMMUNITY', 'MANUAL_OTHER', 'ADJUSTMENT'] as const satisfies readonly PointsReason[];
export type ManualPointsReason = (typeof MANUAL_POINTS_REASONS)[number];

// ------------------------------------------------------------------ time zones and course weeks

const DAY_MS = 86_400_000;

/** The wall-clock date and time of an instant in a time zone. */
function wallClock(at: Date, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, min: n('minute'), s: n('second') };
}

/** Milliseconds the zone is ahead of UTC at this instant (Cairo: +2 h, or +3 h in summer time). */
export function zoneOffsetMs(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a local midnight happens in a zone (y, m 1–12, d may overflow: Date.UTC normalises). */
export function localMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle the offset on either side of a DST change.
  let t = guess - zoneOffsetMs(new Date(guess), tz);
  t = guess - zoneOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Local midnight that starts the day containing `at`, plus `days` local days (DST-safe). */
export function startOfLocalDay(at: Date, tz: string, days = 0): Date {
  const w = wallClock(at, tz);
  return localMidnight(w.y, w.m, w.d + days, tz);
}

/**
 * Course week n (1-based) starts at local midnight (Cairo) of the first session's day,
 * plus 7(n − 1) calendar days. Across a DST change a week is 167 or 169 hours long, but
 * it always starts at midnight on the same weekday.
 */
export function courseWeekStart(firstSessionAt: Date, week: number, tz = COURSE_TIMEZONE): Date {
  return startOfLocalDay(firstSessionAt, tz, 7 * (week - 1));
}

export function courseWeekRange(firstSessionAt: Date, week: number, tz = COURSE_TIMEZONE): { start: Date; end: Date } {
  return { start: courseWeekStart(firstSessionAt, week, tz), end: courseWeekStart(firstSessionAt, week + 1, tz) };
}

/** The course week an instant falls in; null before week 1 starts. */
export function courseWeekOf(firstSessionAt: Date, at: Date, tz = COURSE_TIMEZONE): number | null {
  const start = courseWeekStart(firstSessionAt, 1, tz);
  if (at.getTime() < start.getTime()) return null;
  let n = Math.floor((at.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  // The estimate can be off by one within an hour of a boundary across a DST change.
  while (n > 1 && at.getTime() < courseWeekStart(firstSessionAt, n, tz).getTime()) n--;
  while (at.getTime() >= courseWeekStart(firstSessionAt, n + 1, tz).getTime()) n++;
  return n;
}

/**
 * When the course ends: the end of its end date (local midnight after it), otherwise
 * COURSE_END_GRACE_DAYS after its last session starts; null when neither is known.
 */
export function courseEndsAt(c: { endDate: Date | null; lastSessionAt: Date | null }, tz = COURSE_TIMEZONE): Date | null {
  if (c.endDate) return startOfLocalDay(c.endDate, tz, 1);
  if (c.lastSessionAt) return new Date(c.lastSessionAt.getTime() + COURSE_END_GRACE_DAYS * DAY_MS);
  return null;
}

/** How many weeks the course has (its end falls in the last one); null without an end. */
export function courseWeekCount(firstSessionAt: Date, endsAt: Date | null, tz = COURSE_TIMEZONE): number | null {
  if (!endsAt) return null;
  return courseWeekOf(firstSessionAt, new Date(endsAt.getTime() - 1), tz) ?? 1;
}

// ------------------------------------------------------------------ ranking

export interface Standing {
  userId: string;
  points: number;
  /** When the student reached this total (their latest entry in the window). Earlier wins a tie. */
  reachedAt: Date;
}

export interface Ranked extends Standing {
  /** Competition ranking: equal points share a rank, and the next rank skips (1, 1, 3). */
  rank: number;
}

/**
 * Orders students by points (highest first), ties by who got there first, and gives
 * equal points the same rank. Students with no positive points aren't ranked.
 */
export function rankStandings(rows: Standing[]): Ranked[] {
  const sorted = rows
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.reachedAt.getTime() - b.reachedAt.getTime() || a.userId.localeCompare(b.userId));
  const out: Ranked[] = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && prev.points === r.points ? prev.rank : i + 1 });
  });
  return out;
}

// ------------------------------------------------------------------ the ledger

/** Assessment points are the counted score (best or last attempt), as whole points. */
export function assessmentPoints(score: number | null | undefined): number {
  return score == null ? 0 : Math.round(score);
}

/**
 * What to append so a source's entries add up to `target` points: the delta and the
 * next sequence number, or null when the ledger already matches. Never edits a row.
 */
export function ledgerDelta(entries: { points: number; sourceSeq: number }[], target: number): { points: number; sourceSeq: number } | null {
  const current = entries.reduce((n, e) => n + e.points, 0);
  if (current === target) return null;
  const seq = entries.length ? Math.max(...entries.map((e) => e.sourceSeq)) + 1 : 0;
  return { points: target - current, sourceSeq: seq };
}

/** The uniqueness scope of a badge award (see UserBadge.scopeKey). */
export function badgeScopeKey(courseId: string | null, week: number | null = null): string {
  if (!courseId) return 'global';
  return week ? `${courseId}:w${week}` : courseId;
}

// ------------------------------------------------------------------ names on boards

/** "Aya Nasser Salama" → "Aya S." Never a full name or an email on a leaderboard. */
export function boardName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return last ? `${first} ${Array.from(last)[0]!.toUpperCase()}.` : first;
}

// ------------------------------------------------------------------ CSV import

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export const MAX_IMPORT_ROWS = 2000;
export const POINTS_IMPORT_COLUMNS = ['email', 'points', 'note', 'course'] as const;

export interface PointsImportRow {
  line: number;
  email: string;
  points: number;
  note: string | null;
  courseSlug: string | null;
}

/** Header row required (any order, case-insensitive; "course" may be "course slug"). Errors are per line. */
export function parsePointsCsv(text: string): { rows: PointsImportRow[]; errors: { line: number; message: string }[] } {
  const table = parseCsv(text);
  const errors: { line: number; message: string }[] = [];
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iEmail = col('email');
  const iPoints = col('points');
  const iNote = col('note', 'notes', 'reason');
  const iCourse = col('course', 'courseslug', 'slug');
  if (iEmail < 0 || iPoints < 0) return { rows: [], errors: [{ line: 1, message: 'The first row must name the columns: email, points, note, course' }] };
  if (table.length - 1 > MAX_IMPORT_ROWS) return { rows: [], errors: [{ line: 1, message: `At most ${MAX_IMPORT_ROWS} rows per file` }] };
  const rows: PointsImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const email = (r[iEmail] ?? '').trim().toLowerCase();
    const rawPoints = (r[iPoints] ?? '').trim();
    const points = Number(rawPoints);
    if (!z.string().email().safeParse(email).success) return errors.push({ line, message: 'Not a valid email' });
    if (!/^[+-]?\d+$/.test(rawPoints) || points === 0 || Math.abs(points) > 10_000) return errors.push({ line, message: 'Points must be a whole number between -10000 and 10000, not 0' });
    const note = iNote >= 0 ? (r[iNote] ?? '').trim().slice(0, 500) || null : null;
    const courseSlug = iCourse >= 0 ? (r[iCourse] ?? '').trim().toLowerCase() || null : null;
    rows.push({ line, email, points, note, courseSlug });
  });
  return { rows, errors };
}

// ------------------------------------------------------------------ admin input

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const manualPointsSchema = z.object({
  points: z.coerce
    .number()
    .int('Whole points only')
    .min(-10_000)
    .max(10_000)
    .refine((n) => n !== 0, 'Enter a number other than 0'),
  reason: z.enum(MANUAL_POINTS_REASONS),
  courseId: optionalText(40),
  note: text(500).min(1, 'Say what the points are for'),
});
export type ManualPointsInput = z.infer<typeof manualPointsSchema>;

export const pointsImportSchema = z.object({
  csv: z.string().max(500_000),
  dryRun: z.boolean().default(true),
});
export type PointsImportInput = z.infer<typeof pointsImportSchema>;

/** An emoji or a short icon key: what shows on the badge. */
const iconSchema = z.string().trim().min(1, 'Pick an icon').max(16);

export const badgeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Lowercase letters, numbers and dashes (2–40)'),
  nameEn: text(60).min(1, 'Required'),
  nameAr: text(60).min(1, 'Required'),
  descriptionEn: text(300).default(''),
  descriptionAr: text(300).default(''),
  icon: iconSchema,
  active: z.boolean().default(true),
});
export type BadgeInput = z.infer<typeof badgeInputSchema>;
export const badgeUpdateSchema = badgeInputSchema.omit({ code: true }).partial();
export type BadgeUpdate = z.infer<typeof badgeUpdateSchema>;

export const awardBadgeSchema = z.object({
  badgeId: z.string().min(1).max(40),
  courseId: optionalText(40),
  reason: optionalText(300),
});
export type AwardBadgeInput = z.infer<typeof awardBadgeSchema>;

export const LEADERBOARD_SCOPES = ['week', 'course'] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];
export const leaderboardQuerySchema = z.object({
  scope: z.enum(LEADERBOARD_SCOPES).default('course'),
  week: z.coerce.number().int().min(1).max(520).optional(),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const leaderboardOptInSchema = z.object({ optedIn: z.boolean() });

// ------------------------------------------------------------------ responses

export interface BadgeDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: string;
  kind: BadgeKind;
  active: boolean;
}

/** A badge someone holds. */
export interface UserBadgeDto {
  id: string;
  badge: Pick<BadgeDto, 'code' | 'nameEn' | 'nameAr' | 'descriptionEn' | 'descriptionAr' | 'icon' | 'kind'>;
  course: { slug: string; titleEn: string; titleAr: string } | null;
  period: number | null;
  awardedAt: string;
  reason: string | null;
}

export interface PointsEntryDto {
  id: string;
  points: number;
  reason: PointsReason;
  note: string | null;
  /** What earned automatic points: the assessment or session title. */
  label: { en: string; ar: string } | null;
  /** A later change to an automatic award (a regrade, an unmarked session). */
  adjustment: boolean;
  course: { slug: string; titleEn: string; titleAr: string } | null;
  createdAt: string;
}

export interface MyPointsDto {
  total: number;
  courses: { slug: string; titleEn: string; titleAr: string; points: number }[];
  recent: PointsEntryDto[];
  badges: UserBadgeDto[];
}

export interface LeaderboardRowDto {
  rank: number;
  /** First name + last initial. */
  name: string;
  points: number;
  badges: { code: string; icon: string; nameEn: string; nameAr: string; period: number | null }[];
  me: boolean;
}

export interface LeaderboardDto {
  scope: LeaderboardScope;
  /** The week shown (week scope), else null. */
  week: number | null;
  weeks: {
    /** This week, or null before the course starts (or after it ends: the last week). */
    current: number | null;
    /** Weeks so far that can be picked (1…available). */
    available: number;
    total: number | null;
    start: string | null;
    end: string | null;
  };
  courseEnded: boolean;
  rows: LeaderboardRowDto[];
  /** The requesting student only; null for admins who aren't enrolled. */
  me: { rank: number | null; points: number; optedIn: boolean } | null;
  participants: number;
  total: number;
}

export interface AdminLeaderboardRowDto {
  rank: number | null;
  userId: string;
  name: string | null;
  email: string;
  points: number;
  optedIn: boolean;
  badges: string[];
}

export interface AdminLeaderboardDto {
  scope: LeaderboardScope;
  week: number | null;
  weeks: LeaderboardDto['weeks'];
  courseEnded: boolean;
  rows: AdminLeaderboardRowDto[];
  participants: number;
  total: number;
}

export interface AdminStudentPointsDto {
  total: number;
  courses: { id: string; slug: string; titleEn: string; titleAr: string; points: number }[];
  entries: (PointsEntryDto & { awardedBy: string | null; sourceType: string | null })[];
  badges: (UserBadgeDto & { awardedBy: string | null })[];
  /** Courses the student is enrolled in (for the award forms). */
  enrolledCourses: { id: string; slug: string; titleEn: string; titleAr: string }[];
}

export interface PointsImportResultDto {
  dryRun: boolean;
  rows: { line: number; email: string; points: number; note: string | null; course: string | null; status: 'ok' | 'error'; message?: string }[];
  ok: number;
  errors: number;
  totalPoints: number;
  applied: number;
}
