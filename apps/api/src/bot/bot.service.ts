import { Injectable } from '@nestjs/common';
import { BOT_ATTENDED_STATUSES, botActivityKind, practicalTaskDeadline, type BotActivityItem, type BotActivityQuery, type BotActivityResponse } from '@academy/shared';
import { PrismaService } from '../prisma/prisma.service';

/** An unanswered quiz that ran out of time is closed with empty answers; that isn't a submission. */
function answeredSomething(answers: unknown): boolean {
  return typeof answers === 'object' && answers !== null && Object.keys(answers).length > 0;
}

@Injectable()
export class BotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quiz submissions, practical tasks and attendance in the window, for enrolled students whose
   * accounts still exist. Only ids, the Telegram username, the course and timestamps leave here.
   */
  async activity({ from, to }: BotActivityQuery): Promise<BotActivityResponse> {
    const range = { gte: from, lt: to };
    const user = { select: { profile: { select: { telegramUsername: true } } } };
    const [submissions, attendance] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          // The first attempt is what counts, for a quiz taken twice and for a resubmitted lab.
          attempt: 1,
          submittedAt: { not: null },
          user: { deletedAt: null },
          // A resubmission overwrites submittedAt on a lab's single row; createdAt is the first hand-in.
          OR: [
            { submittedAt: range, assessment: { type: 'QUIZ' } },
            { createdAt: range, assessment: { type: { in: ['LAB', 'ASSIGNMENT'] } } },
          ],
        },
        select: {
          id: true,
          userId: true,
          answers: true,
          submittedAt: true,
          createdAt: true,
          user,
          assessment: {
            select: { id: true, type: true, courseId: true, dueAt: true, course: { select: { slug: true } }, session: { select: { startsAt: true } } },
          },
        },
      }),
      this.prisma.sessionAttendance.findMany({
        where: { status: { in: [...BOT_ATTENDED_STATUSES] }, user: { deletedAt: null }, session: { startsAt: range } },
        select: { userId: true, sessionId: true, user, session: { select: { startsAt: true, courseId: true, course: { select: { slug: true } } } } },
      }),
    ]);

    const courseIds = [...new Set([...submissions.map((s) => s.assessment.courseId), ...attendance.map((a) => a.session.courseId)])];
    const [enrollments, sessions] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { courseId: { in: courseIds } }, select: { userId: true, courseId: true } }),
      this.prisma.courseSession.findMany({ where: { courseId: { in: courseIds } }, select: { courseId: true, startsAt: true } }),
    ]);
    const enrolled = new Set(enrollments.map((e) => `${e.courseId}:${e.userId}`));
    const startsByCourse = new Map<string, Date[]>();
    for (const s of sessions) startsByCourse.set(s.courseId, [...(startsByCourse.get(s.courseId) ?? []), s.startsAt]);

    const items: BotActivityItem[] = [];
    for (const s of submissions) {
      const a = s.assessment;
      if (!enrolled.has(`${a.courseId}:${s.userId}`)) continue;
      const kind = botActivityKind(a.type, a.session !== null);
      if (kind === null) continue;
      if (a.type === 'QUIZ' && !answeredSomething(s.answers)) continue;
      const deadline = kind === 'PRACTICAL_TASK' && a.session ? practicalTaskDeadline(a.session.startsAt, startsByCourse.get(a.courseId) ?? [], a.dueAt) : null;
      items.push({
        id: `submission:${s.id}`,
        academyUserId: s.userId,
        telegramUsername: s.user.profile?.telegramUsername ?? null,
        courseSlug: a.course.slug,
        kind,
        occurredAt: (a.type === 'QUIZ' ? s.submittedAt! : s.createdAt).toISOString(),
        deadlineAt: deadline?.toISOString() ?? null,
      });
    }
    for (const r of attendance) {
      if (!enrolled.has(`${r.session.courseId}:${r.userId}`)) continue;
      items.push({
        id: `attendance:${r.sessionId}:${r.userId}`,
        academyUserId: r.userId,
        telegramUsername: r.user.profile?.telegramUsername ?? null,
        courseSlug: r.session.course.slug,
        kind: 'ATTENDANCE',
        occurredAt: r.session.startsAt.toISOString(),
        deadlineAt: null,
      });
    }
    items.sort((x, y) => x.occurredAt.localeCompare(y.occurredAt) || x.id.localeCompare(y.id));
    return { items };
  }
}
