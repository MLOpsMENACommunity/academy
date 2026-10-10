import { z } from 'zod';
import { ALL_COUNTRIES } from './countries';
import { COURSE_LANGUAGES, type CourseLanguage, type EventStatus, type Role } from './enums';
import { linkedinProfileUrlSchema } from './links';
import { phoneSchema } from './profile';
import { DEFAULT_TIMEZONE } from './time';

// Every enum here has an identically named enum in apps/api/prisma/schema.prisma.

/** What a speaker can talk about (the application's multi-select). */
export const SPEAKER_AREAS = [
  'MLOPS',
  'LLMOPS',
  'KUBERNETES',
  'CLOUD_DEVOPS',
  'DATA_ENGINEERING',
  'AI_ARCHITECTURE',
  'OTHER',
] as const;
export type SpeakerArea = (typeof SPEAKER_AREAS)[number];

export const SPEAKER_FORMATS = ['TALK', 'HANDS_ON', 'WORKSHOP', 'QA'] as const;
export type SpeakerFormat = (typeof SPEAKER_FORMATS)[number];

/** SUBMITTED → APPROVED or REJECTED; a rejected application can be sent again. */
export const SPEAKER_APPLICATION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type SpeakerApplicationStatus = (typeof SPEAKER_APPLICATION_STATUSES)[number];

/** OPEN (bookable) → BOOKED; a cancelled booking makes the slot OPEN again. CANCELLED: withdrawn by the team. */
export const SLOT_STATUSES = ['OPEN', 'BOOKED', 'CANCELLED'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const speakerAreaLabels: Record<SpeakerArea, { en: string; ar: string }> = {
  MLOPS: { en: 'MLOps', ar: 'MLOps' },
  LLMOPS: { en: 'LLMOps', ar: 'LLMOps' },
  KUBERNETES: { en: 'Kubernetes', ar: 'Kubernetes' },
  CLOUD_DEVOPS: { en: 'Cloud / DevOps', ar: 'السحابة / DevOps' },
  DATA_ENGINEERING: { en: 'Data engineering', ar: 'هندسة البيانات' },
  AI_ARCHITECTURE: { en: 'AI architecture', ar: 'معمارية أنظمة الذكاء الاصطناعي' },
  OTHER: { en: 'Other', ar: 'أخرى' },
};

export const speakerFormatLabels: Record<SpeakerFormat, { en: string; ar: string }> = {
  TALK: { en: 'Talk', ar: 'محاضرة' },
  HANDS_ON: { en: 'Hands-on', ar: 'تطبيق عملي' },
  WORKSHOP: { en: 'Workshop', ar: 'ورشة عمل' },
  QA: { en: 'Q&A', ar: 'أسئلة وأجوبة' },
};

// ------------------------------------------------------------------ months & Cairo time

/** "2026-11": a calendar month. */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** Milliseconds `timeZone` is ahead of UTC at instant `at`. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in `timeZone` (Cairo by default), whatever the
 * machine's own zone: "19:00 Cairo" is 16:00 UTC in summer time and 17:00 UTC in winter.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone = DEFAULT_TIMEZONE): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let t = wall - zoneOffsetMs(wall, timeZone);
  // Second pass: the offset at the guessed instant can differ near a clock change.
  t = wall - zoneOffsetMs(t, timeZone);
  return new Date(t);
}

/** "2026-11" for an instant, in Cairo time (slots are grouped by the Cairo month). */
export function cairoMonthKey(at: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

// ------------------------------------------------------------------ application

const text = (min: number, max: number, message = 'Required') => z.string().trim().min(min, message).max(max);

/** The speaker application (short on purpose; the team follows up on WhatsApp or email). */
export const speakerApplicationSchema = z.object({
  fullName: text(2, 120, 'Enter your full name'),
  phone: phoneSchema,
  linkedinUrl: linkedinProfileUrlSchema,
  title: text(2, 160, 'Enter your current title'),
  company: z.string().trim().max(160).default(''),
  country: z.enum(ALL_COUNTRIES, { errorMap: () => ({ message: 'Choose your country' }) }),
  bio: text(30, 1500, 'Write at least 30 characters'),
  /**
   * Optional photo, as a public https link (e.g. your LinkedIn or GitHub picture). A link,
   * not an upload: speaker photos are public anyway, and the private file store only serves
   * short-lived links.
   */
  photoUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\/[^\s]+$/i, 'Use an https:// link to an image')
    .nullish()
    .or(z.literal('').transform(() => null)),
  areas: z
    .array(z.enum(SPEAKER_AREAS))
    .min(1, 'Choose at least one area')
    .max(SPEAKER_AREAS.length)
    .transform((a) => Array.from(new Set(a))),
  sessionTitle: text(5, 160, 'Write at least 5 characters'),
  abstract: text(50, 2000, 'Write at least 50 characters'),
  format: z.enum(SPEAKER_FORMATS, { errorMap: () => ({ message: 'Choose a format' }) }),
  language: z.enum(COURSE_LANGUAGES, { errorMap: () => ({ message: 'Choose a language' }) }),
  preferredMonths: z
    .array(monthKeySchema)
    .min(1, 'Choose at least one month')
    .max(6)
    .transform((a) => Array.from(new Set(a)).sort()),
});
export type SpeakerApplicationInput = z.infer<typeof speakerApplicationSchema>;

/** The team's decision. A rejection always says why (the speaker reads it). */
export const speakerReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(1000).default(''),
    /** Approve only: link this existing speaker profile instead of creating one. */
    instructorId: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .or(z.literal('').transform(() => null)),
  })
  .superRefine((r, ctx) => {
    if (r.decision === 'REJECT' && r.note.length < 5) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tell the speaker why (at least 5 characters)' });
  });
export type SpeakerReviewInput = z.infer<typeof speakerReviewSchema>;

export const speakerApplicationFilterSchema = z.object({
  status: z.enum(SPEAKER_APPLICATION_STATUSES).optional(),
  area: z.enum(SPEAKER_AREAS).optional(),
  q: z.string().trim().max(100).optional(),
});
export type SpeakerApplicationFilter = z.infer<typeof speakerApplicationFilterSchema>;

/** Switch an account between student and speaker (never to or from ADMIN). */
export const accountRoleSchema = z.object({ role: z.enum(['STUDENT', 'SPEAKER']) });

// ------------------------------------------------------------------ slots

const duration = z.coerce.number().int().min(30).max(240);

export const slotInputSchema = z.object({ startsAt: z.coerce.date(), durationMin: duration });
export type SlotInput = z.infer<typeof slotInputSchema>;

export const MAX_GENERATED_SLOTS = 200;

/** "Saturdays and Tuesdays at 19:00 Cairo, 60 minutes, in November and December". */
export const slotGeneratorSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: z
    .array(z.coerce.number().int().min(0).max(6))
    .min(1, 'Choose at least one day')
    .max(7)
    .transform((a) => Array.from(new Set(a)).sort()),
  /** Cairo wall-clock time, 24h. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hours)'),
  durationMin: duration,
  months: z
    .array(monthKeySchema)
    .min(1, 'Choose at least one month')
    .max(12)
    .transform((a) => Array.from(new Set(a)).sort()),
});
export type SlotGeneratorInput = z.infer<typeof slotGeneratorSchema>;

/**
 * Every start time the generator makes: each chosen weekday of each chosen month at the
 * Cairo time, skipping times already past. Cairo's clock changes don't move the wall time.
 */
export function generateSlotTimes(input: SlotGeneratorInput, now = new Date()): Date[] {
  const [hh, mm] = input.time.split(':').map(Number) as [number, number];
  const out: Date[] = [];
  for (const month of input.months) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      // A calendar date has the same weekday everywhere.
      if (!input.weekdays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) continue;
      const at = zonedTimeToUtc(y, m, d, hh, mm);
      if (at.getTime() > now.getTime()) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The speaker's session, as typed when booking (prefilled from the application). */
export const slotBookingSchema = z.object({
  title: text(5, 160, 'Write at least 5 characters'),
  abstract: text(50, 2000, 'Write at least 50 characters'),
});
export type SlotBookingInput = z.infer<typeof slotBookingSchema>;

/** A booking can be cancelled by the speaker until `cancelDays` days before it starts. */
export function cancelDeadline(startsAt: Date | string, cancelDays: number): Date {
  return new Date(new Date(startsAt).getTime() - cancelDays * 86_400_000);
}
export function canCancelBooking(startsAt: Date | string, cancelDays: number, now = new Date()): boolean {
  return now.getTime() < cancelDeadline(startsAt, cancelDays).getTime();
}

// ------------------------------------------------------------------ routing

/** Pages only students use: a speaker landing on one goes to the speaker portal instead. */
export function isStudentOnlyPath(path: string, locale: string): boolean {
  const p = path.split(/[?#]/)[0] ?? '';
  return (
    p === `/${locale}/dashboard` ||
    p.startsWith(`/${locale}/dashboard/`) ||
    p === `/${locale}/onboarding` ||
    p.startsWith(`/${locale}/learn`) ||
    /^\/[a-z]{2}\/courses\/[^/]+\/apply$/.test(p)
  );
}

/** Where an account lands by default. */
export function homePath(role: Role, locale: string): string {
  if (role === 'ADMIN') return `/${locale}/admin`;
  if (role === 'SPEAKER') return `/${locale}/speaker`;
  return `/${locale}/dashboard`;
}

// ------------------------------------------------------------------ DTOs

export interface SpeakerApplicationDto {
  id: string;
  status: SpeakerApplicationStatus;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  title: string;
  company: string;
  country: string;
  bio: string;
  photoUrl: string | null;
  areas: SpeakerArea[];
  sessionTitle: string;
  abstract: string;
  format: SpeakerFormat;
  language: CourseLanguage;
  preferredMonths: string[];
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  /** How many times it was sent (1 + resubmissions). */
  submissions: number;
}

export interface SpeakingSlotDto {
  id: string;
  startsAt: string;
  durationMin: number;
}

export interface SpeakerBookingDto {
  slotId: string;
  startsAt: string;
  durationMin: number;
  title: string;
  /** Upcoming until it ends. */
  past: boolean;
  canCancel: boolean;
  cancelUntil: string;
  calendarUrl: string;
  icsUrl: string;
  /** The session the team prepares from the booking (a draft until they publish it). */
  event: {
    slug: string;
    status: EventStatus;
    /** Shown after the session (when the team adds it). */
    recordingUrl: string | null;
    /** People registered for it. */
    registered: number;
  } | null;
}

export interface SpeakerPortalDto {
  application: SpeakerApplicationDto | null;
  /** The public /speakers/{slug} page, once it has something public to show. */
  speakerPageSlug: string | null;
  bookings: SpeakerBookingDto[];
  rules: { maxOpenBookings: number; cancelDays: number };
}

export interface AdminSpeakerApplicationDto extends SpeakerApplicationDto {
  userId: string;
  userRole: Role;
  reviewedBy: string | null;
  instructor: { id: string; slug: string | null; name: string } | null;
}

export interface AdminSlotDto {
  id: string;
  startsAt: string;
  durationMin: number;
  status: SlotStatus;
  title: string | null;
  bookedBy: { id: string; name: string; email: string } | null;
  event: { id: string; slug: string; status: EventStatus } | null;
}
