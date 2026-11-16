import {
  assessmentResult,
  DEFAULT_TIMEZONE,
  isRequiredLesson,
  isValidTimezone,
  planSchedule,
  SELF_PACED_PASS_PERCENT,
  STUDY_PLAN_QUIZ_MINUTES,
  type StudyItem,
  type StudySchedule,
} from '@academy/shared';
import type { Prisma, StudyPlan } from '@prisma/client';
import { completedLessonsBy } from '../attendance/completed-sessions';

export interface StudyItemTitle {
  titleEn: string;
  titleAr: string;
}

export interface CourseStudyItems {
  /** Each student's items in course order, with what they have done. */
  byUser: Map<string, StudyItem[]>;
  titles: Map<string, StudyItemTitle>;
}

/** The time zone a plan's dates and reminder hour use: the profile's, else the academy's (Cairo). */
export function planTimezone(profileTimezone: string | null | undefined): string {
  return profileTimezone && isValidTimezone(profileTimezone) ? profileTimezone : DEFAULT_TIMEZONE;
}

/** A plan row's start date ('YYYY-MM-DD'; Prisma returns a DATE column as UTC midnight). */
export const planStartDate = (p: Pick<StudyPlan, 'startDate'>) => p.startDate.toISOString().slice(0, 10);

/** A plan row's rules, for planSchedule. */
export const planRules = (p: Pick<StudyPlan, 'weekdays' | 'minutesPerDay' | 'startDate'>) => ({ weekdays: p.weekdays, minutesPerDay: p.minutesPerDay, startDate: planStartDate(p) });

/** The schedule from `today`, and the plan's status against it. */
export function scheduleOf(plan: Pick<StudyPlan, 'weekdays' | 'minutesPerDay' | 'startDate'>, items: StudyItem[], today: string): { schedule: StudySchedule; onTrack: boolean; behindBy: number } {
  const schedule = planSchedule({ ...planRules(plan), items, today });
  const status = schedule.status(today, items.filter((i) => i.done).length);
  return { schedule, onTrack: status.onTrack, behindBy: status.behindBy };
}

/**
 * What a self-paced course's study plans schedule, per student: every required video lesson (its
 * video length, CourseSession.durationMin) and every published assessment that counts for the
 * certificate (STUDY_PLAN_QUIZ_MINUTES each), in course order: each lesson is followed by its
 * assessments, course-level ones come last. Done means the same as for the certificate: the
 * lesson completed in the player, the assessment passed with at least SELF_PACED_PASS_PERCENT.
 */
export async function loadStudyItems(db: Prisma.TransactionClient, courseId: string, userIds: string[]): Promise<CourseStudyItems> {
  const [sessions, assessments] = await Promise.all([
    db.courseSession.findMany({
      where: { courseId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, titleEn: true, titleAr: true, durationMin: true, recordingUrl: true, optional: true },
    }),
    db.assessment.findMany({
      where: { courseId, status: 'PUBLISHED', countsForCertificate: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const lessons = sessions.filter(isRequiredLesson);
  const [completed, submissions] = await Promise.all([
    completedLessonsBy(db, lessons.map((l) => l.id), userIds),
    userIds.length && assessments.length
      ? db.submission.findMany({
          where: { assessmentId: { in: assessments.map((a) => a.id) }, userId: { in: userIds }, submittedAt: { not: null } },
          select: { assessmentId: true, userId: true, attempt: true, submittedAt: true, score: true, late: true },
        })
      : Promise.resolve([]),
  ]);

  // Course order, with titles.
  const titles = new Map<string, StudyItemTitle>();
  const order: { id: string; kind: 'lesson' | 'quiz'; minutes: number }[] = [];
  const bySession = new Map<string, typeof assessments>();
  const sessionIds = new Set(sessions.map((s) => s.id));
  for (const a of assessments) {
    const key = a.sessionId && sessionIds.has(a.sessionId) ? a.sessionId : '';
    bySession.set(key, [...(bySession.get(key) ?? []), a]);
  }
  const addQuizzes = (key: string) => {
    for (const a of bySession.get(key) ?? []) {
      titles.set(a.id, { titleEn: a.titleEn, titleAr: a.titleAr || a.titleEn });
      order.push({ id: a.id, kind: 'quiz', minutes: STUDY_PLAN_QUIZ_MINUTES });
    }
  };
  const required = new Set(lessons.map((l) => l.id));
  for (const s of sessions) {
    if (required.has(s.id)) {
      titles.set(s.id, { titleEn: s.titleEn, titleAr: s.titleAr || s.titleEn });
      order.push({ id: s.id, kind: 'lesson', minutes: Math.max(1, s.durationMin) });
    }
    addQuizzes(s.id);
  }
  addQuizzes('');

  const byUser = new Map<string, StudyItem[]>();
  for (const userId of userIds) {
    const mine = submissions.filter((x) => x.userId === userId);
    const passed = new Set(
      assessments
        .filter((a) => {
          const r = assessmentResult(a, mine.filter((x) => x.assessmentId === a.id));
          return r.passed && r.percent !== null && r.percent + 1e-9 >= SELF_PACED_PASS_PERCENT;
        })
        .map((a) => a.id),
    );
    const lessonsDone = completed.get(userId) ?? new Set<string>();
    byUser.set(
      userId,
      order.map((i) => ({ ...i, done: i.kind === 'lesson' ? lessonsDone.has(i.id) : passed.has(i.id) })),
    );
  }
  return { byUser, titles };
}
