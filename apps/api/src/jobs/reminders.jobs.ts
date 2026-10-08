import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_TIMEZONE, isValidTimezone, type ReminderKind } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Session reminders by email, 24 hours and 1 hour before each live session.
 * Windows are wide enough for an hourly trigger (Cloudflare cron); a
 * ReminderLog row per (session, user, kind) guarantees each is sent once.
 */
const WINDOWS: Record<ReminderKind, { from: number; to: number; hours: 24 | 1 }> = {
  H24: { from: 22 * 60, to: 24 * 60, hours: 24 },
  H1: { from: 10, to: 75, hours: 1 },
};


@Injectable()
export class ReminderJobs {
  private readonly logger = new Logger(ReminderJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.run();
  }

  async run(now = new Date()): Promise<number> {
    let sent = 0;
    let failed = 0;
    for (const [kind, w] of Object.entries(WINDOWS) as [ReminderKind, (typeof WINDOWS)[ReminderKind]][]) {
      const sessions = await this.prisma.courseSession.findMany({
        where: {
          startsAt: { gte: new Date(now.getTime() + w.from * 60_000), lte: new Date(now.getTime() + w.to * 60_000) },
          course: { status: { in: ['OPEN', 'CLOSED'] } },
        },
        include: { course: { select: { id: true, slug: true, titleEn: true, titleAr: true } } },
      });
      for (const s of sessions) {
        const enrolled = await this.prisma.enrollment.findMany({
          where: {
            courseId: s.courseId,
            user: { deletedAt: null, reminderPreferences: { none: { courseId: s.courseId, emailReminders: false } } },
          },
          select: { user: { select: { id: true, email: true, locale: true, profile: { select: { timezone: true } } } } },
        });
        for (const { user } of enrolled) {
          // Claim first: a duplicate run (or a concurrent one) can't send twice.
          try {
            await this.prisma.reminderLog.create({ data: { sessionId: s.id, userId: user.id, kind } });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
            throw err;
          }
          const tz = user.profile?.timezone && isValidTimezone(user.profile.timezone) ? user.profile.timezone : DEFAULT_TIMEZONE;
          const ar = user.locale === 'ar';
          const when = new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: tz,
            timeZoneName: 'short',
          }).format(s.startsAt);
          const page = this.email.url(user.locale, `/learn/${s.course.slug}`);
          const ok = await this.email.send(user.email, user.locale, {
            name: 'sessionReminder',
            courseTitle: ar ? s.course.titleAr : s.course.titleEn,
            sessionTitle: ar ? s.titleAr : s.titleEn,
            startsAt: when,
            hoursBefore: w.hours,
            url: page,
            unsubscribeUrl: `${page}#reminders`,
          }, { bulk: true });
          if (ok) {
            sent++;
          } else {
            // Release the claim so the next run retries (the window is wider than the cron interval).
            failed++;
            await this.prisma.reminderLog.deleteMany({ where: { sessionId: s.id, userId: user.id, kind } });
          }
        }
      }
    }
    if (sent) this.logger.log(`Sent ${sent} session reminder(s)`);
    if (failed) this.logger.warn(`${failed} session reminder(s) failed and will be retried`);
    return sent;
  }
}
