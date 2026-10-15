import { levelsOf, type CourseLevel, type CourseStatus, type FaqItem, type Included, type LocalizedList, type LocalizedText, type OutlineModule } from '@academy/shared';
import { toLocalInput, type CourseFormValue } from './CourseForm';
import type { QuestionRow, SessionRow } from './CourseTabs';

/** A course as GET /admin/courses/:id (and /teach/courses/:id/details) returns it, and the editor's value from it. */
export interface AdminCourse extends Omit<CourseFormValue, 'targetAudience' | 'notFor' | 'preparation' | 'learningOutcomes' | 'prerequisites' | 'outline' | 'faq' | 'included' | 'endDate'> {
  id: string;
  status: CourseStatus;
  /** The old single level (derived); `levels` is what the form edits. */
  level: CourseLevel;
  endDate: string | null;
  /** "import" when the archive import created it. */
  source: string | null;
  targetAudience: LocalizedText;
  notFor: LocalizedText;
  preparation?: LocalizedText;
  learningOutcomes: LocalizedList;
  prerequisites: LocalizedList;
  outline: OutlineModule[];
  faq: FaqItem[];
  included: Included;
  questions: QuestionRow[];
  sessions: SessionRow[];
}

export function toForm(c: AdminCourse): CourseFormValue {
  return {
    slug: c.slug,
    titleEn: c.titleEn,
    titleAr: c.titleAr,
    shortDescriptionEn: c.shortDescriptionEn,
    shortDescriptionAr: c.shortDescriptionAr,
    longDescriptionEn: c.longDescriptionEn,
    longDescriptionAr: c.longDescriptionAr,
    type: c.type,
    price: c.price,
    currency: c.currency,
    requiresApproval: c.requiresApproval,
    capacity: c.capacity,
    status: c.status,
    // An API from before levels sends only the single level.
    levels: levelsOf(c),
    levelProgression: c.levelProgression ?? false,
    language: c.language,
    startDate: toLocalInput(c.startDate),
    applicationsOpenAt: toLocalInput(c.applicationsOpenAt),
    applicationDeadline: toLocalInput(c.applicationDeadline),
    durationWeeks: c.durationWeeks,
    hoursPerWeek: c.hoursPerWeek,
    coverImageUrl: c.coverImageUrl,
    targetAudience: c.targetAudience,
    notFor: c.notFor,
    preparation: c.preparation ?? { en: '', ar: '' },
    learningOutcomes: c.learningOutcomes,
    prerequisites: c.prerequisites,
    outline: c.outline,
    faq: c.faq,
    included: c.included,
    deliveryPlatform: c.deliveryPlatform,
    recordingsPlatform: c.recordingsPlatform,
    driveFolderUrl: c.driveFolderUrl,
    youtubePlaylistUrl: c.youtubePlaylistUrl,
    instructorIds: c.instructorIds,
    // Kept as they are on save, so editing a past cohort can't hide its recordings by accident.
    topics: c.topics ?? [],
    cohortNumber: c.cohortNumber ?? null,
    endDate: toLocalInput(c.endDate),
    externalPlatform: c.externalPlatform ?? null,
    externalUrl: c.externalUrl ?? null,
    publicRecordings: c.publicRecordings ?? false,
  };
}

