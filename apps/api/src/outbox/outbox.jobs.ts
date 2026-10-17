import { Injectable } from '@nestjs/common';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { OutboxProcessor } from './outbox.processor';

/**
 * Every tick: delete old finished rows, and start sending what is due (after the tick has
 * answered, so a long queue never holds the cron request open).
 */
@Injectable()
@ScheduledJob('outbox')
export class OutboxJobs implements ScheduledJobRunner {
  constructor(private readonly processor: OutboxProcessor) {}

  async run(now = new Date()): Promise<Record<string, number>> {
    const purged = await this.processor.purge(now);
    const pending = await this.processor.pending();
    if (pending) void this.processor.process().catch(() => undefined);
    return { outboxPending: pending, outboxPurged: purged };
  }
}
