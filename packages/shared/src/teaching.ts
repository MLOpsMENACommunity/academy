import { z } from 'zod';
import { sessionInputSchema } from './admin';
import { materialSchema, type Material } from './course-content';
import type { CoursePermission, CourseStatus, PointsReason } from './enums';
import { manualPointsSchema } from './points';

/**
 * Course staff (see course-staff.ts) work on their courses under /teach/courses/:courseId/…
 * (also served at the older /speaker/courses/:courseId/…): what each person may do there is
 * their course role's permissions. Payments and every other course stay with the admins.
 */

/** Teaching → My courses (and the speaker portal's My courses). */
export interface TeachingCourseDto {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  status: CourseStatus;
  /** Enrolled students. */
  students: number;
  assessments: number;
  /** Submitted work waiting for a grade (0 without GRADE). */
  toGrade: number;
  /** What this person may do in the course. */
  permissions: CoursePermission[];
  /** Their role's name (null for an admin who isn't on the staff). */
  roleName: string | null;
  roleNameAr: string | null;
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
  type: 'FREE' | 'PAID';
  sessions: TeachingSessionDto[];
  permissions: CoursePermission[];
  roleName: string | null;
  roleNameAr: string | null;
  /** SUPER or ADMISSIONS admin: may enrol people in a paid course without payment (Enrolment tab). */
  canWaivePayment: boolean;
  /** The certificate rule requires passing every mandatory assessment (the Assessments tab says so when it doesn't). */
  certRequireAssessments: boolean;
}

/**
 * What a speaker may change on a session: its "what we cover" text and its links. Dates,
 * titles, the live link and everything else stay with the admins (unknown keys are dropped).
 * A field that isn't sent keeps its stored value; null clears it.
 */
export const sessionMaterialsSchema = sessionInputSchema
  .pick({ descriptionEn: true, descriptionAr: true, recordingUrl: true, assignmentUrl: true })
  .extend({ materials: z.array(materialSchema).max(20).optional() });
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
  /** The largest single entry a speaker may add, set or remove (either sign). */
  cap: number;
}
