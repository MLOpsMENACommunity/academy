import { z } from 'zod';
import { topicsSchema } from './archive';
import {
  APPLICATION_STATUSES,
  AREAS,
  CLOUD_PLATFORMS,
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  COURSE_STATUSES,
  COURSE_TYPES,
  DELIVERY_PLATFORMS,
  EDUCATION_LEVELS,
  EMPLOYMENT_STATUSES,
  EXPERIENCE_RANGES,
  QUESTION_TYPES,
  RECORDINGS_PLATFORMS,
  SAVED_FILTER_SCOPES,
  SENIORITIES,
  SKILLS,
  TOPICS,
  WEEKLY_HOURS,
} from './enums';
import { ALL_COUNTRIES } from './countries';
import { faqItemSchema, includedSchema, localizedListSchema, localizedTextSchema, materialSchema, outlineModuleSchema, questionOptionSchema } from './course-content';
import { ADMIN_APPLICATION_EVENTS } from './state-machine';

// ------------------------------------------------------------------ filters

/** Query-string list: "a,b" or repeated params → string[]. */
const list = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean)))
    .pipe(z.array(z.enum(values)).max(values.length).optional());

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

/** "KUBERNETES:3,PYTHON:4" → [{ skill, min }]. */
const skillMins = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [skill, min] = p.split(':');
        return { skill, min: Number(min) };
      }),
  )
  .pipe(z.array(z.object({ skill: z.enum(SKILLS), min: z.number().int().min(1).max(5) })).max(SKILLS.length));

/** Profile-based filters shared by the applications table and the students directory. */
export const profileFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  country: list(ALL_COUNTRIES),
  /** Minimum range (ordered enums: Y0_1 < … < Y10_PLUS). */
  experienceMin: z.enum(EXPERIENCE_RANGES).optional(),
  mlExperienceMin: z.enum(EXPERIENCE_RANGES).optional(),
  seniority: list(SENIORITIES),
  primaryArea: list(AREAS),
  /** Matches if any of these is among the student's secondary areas. */
  secondaryArea: list(AREAS),
  employmentStatus: list(EMPLOYMENT_STATUSES),
  educationLevel: list(EDUCATION_LEVELS),
  skills: skillMins,
  cloud: list(CLOUD_PLATFORMS),
  weeklyHoursMin: z.enum(WEEKLY_HOURS).optional(),
  topic: list(TOPICS),
  openToOpportunities: bool,
  shareWithPartners: bool,
});
export type ProfileFilter = z.infer<typeof profileFilterSchema>;

export const APPLICATION_SORTS = ['newest', 'oldest', 'name', 'experience'] as const;

export const applicationFilterSchema = profileFilterSchema.extend({
  courseId: z.string().max(40).optional(),
  status: list(APPLICATION_STATUSES),
  ref: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(APPLICATION_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type ApplicationFilter = z.infer<typeof applicationFilterSchema>;

export const studentFilterSchema = profileFilterSchema.extend({
  sort: z.enum(['newest', 'oldest', 'name', 'experience']).default('newest'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type StudentFilter = z.infer<typeof studentFilterSchema>;

export const bulkTransitionSchema = z.object({
  // One page of results at most (pageSize ≤ 200), so a bulk request stays short.
  ids: z.array(z.string().min(1).max(40)).min(1).max(200),
  event: z.enum(ADMIN_APPLICATION_EVENTS),
  reason: z.string().trim().max(1000).optional(),
});

export const adminNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const savedFilterSchema = z.object({
  scope: z.enum(SAVED_FILTER_SCOPES),
  name: z.string().trim().min(1).max(80),
  /** The query string of the filtered view, e.g. "country=EG,SA&experienceMin=Y5_10". */
  query: z.string().max(2000),
});

export const driveAccessSchema = z.object({ granted: z.boolean() });

// ------------------------------------------------------------------ course editing

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes only')
  .max(80);
/** Links students click: http(s) only (no javascript:, data:, …). */
const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .regex(/^https?:\/\//i, 'Must be an http(s) URL')
  .nullish()
  .or(z.literal('').transform(() => null));
const optionalDate = z.coerce.date().nullish().or(z.literal('').transform(() => null));
/** A photo: an http(s) URL, or a file the site serves itself (e.g. /speakers/name.webp). */
const optionalImage = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https?:\/\/[^\s]+|\/(?!\/)[\w./-]+)$/i, 'Must be an http(s) URL or a /path on this site')
  .nullish()
  .or(z.literal('').transform(() => null));

export const courseInputSchema = z
  .object({
    slug,
    titleEn: z.string().trim().min(2).max(160),
    // Arabic can wait while the course is a draft; it's required before it goes public (see below).
    titleAr: z.string().trim().max(160),
    shortDescriptionEn: z.string().trim().min(10).max(400),
    shortDescriptionAr: z.string().trim().max(400),
    longDescriptionEn: z.string().trim().max(20_000),
    longDescriptionAr: z.string().trim().max(20_000),
    type: z.enum(COURSE_TYPES),
    price: z.coerce.number().int().min(0).max(1_000_000),
    currency: z.string().trim().length(3).toUpperCase().default('EGP'),
    requiresApproval: z.boolean(),
    capacity: z.coerce.number().int().min(1).max(100_000).nullish().or(z.literal('').transform(() => null)),
    status: z.enum(COURSE_STATUSES),
    level: z.enum(COURSE_LEVELS),
    language: z.enum(COURSE_LANGUAGES),
    startDate: optionalDate,
    applicationsOpenAt: optionalDate,
    applicationDeadline: optionalDate,
    durationWeeks: z.coerce.number().int().min(1).max(104).nullish().or(z.literal('').transform(() => null)),
    hoursPerWeek: z.coerce.number().int().min(1).max(60).nullish().or(z.literal('').transform(() => null)),
    coverImageUrl: optionalUrl,
    targetAudience: localizedTextSchema,
    notFor: localizedTextSchema,
    preparation: z.object({ en: z.string().trim().max(10_000), ar: z.string().trim().max(10_000) }).default({ en: '', ar: '' }),
    learningOutcomes: localizedListSchema,
    prerequisites: localizedListSchema,
    outline: z.array(outlineModuleSchema).max(50),
    faq: z.array(faqItemSchema).max(50),
    included: includedSchema,
    deliveryPlatform: z.enum(DELIVERY_PLATFORMS),
    recordingsPlatform: z.enum(RECORDINGS_PLATFORMS),
    driveFolderUrl: optionalUrl,
    youtubePlaylistUrl: optionalUrl,
    instructorIds: z.array(z.string().min(1).max(40)).max(10).default([]),
    topics: topicsSchema.default([]),
    cohortNumber: z.coerce.number().int().min(1).max(999).nullish().or(z.literal('').transform(() => null)),
    endDate: optionalDate,
    externalPlatform: z.string().trim().max(80).nullish().or(z.literal('').transform(() => null)),
    externalUrl: optionalUrl,
    publicRecordings: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.status !== 'DRAFT' && c.status !== 'ARCHIVED') {
      if (c.titleAr.length < 2) ctx.addIssue({ code: 'custom', path: ['titleAr'], message: 'Arabic title is required to publish' });
      if (c.shortDescriptionAr.length < 10) {
        ctx.addIssue({ code: 'custom', path: ['shortDescriptionAr'], message: 'Arabic description is required to publish' });
      }
    }
    // Paid courses need a price while applications are open; other statuses can wait or no longer need it.
    if (c.type === 'PAID' && c.price <= 0 && c.status === 'OPEN') ctx.addIssue({ code: 'custom', path: ['price'], message: 'Paid courses need a price' });
    if (c.type === 'FREE' && c.price !== 0) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Free courses have price 0' });
    // Recordings are enrolled-only; only a free course with YouTube recordings may show them to everyone.
    if (c.publicRecordings && (c.type !== 'FREE' || c.recordingsPlatform !== 'YOUTUBE')) {
      ctx.addIssue({ code: 'custom', path: ['publicRecordings'], message: 'Only free courses with YouTube recordings can make them public' });
    }
    if (c.driveFolderUrl && !/^https:\/\/drive\.google\.com\//.test(c.driveFolderUrl)) {
      ctx.addIssue({ code: 'custom', path: ['driveFolderUrl'], message: 'Must be a drive.google.com link' });
    }
  });
export type CourseInput = z.infer<typeof courseInputSchema>;

export const questionInputSchema = z
  .object({
    id: z.string().max(40).optional(),
    type: z.enum(QUESTION_TYPES),
    labelEn: z.string().trim().min(2).max(300),
    labelAr: z.string().trim().min(2).max(300),
    helpEn: z.string().trim().max(500).nullish(),
    helpAr: z.string().trim().max(500).nullish(),
    options: z.array(questionOptionSchema).max(30).nullish(),
    required: z.boolean(),
  })
  .superRefine((q, ctx) => {
    const needs = q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT';
    if (needs && (q.options?.length ?? 0) < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two options' });
    if (needs && new Set(q.options!.map((o) => o.value)).size !== q.options!.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option values must be unique' });
    }
  });
export const questionsInputSchema = z.object({ questions: z.array(questionInputSchema).max(40) });
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const sessionInputSchema = z.object({
  titleEn: z.string().trim().min(2).max(200),
  titleAr: z.string().trim().min(2).max(200),
  descriptionEn: z.string().trim().max(2000).nullish(),
  descriptionAr: z.string().trim().max(2000).nullish(),
  startsAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(15).max(600),
  liveUrl: optionalUrl,
  recordingUrl: optionalUrl,
  assignmentUrl: optionalUrl,
  materials: z.array(materialSchema).max(20).default([]),
  topics: topicsSchema.default([]),
});
export type SessionInput = z.infer<typeof sessionInputSchema>;
/** Create several sessions at once (e.g. "every Sunday for 6 weeks"). */
export const sessionsBulkSchema = z.object({ sessions: z.array(sessionInputSchema).min(1).max(52) });
export const duplicateCourseSchema = z.object({ slug, titleEn: z.string().trim().min(2).max(160) });
/** A message to a course's students: email + in-app notification. Arabic falls back to English. */
export const announcementSchema = z.object({
  subjectEn: z.string().trim().min(2).max(150),
  subjectAr: z.string().trim().max(150).default(''),
  bodyEn: z.string().trim().min(2).max(5000),
  bodyAr: z.string().trim().max(5000).default(''),
  statuses: z.array(z.enum(APPLICATION_STATUSES)).min(1).max(APPLICATION_STATUSES.length).default(['ENROLLED']),
  /** Generated by the client per send: a retried request can't send twice. */
  idempotencyKey: z.string().regex(/^[\w-]{16,64}$/),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export const announcementAudienceSchema = z.object({ statuses: list(APPLICATION_STATUSES).pipe(z.array(z.enum(APPLICATION_STATUSES)).min(1)) });

export const sessionOrderSchema = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(200) });

/** An instructor or speaker (one person, public page at /speakers/{slug}). */
export const instructorInputSchema = z.object({
  /** Generated from the name when left empty. */
  slug: slug.nullish().or(z.literal('').transform(() => null)),
  name: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().max(120).nullish(),
  titleEn: z.string().trim().min(2).max(160),
  titleAr: z.string().trim().max(160).nullish(),
  // Speakers of a single talk often have no bio yet: the page then shows name, title and sessions.
  bioEn: z.string().trim().max(4000).default(''),
  bioAr: z.string().trim().max(4000).nullish(),
  photoUrl: optionalImage,
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
});
export type InstructorInput = z.infer<typeof instructorInputSchema>;

// ------------------------------------------------------------------ CSV

/** One CSV cell, quoted, with spreadsheet formula injection neutralised. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (Arabic names) correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
