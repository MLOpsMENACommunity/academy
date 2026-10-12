import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatDueAt } from './due-format';

/** Due in 22–24 hours: wide enough for the hourly trigger, narrow enough to send once. */
const WINDOW = { from: 22 * 60, to: 24 * 60 };

/**
 * "Due in 24 hours" emails for published assessments, to enrolled students who
 * haven't submitted yet and haven't turned course reminders off. An
 * AssessmentReminderLog row per (assessment, student) makes each one send once.
 */
@Injectable()
export class AssessmentReminderJobs {
  private readonly logger = new Logger(AssessmentReminderJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.run();
  }

  async run(now = new Date()): Promise<number> {
    const due = await this.prisma.assessment.findMany({
      where: {
        status: 'PUBLISHED',
        dueAt: { gte: new Date(now.getTime() + WINDOW.from * 60_000), lte: new Date(now.getTime() + WINDOW.to * 60_000) },
        course: { status: { in: ['OPEN', 'CLOSED'] } },
      },
      include: { course: { select: { slug: true, titleEn: true, titleAr: true } } },
    });
    let sent = 0;
    let failed = 0;
    for (const a of due) {
      const students = await this.prisma.enrollment.findMany({
        where: {
          courseId: a.courseId,
          user: {
            deletedAt: null,
            reminderPreferences: { none: { courseId: a.courseId, emailReminders: false } },
            submissions: { none: { assessmentId: a.id, submittedAt: { not: null } } },
            assessmentReminders: { none: { assessmentId: a.id } },
          },
        },
        select: { user: { select: { id: true, email: true, locale: true, profile: { select: { timezone: true } } } } },
      });
      for (const { user } of students) {
        try {
          await this.prisma.assessmentReminderLog.create({ data: { assessmentId: a.id, userId: user.id } });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
          throw err;
        }
        const ar = user.locale === 'ar';
        const when = formatDueAt(a.dueAt!, user.locale, user.profile?.timezone);
        const page = this.email.url(user.locale, `/learn/${a.course.slug}`);
        const ok = await this.email.send(
          user.email,
          user.locale,
          {
            name: 'assessmentDue',
            courseTitle: ar ? a.course.titleAr : a.course.titleEn,
            title: ar ? a.titleAr || a.titleEn : a.titleEn,
            dueAt: when,
            url: this.email.url(user.locale, `/learn/${a.course.slug}/assessments/${a.id}`),
            unsubscribeUrl: `${page}#reminders`,
          },
          { bulk: true },
        );
        if (ok) {
          sent++;
        } else {
          failed++;
          await this.prisma.assessmentReminderLog.deleteMany({ where: { assessmentId: a.id, userId: user.id } });
        }
      }
    }
    if (sent) this.logger.log(`Sent ${sent} assessment due reminder(s)`);
    if (failed) this.logger.warn(`${failed} assessment reminder(s) failed and will be retried`);
    return sent;
  }
}
