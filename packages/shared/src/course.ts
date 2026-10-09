import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  COURSE_TYPES,
  type ApplicationStatus,
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

export const catalogQuerySchema = z.object({
  level: z.enum(COURSE_LEVELS).optional(),
  type: z.enum(COURSE_TYPES).optional(),
  language: z.enum(COURSE_LANGUAGES).optional(),
  availability: z.enum(['OPEN', 'UPCOMING', 'CLOSED']).optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

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
  level: CourseLevel;
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
  instructors: InstructorDto[];
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
