import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { ConsultationsService } from './consultations.service';

/**
 * Queues the 24-hour and 1-hour reminders for booked calls (the outbox sends them), and deletes
 * payment screenshots past the retention period (the records stay).
 */
@Injectable()
@ScheduledJob('consultations')
export class ConsultationJobs implements ScheduledJobRunner {
  constructor(private readonly consultations: ConsultationsService) {}

  async run(now = new Date()): Promise<{ consultationRemindersQueued: number; consultationScreenshotsDeleted: number }> {
    const consultationRemindersQueued = await this.consultations.queueReminders(now);
    const consultationScreenshotsDeleted = await this.consultations.purgeOldScreenshots(now);
    return { consultationRemindersQueued, consultationScreenshotsDeleted };
  }
}
