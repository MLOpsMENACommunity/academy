import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../common/decorators';
import { CourseAccessService, notYourCourse } from '../course-access/course-access.service';

/**
 * Every route with a :courseId parameter: 403 NOT_YOUR_COURSE unless the signed-in user teaches
 * that course (CourseAccessService.canTeach), checked against the database on every request.
 * Runs after the global AuthGuard (roles) and the throttler. Ids inside the course (assessments,
 * submissions, sessions, students) are checked by each handler: 404 when they aren't its own.
 */
@Injectable()
export class TeachesCourseGuard implements CanActivate {
  constructor(private readonly access: CourseAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const courseId = (req.params as Record<string, string | undefined>)?.courseId;
    // Routes without a course (the list of my courses) are scoped by the service itself.
    if (courseId === undefined) return true;
    if (!req.user) throw notYourCourse();
    await this.access.assertTeaches(req.user, courseId);
    return true;
  }
}
