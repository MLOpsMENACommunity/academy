import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { AutomationService } from './automation.service';

/** Course automation rules: every rule that is on, hourly (the Worker's Cron Trigger in production). */
@Injectable()
@ScheduledJob('automationActions')
export class AutomationJobs implements ScheduledJobRunner {
  constructor(private readonly automation: AutomationService) {}

  run(now = new Date()): Promise<number> {
    return this.automation.runAll(now);
  }
}
