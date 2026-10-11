import { z } from 'zod';
import { COURSE_LANGUAGES } from './enums';
import { normalizeLinkedinUrl, LINKEDIN_PROFILE_MESSAGE } from './links';

// Every enum here that is stored in its own column has an identically named enum in
// apps/api/prisma/schema.prisma. The detail enums (level, episode format) live in JSON only.

/**
 * What a speaker offers: a live session (talk, hands-on, workshop, Q&A), a course, or a
 * podcast episode. A session or podcast booking becomes a DRAFT live session (the kind is a
 * label on it); a course booking becomes a DRAFT course, prefilled from the booking (see
 * courseDraftFromBooking), that the team finishes and publishes in Admin → Courses.
 */
export const SPEAKER_KINDS = ['SESSION', 'COURSE', 'PODCAST'] as const;
export type SpeakerKind = (typeof SPEAKER_KINDS)[number];

export const speakerKindLabels: Record<SpeakerKind, { en: string; ar: string }> = {
  SESSION: { en: 'Session', ar: 'جلسة' },
  COURSE: { en: 'Course', ar: 'دورة' },
  PODCAST: { en: 'Podcast', ar: 'بودكاست' },
};

export const DETAIL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export const detailLevelLabels: Record<DetailLevel, { en: string; ar: string }> = {
  BEGINNER: { en: 'Beginner', ar: 'مبتدئ' },
  INTERMEDIATE: { en: 'Intermediate', ar: 'متوسط' },
  ADVANCED: { en: 'Advanced', ar: 'متقدم' },
};

export const EPISODE_FORMATS = ['INTERVIEW', 'PANEL'] as const;
export type EpisodeFormat = (typeof EPISODE_FORMATS)[number];
export const episodeFormatLabels: Record<EpisodeFormat, { en: string; ar: string }> = {
  INTERVIEW: { en: 'Interview', ar: 'مقابلة' },
  PANEL: { en: 'Panel', ar: 'حلقة نقاش' },
};

/** Limits the forms show and the API enforces. */
export const DETAIL_LIMITS = { outcomes: 10, tags: 10, modules: 30, guests: 6, discussion: 15 } as const;

// ------------------------------------------------------------------ helpers

/** Optional text: trimmed, empty becomes undefined (so empty fields are never stored). */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined));

/** A list of short texts: trimmed, empty entries dropped, duplicates removed. */
const textList = (maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().max(maxLength))
    .max(maxItems)
    .nullish()
    .transform((a) => Array.from(new Set((a ?? []).filter(Boolean))));

const optHttpsUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isHttpsUrl(v), { message: 'Use a full https:// link' });

function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch {
    return false;
  }
}

const optLinkedin = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || normalizeLinkedinUrl(v) !== null, { message: LINKEDIN_PROFILE_MESSAGE })
  .transform((v) => (v === undefined ? undefined : normalizeLinkedinUrl(v)!));

/** A number field that may arrive empty from a form. */
const optNumber = (min: number, max: number, int = true) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    (int ? z.coerce.number().int() : z.coerce.number()).min(min).max(max).optional(),
  );

const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(values).optional());

// ------------------------------------------------------------------ schemas

/** Course details: the outline the team builds a course from. */
export const courseDetailsSchema = z.object({
  modulesCount: optNumber(1, 100),
  modules: z
    .array(z.object({ title: z.string().trim().max(120), description: z.string().trim().max(500).default('') }))
    .max(DETAIL_LIMITS.modules)
    .nullish()
    .transform((list) => (list ?? []).filter((m) => m.title || m.description)),
  weeklyHours: optNumber(0.5, 40, false),
  durationWeeks: optNumber(1, 52),
  materialsUrl: optHttpsUrl,
});

/** Podcast details. */
export const podcastDetailsSchema = z.object({
  guests: z
    .array(z.object({ name: z.string().trim().max(120), linkedinUrl: optLinkedin }))
    .max(DETAIL_LIMITS.guests)
    .nullish()
    .transform((list) => (list ?? []).filter((g) => g.name)),
  discussion: textList(DETAIL_LIMITS.discussion, 300),
  episodeFormat: optEnum(EPISODE_FORMATS),
  host: optText(120),
});

/**
 * Optional details of a session, course or podcast. Every field is optional: the speaker
 * fills what they know, and the team completes or edits the rest. Empty fields are dropped,
 * and only the block that matches the kind is kept (see cleanSpeakerDetails).
 */
export const speakerDetailsSchema = z.object({
  audience: optText(500),
  prerequisites: optText(1000),
  outcomes: textList(DETAIL_LIMITS.outcomes, 200),
  level: optEnum(DETAIL_LEVELS),
  language: optEnum(COURSE_LANGUAGES),
  tags: textList(DETAIL_LIMITS.tags, 40),
  course: courseDetailsSchema.nullish(),
  podcast: podcastDetailsSchema.nullish(),
});
export type SpeakerDetailsInput = z.input<typeof speakerDetailsSchema>;
export type SpeakerDetails = z.infer<typeof speakerDetailsSchema>;

/** Stored form: no empty values, and only the block of the chosen kind. */
export type SpeakerDetailsDto = {
  audience?: string;
  prerequisites?: string;
  outcomes?: string[];
  level?: DetailLevel;
  language?: (typeof COURSE_LANGUAGES)[number];
  tags?: string[];
  course?: {
    modulesCount?: number;
    modules?: { title: string; description: string }[];
    weeklyHours?: number;
    durationWeeks?: number;
    materialsUrl?: string;
  };
  podcast?: {
    guests?: { name: string; linkedinUrl?: string }[];
    discussion?: string[];
    episodeFormat?: EpisodeFormat;
    host?: string;
  };
};

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
}

/** Drops empty fields and the blocks that don't match the kind. */
export function cleanSpeakerDetails(kind: SpeakerKind, d: SpeakerDetails | null | undefined): SpeakerDetailsDto {
  if (!d) return {};
  const { course, podcast, ...common } = d;
  const out: SpeakerDetailsDto = compact(common) as SpeakerDetailsDto;
  if (kind === 'COURSE' && course) {
    const c = compact(course);
    if (Object.keys(c).length) out.course = c as SpeakerDetailsDto['course'];
  }
  if (kind === 'PODCAST' && podcast) {
    const p = compact({ ...podcast, guests: podcast.guests.map((g) => compact(g) as { name: string; linkedinUrl?: string }) });
    if (Object.keys(p).length) out.podcast = p as SpeakerDetailsDto['podcast'];
  }
  return out;
}

/** Reads stored JSON back (anything unexpected is dropped rather than trusted). */
export function readSpeakerDetails(kind: SpeakerKind, raw: unknown): SpeakerDetailsDto {
  const parsed = speakerDetailsSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  return parsed.success ? cleanSpeakerDetails(kind, parsed.data) : {};
}

/** True when nothing is filled in. */
export function detailsEmpty(d: SpeakerDetailsDto | null | undefined): boolean {
  return !d || Object.keys(d).length === 0;
}

/**
 * What a LiveEvent stores in its `details` column: the kind (a label on the session) and the
 * details. A session the team made by hand has `{}` (a plain session without details).
 */
export interface EventDetailsDto {
  kind: SpeakerKind;
  details: SpeakerDetailsDto;
}

export function readEventDetails(raw: unknown): EventDetailsDto {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const kind = (SPEAKER_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as SpeakerKind) : 'SESSION';
  return { kind, details: readSpeakerDetails(kind, o.details) };
}

/** The admin session editor's input: the kind and details together. */
export const eventDetailsInputSchema = z.object({
  kind: z.enum(SPEAKER_KINDS).default('SESSION'),
  details: speakerDetailsSchema.default({}),
});
