import { Module } from '@nestjs/common';
import { StudyPlanController } from './study-plan.controller';
import { StudyPlanJobs } from './study-plan.jobs';
import { StudyPlanService } from './study-plan.service';

/** Study plans for self-paced courses: the learn page's card and the study-day reminders. */
@Module({ controllers: [StudyPlanController], providers: [StudyPlanService, StudyPlanJobs] })
export class StudyPlanModule {}
