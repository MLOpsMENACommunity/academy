import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PROFILE_REVIEW_DAYS } from '@academy/shared';
import { LEARNER_USER } from '../common/learners';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../users/account.service';

@Injectable()
export class AccountJobs {
  private readonly logger = new Logger(AccountJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Anonymise accounts deleted more than 30 days ago. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Africa/Cairo' })
  async anonymizeDeletedAccounts(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.runAnonymize();
  }

  async runAnonymize(): Promise<number> {
    const n = await this.accounts.anonymizeDue();
    if (n) this.logger.log(`Anonymised ${n} deleted account(s)`);
    return n;
  }

  /** Email learners (students, and speakers who study) whose profile hasn't been touched for ~6 months (once per stale period). */
  @Cron(CronExpression.EVERY_DAY_AT_10AM, { timeZone: 'Africa/Cairo' })
  async promptProfileReview(): Promise<number> {
    if (!this.env.JOBS_ENABLED) return 0;
    return this.runProfileReview();
  }

  async runProfileReview(): Promise<number> {
    const cutoff = new Date(Date.now() - PROFILE_REVIEW_DAYS * 86_400_000);
    const stale = await this.prisma.profile.findMany({
      where: {
        updatedAt: { lt: cutoff },
        coreCompletedAt: { not: null },
        OR: [{ reviewPromptSentAt: null }, { reviewPromptSentAt: { lt: cutoff } }],
        user: { deletedAt: null, ...LEARNER_USER },
      },
      select: { id: true, user: { select: { email: true, locale: true } } },
      take: 100,
    });
    for (const p of stale) {
      await this.email.send(p.user.email, p.user.locale, {
        name: 'profileReview',
        url: this.email.url(p.user.locale, '/profile'),
      });
      // Raw update so the reminder stamp doesn't bump updatedAt (which would reset the clock).
      await this.prisma.$executeRaw`UPDATE "Profile" SET "reviewPromptSentAt" = NOW() WHERE "id" = ${p.id}`;
    }
    if (stale.length) this.logger.log(`Sent ${stale.length} profile review reminder(s)`);
    return stale.length;
  }
}
