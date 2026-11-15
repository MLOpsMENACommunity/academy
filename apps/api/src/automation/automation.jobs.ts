import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { AutomationService } from './automation.service';

/** Course automation rules: every rule that is on, on each jobs tick (hourly while the site is in use, at least every 4 hours in production). */
@Injectable()
@ScheduledJob('automationActions')
export class AutomationJobs implements ScheduledJobRunner {
  constructor(private readonly automation: AutomationService) {}

  run(now = new Date()): Promise<number> {
    return this.automation.runAll(now);
  }
}
