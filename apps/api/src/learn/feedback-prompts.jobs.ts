import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ScheduledJob, type ScheduledJobRunner } from '../jobs/jobs-registry';
import { EmailPreferenceLinks } from '../outbox/email-links';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { KEEP_DONE_DAYS } from '../outbox/outbox.processor';
import { PrismaService } from '../prisma/prisma.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Prompts go from 30 minutes after a session ends… */
export const PROMPT_AFTER_MS = 30 * MINUTE;
/** …until 72 hours after: an hourly tick, or a deploy up to two days late, still asks. */
export const PROMPT_UNTIL_MS = 72 * HOUR;
/** The longest session there is (see nextSessions), to find sessions by start time. */
const MAX_SESSION_MS = 10 * HOUR;

// The outbox row is the "already asked" marker, so it must outlive the window.
if (KEEP_DONE_DAYS * 24 * HOUR <= PROMPT_UNTIL_MS) throw new Error('Outbox retention must outlast the feedback window');

/** In-app and email text, per language. */
function texts(s: { order: number; titleEn: string; titleAr: string }, c: { titleEn: string; titleAr: string }, last: boolean) {
  const titleAr = s.titleAr || s.titleEn;
  const courseAr = c.titleAr || c.titleEn;
  return {
    titleEn: `How was session ${s.order}?`,
    titleAr: `كيف كانت الجلسة ${s.order}؟`,
    bodyEn: last
      ? `"${s.titleEn}" was the last session of ${c.titleEn}. Rate it, and the course, in 10 seconds.`
      : `Rate "${s.titleEn}" in ${c.titleEn}: it takes 10 seconds.`,
    bodyAr: last ? `كانت «${titleAr}» الجلسة الأخيرة في ${courseAr}. قيّمها وقيّم الدورة في 10 ثوانٍ.` : `قيّم «${titleAr}» في ${courseAr}: يستغرق الأمر 10 ثوانٍ.`,
  };
}

/**
 * "How was the session?" after every course session: once per student and session, an
 * in-app notification and an email (through the outbox, dedupeKey feedback:<session>:<user>).
 * At the course's last session the same email also asks for the course rating.
 *
 * Who: students (role STUDENT) enrolled before the session ended, account not deleted, who
 * haven't rated the session yet. Courses that are Open, Closed or Completed: it goes by the
 * session's time, not the course status. Students who turned feedback emails off for the
 * course still get the in-app notification; their email row is written as SKIPPED.
 *
 * The job only enqueues: the tick stays fast and the outbox sends after it.
 */
@Injectable()
@ScheduledJob('feedbackPromptsQueued')
export class FeedbackPromptJobs implements ScheduledJobRunner {
  private readonly logger = new Logger(FeedbackPromptJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: Outbox,
    private readonly links: EmailPreferenceLinks,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(now = new Date()): Promise<number> {
    const sessions = await this.prisma.courseSession.findMany({
      where: {
        startsAt: { gte: new Date(now.getTime() - PROMPT_UNTIL_MS - MAX_SESSION_MS), lte: new Date(now.getTime() - PROMPT_AFTER_MS) },
        course: { status: { in: ['OPEN', 'CLOSED', 'COMPLETED'] } },
      },
      select: {
        id: true,
        courseId: true,
        order: true,
        titleEn: true,
        titleAr: true,
        startsAt: true,
        durationMin: true,
        course: { select: { slug: true, titleEn: true, titleAr: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
    const due = sessions.filter((s) => {
      const end = s.startsAt.getTime() + s.durationMin * MINUTE;
      return end + PROMPT_AFTER_MS <= now.getTime() && now.getTime() <= end + PROMPT_UNTIL_MS;
    });
    if (!due.length) return 0;

    // The last session of each course (latest start, as the course-feedback gate in LearnService).
    const lastByCourse = new Map(
      (
        await this.prisma.courseSession.groupBy({ by: ['courseId'], where: { courseId: { in: [...new Set(due.map((s) => s.courseId))] } }, _max: { startsAt: true } })
      ).map((g) => [g.courseId, g._max.startsAt?.getTime()]),
    );

    let queued = 0;
    for (const s of due) {
      try {
        queued += await this.prompt(s, lastByCourse.get(s.courseId) === s.startsAt.getTime());
      } catch (err) {
        // One session failing must not stop the others; the next tick retries it.
        this.logger.error(`Feedback prompts for a session failed: ${(err as Error).name}`);
      }
    }
    if (queued) {
      this.outbox.kick();
      this.logger.log(`Queued ${queued} feedback prompt(s)`);
    }
    return queued;
  }

  private async prompt(
    s: { id: string; courseId: string; order: number; titleEn: string; titleAr: string; startsAt: Date; durationMin: number; course: { slug: string; titleEn: string; titleAr: string } },
    last: boolean,
  ): Promise<number> {
    const endedAt = new Date(s.startsAt.getTime() + s.durationMin * MINUTE);
    const students = await this.prisma.enrollment.findMany({
      where: {
        courseId: s.courseId,
        enrolledAt: { lte: endedAt },
        user: { role: 'STUDENT', deletedAt: null, anonymizedAt: null, sessionFeedback: { none: { sessionId: s.id } } },
      },
      select: {
        user: {
          select: {
            id: true,
            locale: true,
            reminderPreferences: { where: { courseId: s.courseId }, select: { feedbackEmails: true } },
          },
        },
      },
    });
    if (!students.length) return 0;
    const key = (userId: string) => `feedback:${s.id}:${userId}`;
    // Most runs find everyone already asked: skip them before writing anything.
    const asked = new Set(
      (await this.prisma.outboundEmail.findMany({ where: { dedupeKey: { in: students.map((e) => key(e.user.id)) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey),
    );
    const todo = students.filter((e) => !asked.has(key(e.user.id)));
    if (!todo.length) return 0;

    const path = `/learn/${s.course.slug}#session-${s.order}-feedback`;
    const messages: OutboxMessage[] = todo.map(({ user }) => {
      const locale: Locale = user.locale === 'ar' ? 'ar' : 'en';
      const ar = locale === 'ar';
      const optedOut = user.reminderPreferences[0]?.feedbackEmails === false;
      return {
        userId: user.id,
        locale,
        category: 'feedback',
        courseId: s.courseId,
        dedupeKey: key(user.id),
        ...(optedOut ? { skip: 'opted_out' } : {}),
        template: {
          name: 'feedbackPrompt',
          courseTitle: ar ? s.course.titleAr || s.course.titleEn : s.course.titleEn,
          sessionTitle: ar ? s.titleAr || s.titleEn : s.titleEn,
          sessionOrder: s.order,
          url: `${this.env.WEB_URL}/${locale}${path}`,
          courseUrl: last ? `${this.env.WEB_URL}/${locale}/learn/${s.course.slug}#course-feedback` : null,
          unsubscribeUrl: this.links.pageUrl(locale, 'feedback', user.id, s.courseId),
        },
      };
    });
    const t = texts(s, s.course, last);
    // The email row and the notification commit together: a key that exists means "asked".
    return this.prisma.$transaction(async (tx) => {
      const created = await this.outbox.enqueue(messages, tx);
      const users = todo.filter((e) => created.has(key(e.user.id))).map((e) => e.user.id);
      if (users.length) {
        await tx.notification.createMany({ data: users.map((userId) => ({ userId, type: 'feedback.prompt', ...t, link: path })) });
      }
      return users.length;
    });
  }
}
