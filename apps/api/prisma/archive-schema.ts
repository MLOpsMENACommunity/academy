import {
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  DELIVERY_PLATFORMS,
  faqItemSchema,
  includedSchema,
  localizedListSchema,
  localizedTextSchema,
  outlineModuleSchema,
  RECORDINGS_PLATFORMS,
  RESERVED_EVENT_SLUGS,
  topicsSchema,
} from '@academy/shared';
import { z } from 'zod';

/**
 * The archive file format: prisma/archive/*.json, imported by import-archive.ts on every
 * container start. Adding history is adding entries to a file (or a new file) in prisma/archive/.
 *
 * Only `slug` and the English title are required everywhere. Arabic left empty falls back
 * to English on the site.
 */
export const ARCHIVE_FORMAT_VERSION = 1;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes only').max(80);
const url = z.string().url().regex(/^https?:\/\//i, 'Must be an http(s) URL');
/** ISO 8601 with an offset or Z, e.g. "2026-08-22T20:00:00+03:00": no guessing about time zones. */
/** A real calendar date: Date.parse alone rolls "2026-08-37" over to September. */
const realDate = (s: string) => {
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return !Number.isNaN(d.getTime()) && Number(s.slice(8, 10)) <= new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)).getUTCDate();
};
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, 'ISO date-time with an offset')
  .refine(realDate, 'Not a real date');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine(realDate, 'Not a real date');
/** A photo: http(s), or a file under apps/web/public (e.g. "/speakers/aya-nasser-salama.webp"). */
const image = z.string().regex(/^(https?:\/\/\S+|\/(?!\/)[\w./-]+)$/, 'http(s) URL or /path');

export const archiveSpeakerSchema = z.object({
  slug,
  name: z.string().min(2).max(120),
  nameAr: z.string().max(120).optional(),
  titleEn: z.string().min(2).max(160),
  titleAr: z.string().max(160).optional(),
  bioEn: z.string().max(4000).default(''),
  bioAr: z.string().max(4000).optional(),
  photoUrl: image.optional(),
  linkedinUrl: url.optional(),
  githubUrl: url.optional(),
});

export const archiveSessionSchema = z.object({
  slug: slug.refine((s) => !(RESERVED_EVENT_SLUGS as readonly string[]).includes(s), 'Reserved slug'),
  titleEn: z.string().min(2).max(160),
  titleAr: z.string().max(160).default(''),
  /** Markdown. */
  descriptionEn: z.string().max(20_000).default(''),
  descriptionAr: z.string().max(20_000).default(''),
  /** A speaker slug from any archive file (or one an admin created): links the session to their page. */
  speaker: slug.optional(),
  /** A one-off speaker without a page. Ignored when `speaker` is set. */
  speakerName: z.string().max(120).optional(),
  speakerNameAr: z.string().max(120).optional(),
  speakerTitleEn: z.string().max(160).optional(),
  speakerTitleAr: z.string().max(160).optional(),
  speakerLinkedinUrl: url.optional(),
  startsAt: instant,
  durationMin: z.number().int().min(15).max(600).default(90),
  language: z.enum(COURSE_LANGUAGES).default('BILINGUAL'),
  platform: z.enum(DELIVERY_PLATFORMS).default('YOUTUBE_LIVE'),
  topics: topicsSchema.default([]),
  recordingUrl: url.optional(),
  /** Upcoming sessions only. Without one, an upcoming session is imported as a draft for an admin to finish. */
  liveUrl: url.optional(),
  capacity: z.number().int().min(1).optional(),
  status: z.enum(['PUBLISHED', 'DRAFT']).optional(),
});

export const archiveCourseSessionSchema = z.object({
  titleEn: z.string().min(2).max(200),
  titleAr: z.string().max(200).default(''),
  descriptionEn: z.string().max(2000).optional(),
  descriptionAr: z.string().max(2000).optional(),
  startsAt: instant,
  durationMin: z.number().int().min(15).max(600).default(90),
  topics: topicsSchema.default([]),
  recordingUrl: url.optional(),
});

export const archiveCourseSchema = z.object({
  slug,
  titleEn: z.string().min(2).max(160),
  titleAr: z.string().min(2).max(160),
  shortDescriptionEn: z.string().min(10).max(400),
  shortDescriptionAr: z.string().min(10).max(400),
  /** Markdown. */
  longDescriptionEn: z.string().max(20_000).default(''),
  longDescriptionAr: z.string().max(20_000).default(''),
  /** COMPLETED: a past cohort (recordings public). COMING_SOON: announced, no dates yet. */
  status: z.enum(['COMPLETED', 'COMING_SOON', 'CLOSED']),
  type: z.enum(['FREE', 'PAID']).default('FREE'),
  price: z.number().int().min(0).default(0),
  currency: z.string().length(3).default('EGP'),
  level: z.enum(COURSE_LEVELS).default('ALL_LEVELS'),
  language: z.enum(COURSE_LANGUAGES).default('BILINGUAL'),
  cohortNumber: z.number().int().min(1).optional(),
  startDate: day.optional(),
  endDate: day.optional(),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  hoursPerWeek: z.number().int().min(1).max(60).optional(),
  /** Where the cohort ran when it wasn't on the academy, e.g. "zomra.io". */
  externalPlatform: z.string().max(80).optional(),
  externalUrl: url.optional(),
  /** Session recordings shown to everyone. Defaults to true for COMPLETED courses. */
  publicRecordings: z.boolean().optional(),
  deliveryPlatform: z.enum(DELIVERY_PLATFORMS).default('YOUTUBE_LIVE'),
  recordingsPlatform: z.enum(RECORDINGS_PLATFORMS).default('YOUTUBE'),
  youtubePlaylistUrl: url.optional(),
  topics: topicsSchema.default([]),
  /** Speaker slugs, in display order. */
  instructors: z.array(slug).default([]),
  targetAudience: localizedTextSchema.default({ en: '', ar: '' }),
  notFor: localizedTextSchema.default({ en: '', ar: '' }),
  learningOutcomes: localizedListSchema.default({ en: [], ar: [] }),
  prerequisites: localizedListSchema.default({ en: [], ar: [] }),
  outline: z.array(outlineModuleSchema).default([]),
  faq: z.array(faqItemSchema).default([]),
  included: includedSchema.default({ liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false }),
  /** Lessons in order (their number is their position). */
  sessions: z.array(archiveCourseSessionSchema).default([]),
}).refine((c) => !c.publicRecordings || (c.type === 'FREE' && c.recordingsPlatform === 'YOUTUBE'), {
  message: 'Only free courses with YouTube recordings can make them public',
  path: ['publicRecordings'],
});

export const archiveFileSchema = z.object({
  version: z.literal(ARCHIVE_FORMAT_VERSION),
  /** Free text: where these entries came from. */
  source: z.string().optional(),
  speakers: z.array(archiveSpeakerSchema).default([]),
  sessions: z.array(archiveSessionSchema).default([]),
  courses: z.array(archiveCourseSchema).default([]),
});

export type ArchiveSpeaker = z.infer<typeof archiveSpeakerSchema>;
export type ArchiveSession = z.infer<typeof archiveSessionSchema>;
export type ArchiveCourse = z.infer<typeof archiveCourseSchema>;
export type ArchiveFile = z.infer<typeof archiveFileSchema>;
/** What a file looks like before defaults are applied (what the converter writes). */
export type ArchiveFileInput = z.input<typeof archiveFileSchema>;

export interface Archive {
  speakers: ArchiveSpeaker[];
  sessions: ArchiveSession[];
  courses: ArchiveCourse[];
}

/** Validates and merges several files; a slug may appear only once per kind across all of them. */
export function parseArchive(files: { name: string; data: unknown }[]): Archive {
  const out: Archive = { speakers: [], sessions: [], courses: [] };
  for (const f of files) {
    const r = archiveFileSchema.safeParse(f.data);
    if (!r.success) {
      const issues = r.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`);
      throw new Error(`${f.name} is not a valid archive file:\n${issues.join('\n')}`);
    }
    out.speakers.push(...r.data.speakers);
    out.sessions.push(...r.data.sessions);
    out.courses.push(...r.data.courses);
  }
  for (const kind of ['speakers', 'sessions', 'courses'] as const) {
    const seen = new Set<string>();
    for (const e of out[kind]) {
      if (seen.has(e.slug)) throw new Error(`Duplicate ${kind.slice(0, -1)} slug in the archive: ${e.slug}`);
      seen.add(e.slug);
    }
  }
  return out;
}
