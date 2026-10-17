import { Global, Module } from '@nestjs/common';
import { AdminCourseStaffController } from './course-staff.controller';
import { CourseStaffService } from './course-staff.service';

/** Course roles and staff (Admin → Courses → {course} → Staff), and the public staff list. */
@Global()
@Module({ controllers: [AdminCourseStaffController], providers: [CourseStaffService], exports: [CourseStaffService] })
export class CourseStaffModule {}
