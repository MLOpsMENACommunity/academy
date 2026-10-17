import {
  courseAvailability,
  eventEnded,
  type CourseDetailDto,
  type CourseSummaryDto,
  type FaqItem,
  type Included,
  type InstructorDto,
  type LocalizedList,
  type LocalizedText,
  type OutlineModule,
  type PublicStaffGroupDto,
  type QuestionOption,
} from '@academy/shared';
import type { Course, CourseSession, Instructor, ScreeningQuestion } from '@prisma/client';

export type CourseWithRelations = Course & {
  instructors: { instructor: Instructor; order: number }[];
  sessions?: CourseSession[];
  screeningQuestions?: ScreeningQuestion[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toInstructorDto(i: Instructor): InstructorDto {
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    nameAr: i.nameAr,
    titleEn: i.titleEn,
    titleAr: i.titleAr,
    bioEn: i.bioEn,
    bioAr: i.bioAr,
    photoUrl: i.photoUrl,
    linkedinUrl: i.linkedinUrl,
    githubUrl: i.githubUrl,
  };
}

/** What CoursesService.seatCounts counts per course (deleted accounts never count). */
export interface SeatCount {
  /** Seats held: seat-holding applications (shortlisted through enrolled). */
  taken: number;
  /** Active enrolments. */
  enrolled: number;
}

export const NO_SEATS: SeatCount = { taken: 0, enrolled: 0 };

/**
 * Public shapes are built field by field (an allowlist), so private columns
 * such as driveFolderUrl, liveUrl and recordingUrl can never leak by accident.
 * Enrolment is public only as a number (never who), and only when the course shows it.
 */
export function toCourseSummary(c: CourseWithRelations, seats: SeatCount, now = new Date()): CourseSummaryDto {
  const instructors = [...c.instructors].sort((a, b) => a.order - b.order);
  const availability = courseAvailability(c, now);
  const seatsRemaining = c.capacity === null ? null : Math.max(0, c.capacity - seats.taken);
  return {
    id: c.id,
    slug: c.slug,
    titleEn: c.titleEn,
    titleAr: c.titleAr,
    shortDescriptionEn: c.shortDescriptionEn,
    shortDescriptionAr: c.shortDescriptionAr,
    type: c.type,
    price: c.price,
    currency: c.currency,
    level: c.level,
    levels: c.levels,
    levelProgression: c.levelProgression,
    language: c.language,
    startDate: iso(c.startDate),
    applicationDeadline: iso(c.applicationDeadline),
    durationWeeks: c.durationWeeks,
    hoursPerWeek: c.hoursPerWeek,
    coverImageUrl: c.coverImageUrl,
    availability,
    seatsRemaining,
    enrolledCount: c.showEnrolledCount ? seats.enrolled : null,
    // "X seats left" is only worth saying while people can apply.
    seatsLeft: availability === 'OPEN' ? seatsRemaining : null,
    instructorNames: instructors.map((x) => x.instructor.name),
    completed: c.status === 'COMPLETED',
    comingSoon: c.status === 'COMING_SOON',
    cohortNumber: c.cohortNumber,
    endDate: iso(c.endDate),
    topics: c.topics,
  };
}

/**
 * Recordings are enrolled-only unless the course says otherwise (a completed cohort whose
 * lessons are public on YouTube), and only once the lesson is over.
 */
export function publicRecording(
  c: Pick<Course, 'publicRecordings' | 'type'>,
  s: Pick<CourseSession, 'recordingUrl' | 'startsAt' | 'durationMin'>,
  now = new Date(),
) {
  // Belt and braces: the admin form only allows public recordings on free courses.
  return c.publicRecordings && c.type === 'FREE' && s.recordingUrl && eventEnded(s.startsAt, s.durationMin, now) ? s.recordingUrl : null;
}

export function toCourseDetail(c: CourseWithRelations, seats: SeatCount, now = new Date(), staff: PublicStaffGroupDto[] = []): CourseDetailDto {
  return {
    ...toCourseSummary(c, seats, now),
    longDescriptionEn: c.longDescriptionEn,
    longDescriptionAr: c.longDescriptionAr,
    requiresApproval: c.requiresApproval,
    capacity: c.capacity,
    applicationsOpenAt: iso(c.applicationsOpenAt),
    targetAudience: c.targetAudience as LocalizedText,
    notFor: c.notFor as LocalizedText,
    preparation: c.preparation as LocalizedText,
    learningOutcomes: c.learningOutcomes as LocalizedList,
    prerequisites: c.prerequisites as LocalizedList,
    outline: c.outline as OutlineModule[],
    faq: c.faq as FaqItem[],
    included: c.included as Included,
    deliveryPlatform: c.deliveryPlatform,
    recordingsPlatform: c.recordingsPlatform,
    externalPlatform: c.externalPlatform,
    externalUrl: c.externalUrl,
    publicRecordings: c.publicRecordings && c.type === 'FREE',
    instructors: [...c.instructors].sort((a, b) => a.order - b.order).map((x) => toInstructorDto(x.instructor)),
    staff,
    sessions: [...(c.sessions ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        order: s.order,
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        descriptionEn: s.descriptionEn,
        descriptionAr: s.descriptionAr,
        startsAt: s.startsAt.toISOString(),
        durationMin: s.durationMin,
        topics: s.topics,
        recordingUrl: publicRecording(c, s, now),
      })),
    screeningQuestions: [...(c.screeningQuestions ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({
        id: q.id,
        type: q.type,
        labelEn: q.labelEn,
        labelAr: q.labelAr,
        helpEn: q.helpEn,
        helpAr: q.helpAr,
        options: (q.options as QuestionOption[] | null) ?? null,
        required: q.required,
        order: q.order,
      })),
    updatedAt: c.updatedAt.toISOString(),
  };
}
