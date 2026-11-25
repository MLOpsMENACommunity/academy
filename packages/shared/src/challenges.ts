import { z } from 'zod';

/**
 * Cohort challenges ("Deploy a model in a week"): a time-boxed task, open to every signed-in
 * member or to the enrolled students of one course. Students submit a link (a repository or a
 * demo) and a note; course staff or the academic team review it; an approval awards the
 * challenge's badge and its points (once, however many times it is approved).
 *
 * Statuses are text columns with a CHECK constraint in the database (no Postgres enums for
 * state, docs/ENGINEERING.md §7), so the lists live here rather than in enums.ts.
 */

// ------------------------------------------------------------------ constants

export const CHALLENGE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const CHALLENGE_ENTRY_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ChallengeEntryStatus = (typeof CHALLENGE_ENTRY_STATUSES)[number];

export const CHALLENGE_MAX_POINTS = 500;
export const CHALLENGE_URL_MAX = 500;
export const CHALLENGE_NOTE_MAX = 1000;
export const CHALLENGE_FEEDBACK_MAX = 1000;
export const CHALLENGE_DESCRIPTION_MAX = 10_000;
/** At most this many opted-in finisher names per challenge on the public page. */
export const CHALLENGE_PUBLIC_NAMES_MAX = 50;
export const CHALLENGE_DEFAULT_ICON = '🚀';
/** The badge created with each challenge: code = prefix + challenge slug. */
export const CHALLENGE_BADGE_PREFIX = 'challenge-';

// ------------------------------------------------------------------ rules

export type ChallengePhase = 'upcoming' | 'open' | 'closed';

/** Upcoming before startsAt, open from startsAt until endsAt (exclusive), closed after. */
export function challengePhase(c: { startsAt: Date | string; endsAt: Date | string }, now: Date = new Date()): ChallengePhase {
  const t = now.getTime();
  if (t < new Date(c.startsAt).getTime()) return 'upcoming';
  if (t >= new Date(c.endsAt).getTime()) return 'closed';
  return 'open';
}

export type CannotSubmit = 'NOT_PUBLISHED' | 'NOT_ELIGIBLE' | 'NOT_STARTED' | 'CLOSED' | 'ALREADY_APPROVED';

/**
 * Whether a student may submit (or resubmit) an entry now: the challenge is published and
 * open, they are eligible (any signed-in member, or enrolled in the challenge's course), and
 * their entry, if any, is not approved yet. A pending or rejected entry can be sent again
 * while the challenge is open; it goes back to PENDING.
 */
export function canSubmit(
  c: { status: ChallengeStatus; startsAt: Date | string; endsAt: Date | string },
  eligible: boolean,
  entry: { status: ChallengeEntryStatus } | null,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: CannotSubmit } {
  if (c.status !== 'PUBLISHED') return { ok: false, reason: 'NOT_PUBLISHED' };
  if (!eligible) return { ok: false, reason: 'NOT_ELIGIBLE' };
  const phase = challengePhase(c, now);
  if (phase === 'upcoming') return { ok: false, reason: 'NOT_STARTED' };
  if (phase === 'closed') return { ok: false, reason: 'CLOSED' };
  if (entry?.status === 'APPROVED') return { ok: false, reason: 'ALREADY_APPROVED' };
  return { ok: true };
}

/** An https link without credentials or a non-default port: what a student may submit. */
export function isHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.includes('.');
}

// ------------------------------------------------------------------ inputs

const challengeBase = z.object({
  /** Null: open to every signed-in member. Otherwise: the enrolled students of this course. */
  courseId: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => v || null),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Lowercase letters, numbers and dashes (2–60)'),
  titleEn: z.string().trim().min(3, 'Required').max(120),
  titleAr: z.string().trim().min(3, 'Required').max(120),
  descriptionEn: z.string().trim().min(1, 'Required').max(CHALLENGE_DESCRIPTION_MAX),
  descriptionAr: z.string().trim().min(1, 'Required').max(CHALLENGE_DESCRIPTION_MAX),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  points: z.coerce.number().int().min(0).max(CHALLENGE_MAX_POINTS),
  /** The badge's icon (an emoji). */
  icon: z.string().trim().min(1, 'Pick an icon').max(16).default(CHALLENGE_DEFAULT_ICON),
  status: z.enum(CHALLENGE_STATUSES).default('DRAFT'),
});

const endsAfterStart = (v: { startsAt: Date; endsAt: Date }) => v.endsAt.getTime() > v.startsAt.getTime();
const endsAfterStartError = { message: 'Must end after it starts', path: ['endsAt'] };

/** Creating a challenge (its badge is created with it). */
export const challengeInputSchema = challengeBase.refine(endsAfterStart, endsAfterStartError);
export type ChallengeInput = z.infer<typeof challengeInputSchema>;

/** Editing: everything but the slug (the badge's code) and the course (who could enter). */
export const challengeUpdateSchema = challengeBase.omit({ slug: true, courseId: true }).refine(endsAfterStart, endsAfterStartError);
export type ChallengeUpdate = z.infer<typeof challengeUpdateSchema>;

export const challengeUrlSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(CHALLENGE_URL_MAX)
  .refine(isHttpsUrl, 'Use an https:// link');

/** A student's entry: a link (repository or demo), a note, and whether to show their name publicly. */
export const challengeEntrySchema = z.object({
  url: challengeUrlSchema,
  note: z.string().trim().max(CHALLENGE_NOTE_MAX).default(''),
  /** "Show my name on the public challenges page" (first name + last initial). Off by default. */
  showName: z.boolean().default(false),
});
export type ChallengeEntryInput = z.infer<typeof challengeEntrySchema>;

/** The public-name choice alone (it can change after approval, when the entry itself can't). */
export const challengeVisibilitySchema = z.object({ showName: z.boolean() });
export type ChallengeVisibilityInput = z.infer<typeof challengeVisibilitySchema>;

/** A review: approve, or reject with feedback saying what to fix. */
export const challengeReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    feedback: z.string().trim().max(CHALLENGE_FEEDBACK_MAX).default(''),
  })
  .refine((v) => v.decision === 'APPROVE' || v.feedback.length > 0, { message: 'Say what to change', path: ['feedback'] });
export type ChallengeReviewInput = z.infer<typeof challengeReviewSchema>;

export const challengeEntriesQuerySchema = z.object({ status: z.enum(CHALLENGE_ENTRY_STATUSES).optional() });
export type ChallengeEntriesQuery = z.infer<typeof challengeEntriesQuerySchema>;

// ------------------------------------------------------------------ responses

export interface ChallengeCourseRef {
  slug: string;
  titleEn: string;
  titleAr: string;
}

/** What everyone may see of a published challenge. */
export interface PublicChallengeDto {
  slug: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  startsAt: string;
  endsAt: string;
  points: number;
  badge: { icon: string; nameEn: string; nameAr: string };
  /** Null: open to every signed-in member. */
  course: ChallengeCourseRef | null;
  phase: ChallengePhase;
  /** Approved entries of accounts that still exist. */
  finishers: number;
  /** First name + last initial, only for finishers who chose to be shown. */
  finisherNames: string[];
}

export interface MyChallengeEntryDto {
  status: ChallengeEntryStatus;
  url: string;
  note: string;
  showName: boolean;
  feedback: string | null;
  reviewedAt: string | null;
  submittedAt: string;
}

/** A challenge as a signed-in student sees it: the public view plus their entry and whether they may enter. */
export interface MyChallengeDto extends PublicChallengeDto {
  eligible: boolean;
  canSubmit: boolean;
  /** Why not, when canSubmit is false. */
  blocked: CannotSubmit | null;
  entry: MyChallengeEntryDto | null;
}

/** Staff: a challenge with its review counts. */
export interface StaffChallengeDto {
  id: string;
  courseId: string | null;
  course: ChallengeCourseRef | null;
  slug: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  startsAt: string;
  endsAt: string;
  points: number;
  icon: string;
  status: ChallengeStatus;
  phase: ChallengePhase;
  counts: Record<ChallengeEntryStatus, number>;
  createdAt: string;
}

export interface StaffChallengeEntryDto {
  id: string;
  /** Course staff get the name (the email only when there is no name, as in the gradebook); admins get both. */
  student: { id: string; name: string | null; email: string | null };
  url: string;
  note: string;
  status: ChallengeEntryStatus;
  feedback: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}
