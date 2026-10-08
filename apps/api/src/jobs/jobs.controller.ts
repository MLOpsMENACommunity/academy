import { Controller, Headers, HttpCode, Inject, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AccountJobs } from './account.jobs';
import { ReminderJobs } from './reminders.jobs';
import { RetentionJobs } from './retention.jobs';

/**
 * Runs all scheduled jobs once. Used where in-process cron can't be relied on
 * (Cloudflare Containers sleep when idle): a Cron Trigger on the Worker calls
 * this every 15 minutes with a shared secret. Every job is idempotent.
 */
@ApiExcludeController()
@Controller('internal/jobs')
export class JobsController {
  constructor(
    private readonly accountJobs: AccountJobs,
    private readonly retention: RetentionJobs,
    private readonly reminders: ReminderJobs,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('tick')
  @HttpCode(200)
  async tick(@Headers('x-jobs-token') token: string | undefined): Promise<Record<string, number>> {
    if (!this.env.JOBS_TOKEN) throw new NotFoundException();
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(this.env.JOBS_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    const results: Record<string, number> = {};
    // Daily-ish jobs are safe to run often: each one only touches rows that are due.
    results.anonymised = await this.accountJobs.runAnonymize();
    results.profileReviewEmails = await this.accountJobs.runProfileReview();
    const r = await this.retention.run();
    results.screenshotsDeleted = r.screenshots;
    results.cvsDeleted = r.cvs;
    results.remindersSent = await this.reminders.run();
    return results;
  }
}
