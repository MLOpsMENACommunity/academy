import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { ConsultationsService } from './consultations.service';

/**
 * Lapses unpaid reservations past their hold (the student is told) and queues the
 * 24-hour and 1-hour reminders for confirmed calls. Only enqueues: the outbox sends.
 */
@Injectable()
@ScheduledJob('consultations')
export class ConsultationJobs implements ScheduledJobRunner {
  constructor(private readonly consultations: ConsultationsService) {}

  async run(now = new Date()): Promise<{ consultationHoldsExpired: number; consultationRemindersQueued: number }> {
    const consultationHoldsExpired = await this.consultations.expireHolds(now);
    const consultationRemindersQueued = await this.consultations.queueReminders(now);
    return { consultationHoldsExpired, consultationRemindersQueued };
  }
}
