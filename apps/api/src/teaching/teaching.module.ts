import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { PointsModule } from '../points/points.module';
import { TeachesCourseGuard } from './teaches-course.guard';
import { TeachingController } from './teaching.controller';
import { TeachingService } from './teaching.service';

/** Speakers teach their assigned courses: /speaker/courses/:courseId/… (see CourseAccessService). */
@Module({
  imports: [AssessmentsModule, PointsModule],
  controllers: [TeachingController],
  providers: [TeachingService, TeachesCourseGuard],
})
export class TeachingModule {}
