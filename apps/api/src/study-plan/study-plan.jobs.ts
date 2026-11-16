import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, localIsoDate, STUDY_PLAN_REMINDER_WINDOW_HOURS, weekdayOf, zonedTime, type Locale, type StudyDay } from '@academy/shared';
import { LEARNER_ROLE_FILTER } from '../common/learners';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { EmailPreferenceLinks } from '../outbox/email-links';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadStudyItems, planStartDate, planTimezone, scheduleOf, type StudyItemTitle } from './study-items';

const HOUR = 3_600_000;

/**
 * When a plan's reminder is due on a local date: the reminder hour on that date in the student's
 * time zone (an hour skipped by a daylight-saving change moves to the next hour). Exported so a
 * "next due at" for the jobs tick can be computed from the same rule.
 */
export function reminderAt(date: string, hour: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return zonedTime({ year, month, day }, hour * 60, timezone) ?? zonedTime({ year, month, day }, hour * 60 + 60, timezone)!;
}

/**
 * The next reminder moment strictly after `now` for one plan: the first study day (on or after its
 * start, in the student's zone, within the coming 8 days) whose reminder time is still ahead. The jobs
 * tick reports the earliest one as part of `nextDueAt` (jobs/next-due.ts), so the Worker wakes the API
 * in time: a reminder is dropped when it would be more than STUDY_PLAN_REMINDER_WINDOW_HOURS late.
 */
export function nextReminderAfter(
  plan: { weekdays: readonly number[]; reminderHour: number; startDate: string },
  timezone: string,
  now: Date,
): Date | null {
  let day = localIsoDate(now, timezone);
  if (day < plan.startDate) day = plan.startDate;
  for (let i = 0; i < 8; i++, day = addDays(day, 1)) {
    if (!plan.weekdays.includes(weekdayOf(day))) continue;
    const at = reminderAt(day, plan.reminderHour, timezone);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

/** "Video 3 (part 2 of 3) · 45 min" / "Quiz: Week 1 · 20 min", in the student's language. */
function itemLine(i: StudyDay['items'][number], title: StudyItemTitle | undefined, ar: boolean): string {
  const name = (ar ? title?.titleAr : title?.titleEn) || (ar ? 'درس' : 'Lesson');
  const label = i.kind === 'quiz' ? (ar ? `اختبار: ${name}` : `Quiz: ${name}`) : name;
  const part = i.parts > 1 ? (ar ? ` (الجزء ${i.part} من ${i.parts})` : ` (part ${i.part} of ${i.parts})`) : '';
  return `${label}${part} · ${ar ? `${i.minutes} دقيقة` : `${i.minutes} min`}`;
}

/**
 * Study-day reminders: on each tick, for every study plan with a reminder whose study day is
 * today in the student's time zone and whose reminder hour has passed (by at most
 * STUDY_PLAN_REMINDER_WINDOW_HOURS: a reminder that late is dropped for the day), an in-app
 * notification and the `studyPlanReminder` email listing today's items. Once per plan and
 * day: the outbox dedupeKey study-plan:<planId>:<local date> is the marker, written with the
 * notification in one transaction. The email waits for the reminder time (notBefore) and is
 * re-checked against the course's reminder opt-out at send time; a student who opted out gets
 * the notification and a SKIPPED row. Nobody who has finished (no required item left, or a
 * certificate) is reminded. Only enqueues: the outbox sends after the tick.
 */
@Injectable()
@ScheduledJob('studyPlanRemindersQueued')
export class StudyPlanJobs implements ScheduledJobRunner {
  private readonly logger = new Logger(StudyPlanJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: Outbox,
    private readonly links: EmailPreferenceLinks,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(now = new Date()): Promise<number> {
    const plans = await this.prisma.studyPlan.findMany({
      where: {
        reminderHour: { not: null },
        course: { selfPaced: true, status: { in: ['OPEN', 'CLOSED'] } },
        user: { role: LEARNER_ROLE_FILTER, deletedAt: null, anonymizedAt: null },
      },
      select: {
        id: true,
        userId: true,
        courseId: true,
        weekdays: true,
        minutesPerDay: true,
        startDate: true,
        reminderHour: true,
        user: { select: { locale: true, profile: { select: { timezone: true } } } },
        course: { select: { slug: true, titleEn: true, titleAr: true } },
      },
    });
    // Due now: a study day in the student's zone, on or after the start, the reminder hour passed (not too long ago).
    const due = plans.flatMap((p) => {
      const timezone = planTimezone(p.user.profile?.timezone);
      const today = localIsoDate(now, timezone);
      if (today < planStartDate(p) || !p.weekdays.includes(weekdayOf(today))) return [];
      const at = reminderAt(today, p.reminderHour!, timezone);
      if (now < at || now.getTime() >= at.getTime() + STUDY_PLAN_REMINDER_WINDOW_HOURS * HOUR) return [];
      return [{ ...p, today, at, key: `study-plan:${p.id}:${today}` }];
    });
    if (!due.length) return 0;
    // Most ticks of the window find the reminder already queued: skip those before loading anything else.
    const queued = new Set((await this.prisma.outboundEmail.findMany({ where: { dedupeKey: { in: due.map((d) => d.key) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));
    const todo = due.filter((d) => !queued.has(d.key));
    if (!todo.length) return 0;

    const [enrollments, prefs] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { OR: todo.map((d) => ({ userId: d.userId, courseId: d.courseId })) },
        select: { userId: true, courseId: true, certificate: { select: { revokedAt: true } } },
      }),
      this.prisma.reminderPreference.findMany({ where: { OR: todo.map((d) => ({ userId: d.userId, courseId: d.courseId })) }, select: { userId: true, courseId: true, emailReminders: true } }),
    ]);
    const pair = (userId: string, courseId: string) => `${userId}:${courseId}`;
    const enrolled = new Map(enrollments.map((e) => [pair(e.userId, e.courseId), e]));
    const optedOut = new Set(prefs.filter((p) => !p.emailReminders).map((p) => pair(p.userId, p.courseId)));

    let count = 0;
    for (const courseId of new Set(todo.map((d) => d.courseId))) {
      try {
        // Still enrolled, and not certified yet (a valid certificate means the course is done).
        const mine = todo.filter((d) => {
          const e = d.courseId === courseId ? enrolled.get(pair(d.userId, d.courseId)) : undefined;
          return e && !(e.certificate && !e.certificate.revokedAt);
        });
        count += await this.remind(courseId, mine, optedOut);
      } catch (err) {
        // One course failing must not stop the others; the next tick in the window retries it.
        this.logger.error(`Study plan reminders for a course failed: ${(err as Error).name}`);
      }
    }
    if (count) {
      this.outbox.kick();
      this.logger.log(`Queued ${count} study plan reminder(s)`);
    }
    return count;
  }

  private async remind(
    courseId: string,
    plans: {
      id: string;
      userId: string;
      weekdays: number[];
      minutesPerDay: number;
      startDate: Date;
      today: string;
      at: Date;
      key: string;
      user: { locale: string };
      course: { slug: string; titleEn: string; titleAr: string };
    }[],
    optedOut: Set<string>,
  ): Promise<number> {
    if (!plans.length) return 0;
    const { byUser, titles } = await loadStudyItems(this.prisma, courseId, plans.map((p) => p.userId));
    const ready = plans.flatMap((p) => {
      const { schedule } = scheduleOf(p, byUser.get(p.userId) ?? [], p.today);
      const day = schedule.days[0];
      // Finished the course, or (defensively) nothing falls on today.
      return day && day.date === p.today ? [{ ...p, day }] : [];
    });
    if (!ready.length) return 0;

    const messages: OutboxMessage[] = ready.map((p) => {
      const locale: Locale = p.user.locale === 'ar' ? 'ar' : 'en';
      const ar = locale === 'ar';
      return {
        userId: p.userId,
        locale,
        category: 'study-plan',
        courseId,
        dedupeKey: p.key,
        notBefore: p.at,
        ...(optedOut.has(`${p.userId}:${courseId}`) ? { skip: 'opted_out' } : {}),
        template: {
          name: 'studyPlanReminder',
          courseTitle: ar ? p.course.titleAr || p.course.titleEn : p.course.titleEn,
          minutes: p.day.minutes,
          items: p.day.items.map((i) => itemLine(i, titles.get(i.id), ar)),
          url: `${this.env.WEB_URL}/${locale}/learn/${p.course.slug}#study-plan`,
          unsubscribeUrl: this.links.pageUrl(locale, 'reminders', p.userId, courseId),
        },
      };
    });
    return this.prisma.$transaction(async (tx) => {
      const created = await this.outbox.enqueue(messages, tx);
      const fresh = ready.filter((p) => created.has(p.key));
      if (fresh.length) {
        await tx.notification.createMany({
          data: fresh.map((p) => {
            const first = p.day.items[0]!;
            const t = titles.get(first.id);
            const more = p.day.items.length - 1;
            return {
              userId: p.userId,
              type: 'study-plan.reminder',
              titleEn: `Study day: ${p.course.titleEn}`,
              titleAr: `يوم دراسة: ${p.course.titleAr || p.course.titleEn}`,
              bodyEn: `Today's plan (${p.day.minutes} min): ${itemLine(first, t, false)}${more ? ` and ${more} more` : ''}.`,
              bodyAr: `خطة اليوم (${p.day.minutes} دقيقة): ${itemLine(first, t, true)}${more ? ` و${more} غيره` : ''}.`,
              link: `/learn/${p.course.slug}#study-plan`,
            };
          }),
        });
      }
      return fresh.length;
    });
  }
}
