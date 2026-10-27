import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { DriveSharingService } from './drive-sharing.service';

/** Shares paid courses' Drive folders with new students and removes old addresses, hourly. */
@Injectable()
@ScheduledJob('driveShared')
export class DriveSharingJobs implements ScheduledJobRunner {
  constructor(private readonly sharing: DriveSharingService) {}

  run(now = new Date()): Promise<number> {
    return this.sharing.runAll(now);
  }
}
