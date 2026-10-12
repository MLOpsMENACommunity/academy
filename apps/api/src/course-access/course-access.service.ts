import { ForbiddenException, Injectable } from '@nestjs/common';
import { hasAdminPermission, type AdminPermission, type Role } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The parts of the signed-in user the rule needs (AuthUser fits). */
export interface Teacher {
  id: string;
  role: Role;
  adminPermissions?: readonly AdminPermission[] | null;
}

/** Admin presets that teach every course (and preview its learn page). */
export const TEACHING_ADMIN_PERMISSIONS = ['ACADEMIC'] as const satisfies readonly AdminPermission[];

/** One answer for "no such course" and "not yours", so a speaker can't probe course ids. */
export function notYourCourse(): ForbiddenException {
  return new ForbiddenException({ code: 'NOT_YOUR_COURSE', message: 'You can only manage the courses you are assigned to' });
}

/**
 * Who may teach a course: manage its assessments, grade its submissions, give its points and
 * edit its sessions' materials.
 *
 *  - an ADMIN with SUPER or ACADEMIC: every course;
 *  - a SPEAKER whose public speaker profile (Instructor, linked by Instructor.userId) is one of
 *    the course's instructors (CourseInstructor), while the course isn't ARCHIVED.
 *
 * Read from the database on every call, so removing a speaker from a course (or archiving it)
 * takes effect on their next request. Assignment is many-to-many: a course can have several
 * teaching speakers, and a speaker several courses.
 */
@Injectable()
export class CourseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The courses a speaker profile teaches (the same link that lists them on the course page). */
  teachingWhere(instructorId: string): Prisma.CourseWhereInput {
    return { status: { not: 'ARCHIVED' }, instructors: { some: { instructorId } } };
  }

  /** The courses a speaker account teaches, by the account id. */
  teachingWhereForUser(userId: string): Prisma.CourseWhereInput {
    return { status: { not: 'ARCHIVED' }, instructors: { some: { instructor: { userId } } } };
  }

  async canTeach(user: Teacher | null | undefined, courseId: string): Promise<boolean> {
    if (!user || !courseId) return false;
    if (user.role === 'ADMIN') return hasAdminPermission(user, TEACHING_ADMIN_PERMISSIONS);
    if (user.role !== 'SPEAKER') return false;
    const n = await this.prisma.course.count({ where: { id: courseId, ...this.teachingWhereForUser(user.id) } });
    return n > 0;
  }

  /** 403 NOT_YOUR_COURSE unless the user teaches the course (an unknown id included). */
  async assertTeaches(user: Teacher | null | undefined, courseId: string): Promise<void> {
    if (!(await this.canTeach(user, courseId))) throw notYourCourse();
  }
}
