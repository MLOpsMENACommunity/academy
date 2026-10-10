import { Module } from '@nestjs/common';
import { AdminAssessmentsController } from './admin-assessments.controller';
import { AdminAssessmentsService } from './admin-assessments.service';
import { AssessmentReminderJobs } from './assessment-reminders.jobs';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { GITHUB_FETCH, GithubRepoChecker, type FetchLike } from './github-repo-check';

@Module({
  controllers: [AssessmentsController, AdminAssessmentsController],
  providers: [
    AssessmentsService,
    AdminAssessmentsService,
    AssessmentReminderJobs,
    GithubRepoChecker,
    { provide: GITHUB_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies FetchLike },
  ],
  // AssessmentsService.courseResults is the shared score rule for certificates and points.
  exports: [AssessmentsService, AssessmentReminderJobs],
})
export class AssessmentsModule {}
