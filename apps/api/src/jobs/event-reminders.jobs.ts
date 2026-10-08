import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ReminderKind } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { formatWhen } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

/** Same windows as course reminders: wide enough for the 15-minute Cloudflare cron. */
const WINDOWS: Record<ReminderKind, { from: number; to: number; hours: 24 | 1 }> = {
  H24: { from: 22 * 60, to: 24 * 60, hours: 24 },
  H1: { from: 10, to: 75, hours: 1 },
};

/** Reminds registered people 24 hours and 1 hour before a live session; each reminder is claimed once. */
@Injectable()
export class EventReminderJobs {
  private readonly logger = new Logger(EventReminderJobs.name);

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
    for (const [kind, w] of Object.entries(WINDOWS) as [ReminderKind, (typeof WINDOWS)[ReminderKind]][]) {
      const events = await this.prisma.liveEvent.findMany({
        where: { status: 'PUBLISHED', startsAt: { gte: new Date(now.getTime() + w.from * 60_000), lte: new Date(now.getTime() + w.to * 60_000) } },
        include: {
          registrations: {
            where: { user: { deletedAt: null } },
            select: { user: { select: { id: true, email: true, locale: true, profile: { select: { timezone: true } } } } },
          },
        },
      });
      for (const e of events) {
        for (const { user } of e.registrations) {
          try {
            await this.prisma.eventReminderLog.create({ data: { eventId: e.id, userId: user.id, kind } });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
            throw err;
          }
          const locale = user.locale === 'ar' ? 'ar' : 'en';
          const ok = await this.email.send(
            user.email,
            locale,
            {
              name: 'eventReminder',
              title: locale === 'ar' ? e.titleAr || e.titleEn : e.titleEn,
              when: formatWhen(e.startsAt, locale, user.profile?.timezone),
              hoursBefore: w.hours,
              url: this.email.url(locale, `/sessions/${e.slug}`),
            },
            { bulk: true },
          );
          if (ok) sent++;
          // Release the claim so the next run retries.
          else await this.prisma.eventReminderLog.deleteMany({ where: { eventId: e.id, userId: user.id, kind } });
        }
      }
    }
    if (sent) this.logger.log(`Sent ${sent} live-session reminder(s)`);
    return sent;
  }
}
