import { Global, Module } from '@nestjs/common';
import { CourseAccessService } from './course-access.service';

/** Who may teach (manage the assessments, grades, points and materials of) a course. */
@Global()
@Module({ providers: [CourseAccessService], exports: [CourseAccessService] })
export class CourseAccessModule {}
