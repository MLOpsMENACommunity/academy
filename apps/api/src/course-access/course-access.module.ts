import { Global, Module } from '@nestjs/common';
import { CourseAccessService } from './course-access.service';
import { CoursePermissionGuard } from './course-permission.guard';

/** Who may do what in a course: SUPER/ACADEMIC admins, and its staff by their role's permissions. */
@Global()
@Module({ providers: [CourseAccessService, CoursePermissionGuard], exports: [CourseAccessService, CoursePermissionGuard] })
export class CourseAccessModule {}
