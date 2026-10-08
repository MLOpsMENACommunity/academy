import {
  courseAvailability,
  type CourseDetailDto,
  type CourseSummaryDto,
  type FaqItem,
  type Included,
  type InstructorDto,
  type LocalizedList,
  type LocalizedText,
  type OutlineModule,
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
    name: i.name,
    nameAr: i.nameAr,
    titleEn: i.titleEn,
    titleAr: i.titleAr,
    bioEn: i.bioEn,
    bioAr: i.bioAr,
    photoUrl: i.photoUrl,
    linkedinUrl: i.linkedinUrl,
  };
}

/**
 * Public shapes are built field by field (an allowlist), so private columns
 * such as driveFolderUrl, liveUrl and recordingUrl can never leak by accident.
 */
export function toCourseSummary(c: CourseWithRelations, seatsTaken: number): CourseSummaryDto {
  const instructors = [...c.instructors].sort((a, b) => a.order - b.order);
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
    language: c.language,
    startDate: iso(c.startDate),
    applicationDeadline: iso(c.applicationDeadline),
    durationWeeks: c.durationWeeks,
    hoursPerWeek: c.hoursPerWeek,
    coverImageUrl: c.coverImageUrl,
    availability: courseAvailability(c),
    seatsRemaining: c.capacity === null ? null : Math.max(0, c.capacity - seatsTaken),
    instructorNames: instructors.map((x) => x.instructor.name),
  };
}

export function toCourseDetail(c: CourseWithRelations, seatsTaken: number): CourseDetailDto {
  return {
    ...toCourseSummary(c, seatsTaken),
    longDescriptionEn: c.longDescriptionEn,
    longDescriptionAr: c.longDescriptionAr,
    requiresApproval: c.requiresApproval,
    capacity: c.capacity,
    applicationsOpenAt: iso(c.applicationsOpenAt),
    targetAudience: c.targetAudience as LocalizedText,
    notFor: c.notFor as LocalizedText,
    learningOutcomes: c.learningOutcomes as LocalizedList,
    prerequisites: c.prerequisites as LocalizedList,
    outline: c.outline as OutlineModule[],
    faq: c.faq as FaqItem[],
    included: c.included as Included,
    deliveryPlatform: c.deliveryPlatform,
    recordingsPlatform: c.recordingsPlatform,
    instructors: [...c.instructors].sort((a, b) => a.order - b.order).map((x) => toInstructorDto(x.instructor)),
    sessions: [...(c.sessions ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        order: s.order,
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        startsAt: s.startsAt.toISOString(),
        durationMin: s.durationMin,
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
