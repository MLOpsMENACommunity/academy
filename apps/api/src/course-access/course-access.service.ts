import { ForbiddenException, Injectable } from '@nestjs/common';
import { COURSE_PERMISSIONS, hasAdminPermission, type AdminPermission, type CoursePermission, type Role } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The parts of the signed-in user the rule needs (AuthUser fits). */
export interface Teacher {
  id: string;
  role: Role;
  adminPermissions?: readonly AdminPermission[] | null;
}

/** Admin presets that can do everything in every course (and preview its learn page). */
export const TEACHING_ADMIN_PERMISSIONS = ['ACADEMIC'] as const satisfies readonly AdminPermission[];

/** One answer for "no such course" and "not on its staff", so nobody can probe course ids. */
export function notYourCourse(): ForbiddenException {
  return new ForbiddenException({ code: 'NOT_YOUR_COURSE', message: 'You can only manage the courses you are on the staff of' });
}

/** On the course's staff, but their role doesn't include this. */
export function missingCoursePermission(needed: readonly CoursePermission[]): ForbiddenException {
  return new ForbiddenException({ code: 'COURSE_PERMISSION', message: "Your role in this course doesn't include this", needed });
}

/** What someone may do in one course. */
export interface CourseMembership {
  permissions: CoursePermission[];
  /** Their staff role, if they are on the staff (an ACADEMIC admin needn't be). */
  roleId: string | null;
  roleName: string | null;
  roleNameAr: string | null;
  /** A SUPER or ACADEMIC admin: everything, in every course. */
  admin: boolean;
}

/**
 * Who may do what in a course (the one rule for every /teach route and the learn preview):
 *
 *  - an ADMIN with SUPER or ACADEMIC: everything, in every course (archived ones included);
 *  - anyone else (any account role: speaker, student, admin with other presets): the
 *    permissions of their CourseStaff role in that course, while the course isn't ARCHIVED.
 *    A staff row without an account (a public speaker profile only) gives nobody anything.
 *
 * Read from the database on every call, so a change of role, permissions or staff (or archiving
 * the course) takes effect on the person's next request.
 */
@Injectable()
export class CourseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Courses where this account is on the staff (any role, or one with `permission`), not archived. */
  staffCoursesWhere(userId: string, permission?: CoursePermission): Prisma.CourseWhereInput {
    return {
      status: { not: 'ARCHIVED' },
      staff: { some: { userId, ...(permission ? { role: { permissions: { has: permission } } } : {}) } },
    };
  }

  isCourseAdmin(user: Teacher | null | undefined): boolean {
    return Boolean(user && user.role === 'ADMIN' && hasAdminPermission(user, TEACHING_ADMIN_PERMISSIONS));
  }

  /** Null when the course doesn't exist or the user may do nothing there. */
  async membership(user: Teacher | null | undefined, courseId: string): Promise<CourseMembership | null> {
    if (!user || !courseId || typeof courseId !== 'string') return null;
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        status: true,
        staff: { where: { userId: user.id }, take: 1, select: { role: { select: { id: true, name: true, nameAr: true, permissions: true } } } },
      },
    });
    if (!course) return null;
    const role = course.staff[0]?.role ?? null;
    const named = { roleId: role?.id ?? null, roleName: role?.name ?? null, roleNameAr: role?.nameAr ?? null };
    if (this.isCourseAdmin(user)) return { permissions: [...COURSE_PERMISSIONS], admin: true, ...named };
    if (!role || course.status === 'ARCHIVED') return null;
    return { permissions: COURSE_PERMISSIONS.filter((p) => role.permissions.includes(p)), admin: false, ...named };
  }

  /** True when the user has any one of `permission` in the course. */
  async can(user: Teacher | null | undefined, courseId: string, permission: CoursePermission | readonly CoursePermission[]): Promise<boolean> {
    const any = typeof permission === 'string' ? [permission] : permission;
    const m = await this.membership(user, courseId);
    return Boolean(m && any.some((p) => m.permissions.includes(p)));
  }

  /**
   * 403 NOT_YOUR_COURSE unless the user is on the course's staff (an unknown id included), then
   * 403 COURSE_PERMISSION unless their role has one of `permission` (none given: any staff member).
   */
  async assertCan(user: Teacher | null | undefined, courseId: string, permission: readonly CoursePermission[] = []): Promise<CourseMembership> {
    const m = await this.membership(user, courseId);
    if (!m) throw notYourCourse();
    if (permission.length && !permission.some((p) => m.permissions.includes(p))) throw missingCoursePermission(permission);
    return m;
  }

  /** May preview the course's assessments on its learn page (whoever writes or grades them). */
  canTeach(user: Teacher | null | undefined, courseId: string): Promise<boolean> {
    return this.can(user, courseId, ['MANAGE_ASSESSMENTS', 'GRADE']);
  }
}
