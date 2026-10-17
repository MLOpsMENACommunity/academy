import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CoursePermission } from '@academy/shared';
import type { AuthedRequest } from '../common/decorators';
import { CourseAccessService, notYourCourse, type CourseMembership } from './course-access.service';

export const COURSE_CAN_KEY = 'courseCan';

/** Any staff member of the course (no particular permission): its overview only. */
export const ANY_STAFF = 'ANY_STAFF' as const;

/**
 * Which course permissions open a /teach route (any one is enough), or ANY_STAFF. Required on
 * every route with a :courseId under CoursePermissionGuard: one without it is refused (default
 * deny), and teaching-routes.spec.ts fails when one is missing.
 */
export const CourseCan = (...permissions: [CoursePermission, ...CoursePermission[]] | [typeof ANY_STAFF]) => SetMetadata(COURSE_CAN_KEY, permissions);

export interface CourseRequest extends AuthedRequest {
  /** Set by CoursePermissionGuard: what the user may do in the route's course. */
  courseMembership?: CourseMembership;
}

/**
 * Every route with a :courseId parameter: 403 NOT_YOUR_COURSE unless the signed-in user is on
 * that course's staff (or a SUPER/ACADEMIC admin), and 403 COURSE_PERMISSION unless their role
 * has one of the route's @CourseCan permissions; read from the database on every request
 * (CourseAccessService). Runs after the global AuthGuard and the throttler. Ids inside the course
 * (assessments, submissions, sessions, students, applications, …) are checked by each handler:
 * 404 when they aren't that course's.
 */
@Injectable()
export class CoursePermissionGuard implements CanActivate {
  constructor(
    private readonly access: CourseAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CourseRequest>();
    const courseId = (req.params as Record<string, string | undefined>)?.courseId;
    // Routes without a course (the list of my courses) are scoped by the service itself.
    if (courseId === undefined) return true;
    if (!req.user) throw notYourCourse();
    const tag = this.reflector.get<readonly string[] | undefined>(COURSE_CAN_KEY, ctx.getHandler());
    // Default deny: a course route that forgot to say who may use it is nobody's.
    if (!tag?.length) throw notYourCourse();
    const needed = tag.includes(ANY_STAFF) ? [] : (tag as CoursePermission[]);
    req.courseMembership = await this.access.assertCan(req.user, courseId, needed);
    return true;
  }
}
