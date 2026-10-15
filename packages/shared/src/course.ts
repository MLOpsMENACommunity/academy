import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  AUDIENCE_LEVELS,
  COURSE_LANGUAGES,
  COURSE_TYPES,
  type ApplicationStatus,
  type AudienceLevel,
  type CourseAvailability,
  type CourseLanguage,
  type CourseLevel,
  type CourseStatus,
  type CourseType,
  type DeliveryPlatform,
  type QuestionType,
  type RecordingsPlatform,
} from './enums';
import type { FaqItem, Included, LocalizedList, LocalizedText, OutlineModule, QuestionOption } from './course-content';
import { audienceLevelLabels } from './labels';
import type { PublicStaffGroupDto } from './course-staff';

// ------------------------------------------------------------------ levels

/** Distinct levels in their natural order (Junior → Lead). */
export function sortLevels(levels: readonly AudienceLevel[]): AudienceLevel[] {
  return AUDIENCE_LEVELS.filter((l) => levels.includes(l));
}

/** A course's levels: any of Junior, Mid, Senior, Lead (none means all levels). Stored in order. */
export const audienceLevelsSchema = z.array(z.enum(AUDIENCE_LEVELS)).max(AUDIENCE_LEVELS.length).transform(sortLevels);

/** What the single level a course had before `levels` means in levels (ALL_LEVELS: none, i.e. everyone). */
export function levelsFromLegacy(level: CourseLevel): AudienceLevel[] {
  return { BEGINNER: ['JUNIOR'], INTERMEDIATE: ['MID'], ADVANCED: ['SENIOR'], ALL_LEVELS: [] }[level] as AudienceLevel[];
}

/**
 * The old single `level`, for API clients that still read it: kept in step with `levels`
 * on every save. Mirrors levelsFromLegacy, so old values survive a round trip.
 */
export function legacyCourseLevel(levels: readonly AudienceLevel[]): CourseLevel {
  const ls = sortLevels(levels);
  if (ls.length === 0 || ls.length === AUDIENCE_LEVELS.length) return 'ALL_LEVELS';
  if (ls.every((l) => l === 'JUNIOR')) return 'BEGINNER';
  if (ls.every((l) => l === 'SENIOR' || l === 'LEAD')) return 'ADVANCED';
  return 'INTERMEDIATE';
}

/** A course's levels as any API version sent them (`levels`, or only the old `level`). */
export type CourseLevelsOf = { levels?: readonly AudienceLevel[] | null; level?: CourseLevel; levelProgression?: boolean };

export function levelsOf(c: CourseLevelsOf): AudienceLevel[] {
  if (c.levels) return sortLevels(c.levels);
  return c.level ? levelsFromLegacy(c.level) : [];
}

const ALL_LEVELS_LABEL = { en: 'All levels', ar: 'جميع المستويات' } as const;

/**
 * "Junior · Mid", or, for a course that moves people up a level (`levelProgression`),
 * "Mid to Senior · Senior to Lead". No levels: "All levels".
 */
export function courseLevelsText(c: CourseLevelsOf, locale: 'en' | 'ar'): string {
  const ls = levelsOf(c);
  if (ls.length === 0) return ALL_LEVELS_LABEL[locale];
  const label = (l: AudienceLevel) => audienceLevelLabels[l][locale];
  return ls
    .map((l) => {
      const next = AUDIENCE_LEVELS[AUDIENCE_LEVELS.indexOf(l) + 1];
      if (!c.levelProgression || !next) return label(l);
      return locale === 'ar' ? `من ${label(l)} إلى ${label(next)}` : `${label(l)} to ${label(next)}`;
    })
    .join(' · ');
}

/** Catalog filter: open (accepting applications), upcoming (opens later), closed. */
export function courseAvailability(
  c: { status: CourseStatus; applicationsOpenAt: Date | string | null; applicationDeadline: Date | string | null },
  now = new Date(),
): CourseAvailability {
  if (c.status === 'COMING_SOON') return 'UPCOMING';
  if (c.status !== 'OPEN') return 'CLOSED';
  if (c.applicationsOpenAt && new Date(c.applicationsOpenAt) > now) return 'UPCOMING';
  if (c.applicationDeadline && new Date(c.applicationDeadline) < now) return 'CLOSED';
  return 'OPEN';
}

/**
 * The catalog's price filter: free, paid with a price, or paid with the price not announced
 * yet (a "coming soon" course). A course without a price is never counted as "Paid".
 */
export const CATALOG_PRICES = [...COURSE_TYPES, 'TBA'] as const;
export type CatalogPrice = (typeof CATALOG_PRICES)[number];

export function catalogPrice(c: { type: CourseType; price: number }): CatalogPrice {
  if (c.type === 'FREE') return 'FREE';
  return c.price > 0 ? 'PAID' : 'TBA';
}

/** Links from before course levels were Junior/Mid/Senior/Lead (?level=INTERMEDIATE) still filter sensibly. */
const LEGACY_LEVEL_QUERY: Record<string, AudienceLevel | undefined> = {
  BEGINNER: 'JUNIOR',
  INTERMEDIATE: 'MID',
  ADVANCED: 'SENIOR',
  ALL_LEVELS: undefined,
};

export const catalogQuerySchema = z.object({
  /** Matches a course when it is one of the course's levels (or the course is for all levels). */
  level: z
    .preprocess((v) => (typeof v === 'string' && v in LEGACY_LEVEL_QUERY ? LEGACY_LEVEL_QUERY[v] : v), z.enum(AUDIENCE_LEVELS).optional()),
  type: z.enum(CATALOG_PRICES).optional(),
  language: z.enum(COURSE_LANGUAGES).optional(),
  availability: z.enum(['OPEN', 'UPCOMING', 'CLOSED']).optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** The fields of a course the catalog filters on. */
export interface CatalogFacets {
  levels: AudienceLevel[];
  type: CourseType;
  price: number;
  language: CourseLanguage;
  availability: CourseAvailability;
}

/**
 * One matcher for the API (?level=&type=&language=&availability=) and the static catalog page.
 * English or Arabic also matches bilingual courses (they're taught in both); "Arabic & English"
 * matches bilingual courses only.
 */
export function matchesCatalog(c: CatalogFacets, q: CatalogQuery): boolean {
  // Any of the course's levels; a course for all levels (none set) matches every level.
  if (q.level && c.levels.length > 0 && !c.levels.includes(q.level)) return false;
  if (q.type && catalogPrice(c) !== q.type) return false;
  if (
    q.language &&
    c.language !== q.language &&
    !(c.language === 'BILINGUAL' && q.language !== 'BILINGUAL')
  )
    return false;
  if (q.availability && c.availability !== q.availability) return false;
  return true;
}

export interface InstructorDto {
  id: string;
  /** Public page /speakers/{slug}; null for an instructor without one yet. */
  slug: string | null;
  name: string;
  nameAr: string | null;
  titleEn: string;
  titleAr: string | null;
  bioEn: string;
  bioAr: string | null;
  photoUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
}

export interface CourseSummaryDto {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  type: CourseType;
  price: number;
  currency: string;
  /** Deprecated: the old single level, derived from `levels` (kept for older clients). */
  level: CourseLevel;
  /** Who the course is for, Junior → Lead; empty means all levels. */
  levels: AudienceLevel[];
  /** Shown as steps up ("Mid to Senior · Senior to Lead") rather than a list (see courseLevelsText). */
  levelProgression: boolean;
  language: CourseLanguage;
  startDate: string | null;
  applicationDeadline: string | null;
  durationWeeks: number | null;
  hoursPerWeek: number | null;
  coverImageUrl: string | null;
  availability: CourseAvailability;
  /** Null when the course has no capacity limit. */
  seatsRemaining: number | null;
  instructorNames: string[];
  /** A past cohort kept public (status COMPLETED): no applications, recordings instead. */
  completed: boolean;
  /**
   * Announced, not open yet (status COMING_SOON): its details (dates, format, language,
   * certificate) aren't decided, so pages say "Will be announced soon" for them.
   */
  comingSoon: boolean;
  cohortNumber: number | null;
  endDate: string | null;
  topics: string[];
}

/** Public schedule entry: never includes live links or materials. */
export interface PublicSessionDto {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  /** Topics; public. Live links and materials are never included. */
  descriptionEn: string | null;
  descriptionAr: string | null;
  startsAt: string;
  durationMin: number;
  topics: string[];
  /** Only for courses with public recordings (see Course.publicRecordings), once the session has ended. */
  recordingUrl: string | null;
}

export interface ScreeningQuestionDto {
  id: string;
  type: QuestionType;
  labelEn: string;
  labelAr: string;
  helpEn: string | null;
  helpAr: string | null;
  options: QuestionOption[] | null;
  required: boolean;
  order: number;
}

export interface CourseDetailDto extends CourseSummaryDto {
  longDescriptionEn: string;
  longDescriptionAr: string;
  requiresApproval: boolean;
  capacity: number | null;
  applicationsOpenAt: string | null;
  targetAudience: LocalizedText;
  notFor: LocalizedText;
  /** Markdown: what to do before the course starts (shown after the prerequisites). */
  preparation: LocalizedText;
  learningOutcomes: LocalizedList;
  prerequisites: LocalizedList;
  outline: OutlineModule[];
  faq: FaqItem[];
  included: Included;
  deliveryPlatform: DeliveryPlatform;
  recordingsPlatform: RecordingsPlatform;
  /** Set when the cohort ran on another platform, e.g. "zomra.io". */
  externalPlatform: string | null;
  externalUrl: string | null;
  publicRecordings: boolean;
  /** The course's instructors (Main and Co-instructor roles with a public speaker profile, SHOWN only). */
  instructors: InstructorDto[];
  /** Everyone in a SHOWN course role, grouped by role, Main instructor first. Never anonymous staff or emails. */
  staff: PublicStaffGroupDto[];
  sessions: PublicSessionDto[];
  screeningQuestions: ScreeningQuestionDto[];
  updatedAt: string;
}

export interface MyCourseStatusDto {
  applicationId: string | null;
  status: ApplicationStatus | null;
  enrolled: boolean;
  /** On the course's waiting list (hears when it opens). */
  interested: boolean;
}

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
