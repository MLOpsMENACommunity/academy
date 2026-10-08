import { Controller, Headers, HttpCode, Inject, Logger, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
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
  private readonly logger = new Logger(JobsController.name);

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
  async tick(@Headers('x-jobs-token') token: string | undefined): Promise<Record<string, number | string>> {
    if (!this.env.JOBS_TOKEN) throw new NotFoundException();
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(this.env.JOBS_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    const results: Record<string, number | string> = {};
    // Each job is isolated: one failing job must not silently skip the others.
    const run = async (name: string, job: () => Promise<number | Record<string, number>>) => {
      try {
        const r = await job();
        if (typeof r === 'number') results[name] = r;
        else Object.assign(results, r);
      } catch (err) {
        results[`${name}Error`] = (err as Error).name;
        this.logger.error(`Job ${name} failed: ${(err as Error).name}`);
      }
    };
    await run('anonymised', () => this.accountJobs.runAnonymize());
    await run('profileReviewEmails', () => this.accountJobs.runProfileReview());
    await run('retention', async () => {
      const r = await this.retention.run();
      return { screenshotsDeleted: r.screenshots, cvsDeleted: r.cvs };
    });
    await run('remindersSent', () => this.reminders.run());
    return results;
  }
}
