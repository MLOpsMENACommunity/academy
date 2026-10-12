import { z } from 'zod';
import { sessionInputSchema } from './admin';
import type { Material } from './course-content';
import type { CourseStatus, PointsReason } from './enums';
import { manualPointsSchema } from './points';

/**
 * Speakers teach the courses they are assigned to (Admin → Speakers → {speaker} → Assigned
 * courses): assessments and grading, the gradebook, course points and the sessions'
 * materials, under /speaker/courses/:courseId/…. Certificates, payments, applications and
 * every other student detail stay with the admins.
 */

/** Speaker portal → My courses. */
export interface TeachingCourseDto {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  status: CourseStatus;
  /** Enrolled students. */
  students: number;
  assessments: number;
  /** Submitted work waiting for a grade. */
  toGrade: number;
}

/** A course session as a teaching speaker sees it: no live link, dates read-only. */
export interface TeachingSessionDto {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  startsAt: string;
  durationMin: number;
  descriptionEn: string | null;
  descriptionAr: string | null;
  recordingUrl: string | null;
  assignmentUrl: string | null;
  materials: Material[];
}

export interface TeachingCourseDetailDto {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  status: CourseStatus;
  sessions: TeachingSessionDto[];
}

/**
 * What a speaker may change on a session: its "what we cover" text and its links. Dates,
 * titles, the live link and everything else stay with the admins (unknown keys are dropped).
 */
export const sessionMaterialsSchema = sessionInputSchema.pick({
  descriptionEn: true,
  descriptionAr: true,
  recordingUrl: true,
  assignmentUrl: true,
  materials: true,
});
export type SessionMaterialsInput = z.infer<typeof sessionMaterialsSchema>;

/** Course points from a speaker: always tagged with their course, for an enrolled student. */
export const teachingPointsSchema = manualPointsSchema.omit({ courseId: true }).extend({ userId: z.string().trim().min(1).max(40) });
export type TeachingPointsInput = z.infer<typeof teachingPointsSchema>;

export interface TeachingStudentDto {
  userId: string;
  name: string | null;
  email: string;
  /** Points earned in this course. */
  points: number;
}

export interface TeachingPointsEntryDto {
  id: string;
  userId: string;
  student: string;
  points: number;
  reason: PointsReason;
  note: string | null;
  createdAt: string;
  /** Who added them (a speaker's or admin's name). */
  awardedBy: string | null;
}

/** The Points tab: enrolled students with their course points, and recent manual entries. */
export interface TeachingPointsDto {
  students: TeachingStudentDto[];
  entries: TeachingPointsEntryDto[];
}
