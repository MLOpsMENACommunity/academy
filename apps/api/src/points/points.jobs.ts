import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BADGE_CODES, courseWeekRange, TOP_AWARD_RANK, type Ranked } from '@academy/shared';
import type { Badge, UserBadge } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from './leaderboard.service';
import { PointsService } from './points.service';

const DAY_MS = 86_400_000;
/** A closed week (or an ended course) is awarded within this many days, then left alone. */
const AWARD_WINDOW_DAYS = 14;
/** Live sessions that ended within this window give their speaker the "Speaker" badge. */
const SPEAKER_WINDOW_DAYS = 2;
/** Setting row (not admin-editable) that remembers when points started; written once by the job. */
export const POINTS_LAUNCH_KEY = 'pointsLaunchedAt';

/**
 * Hourly (idempotent: every award has a unique key, so running twice awards once):
 * - re-syncs assessment points for recently changed work (a safety net for the hooks);
 * - "Top of the week" for ranks 1–3 of each course week once it has closed;
 * - "Top of the course" for ranks 1–3 once the course has ended;
 * - "Speaker" when a speaker account's published live session has just ended.
 *
 * Only what the ledger fully covers is awarded: a week that started, or a course that
 * started, before points existed (the launch time) is never ranked, so the first run after
 * the deploy can't crown whoever happened to earn the first few points. A week or course
 * is awarded once (in the 14 days after it closes) and then never re-ranked, so a later
 * deletion or regrade doesn't hand a badge to the next student weeks afterwards.
 *
 * Owner decision: these badges go to the top students whether or not they opted into the
 * public board. A badge is private (dashboard, notification, email) unless the student opts
 * in, so awarding it reveals nothing; opting in later simply shows it.
 */
@Injectable()
export class PointsJobs {
  private readonly logger = new Logger(PointsJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly boards: LeaderboardService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.run();
  }

  /**
   * When points started: stored on the first run. If entries already exist (the feature ran
   * before this guard), the oldest entry marks the start instead of now.
   */
  async launchedAt(now = new Date()): Promise<Date> {
    const row = await this.prisma.setting.findUnique({ where: { key: POINTS_LAUNCH_KEY } });
    if (row && typeof row.value === 'string' && !Number.isNaN(Date.parse(row.value)))
      return new Date(row.value);
    const first = await this.prisma.pointsEntry.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const at = first && first.createdAt < now ? first.createdAt : now;
    await this.prisma.setting.upsert({
      where: { key: POINTS_LAUNCH_KEY },
      update: {},
      create: { key: POINTS_LAUNCH_KEY, value: at.toISOString() },
    });
    const stored = await this.prisma.setting.findUniqueOrThrow({
      where: { key: POINTS_LAUNCH_KEY },
    });
    return new Date(stored.value as string);
  }

  async run(now = new Date()): Promise<{
    pointsResynced: number;
    weeklyBadges: number;
    courseBadges: number;
    speakerBadges: number;
  }> {
    const pointsResynced = await this.points.sweepRecent(now);
    const launched = await this.launchedAt(now);
    const [topWeek, topCourse] = await Promise.all([
      this.prisma.badge.findUnique({ where: { code: BADGE_CODES.TOP_WEEK } }),
      this.prisma.badge.findUnique({ where: { code: BADGE_CODES.TOP_COURSE } }),
    ]);
    let weeklyBadges = 0;
    let courseBadges = 0;
    const courses = await this.prisma.course.findMany({
      where: { status: { notIn: ['DRAFT', 'ARCHIVED'] }, archivedAt: null, sessions: { some: {} } },
      select: { id: true, endDate: true },
    });
    for (const course of courses) {
      try {
        const r = await this.awardCourse(course, now, launched, topWeek, topCourse);
        weeklyBadges += r.weekly;
        courseBadges += r.course;
      } catch (err) {
        // One course failing must not stop the others; its awards are retried next hour.
        this.logger.error(`Leaderboard awards failed for a course: ${(err as Error).name}`);
      }
    }
    const speakerBadges = await this.speakerBadges(now, launched);
    if (weeklyBadges || courseBadges || speakerBadges)
      this.logger.log(
        `Awarded ${weeklyBadges} weekly, ${courseBadges} course and ${speakerBadges} speaker badge(s)`,
      );
    return { pointsResynced, weeklyBadges, courseBadges, speakerBadges };
  }

  private async awardCourse(
    course: { id: string; endDate: Date | null },
    now: Date,
    launched: Date,
    topWeek: Badge | null,
    topCourse: Badge | null,
  ): Promise<{ weekly: number; course: number }> {
    let weeklyBadges = 0;
    let courseBadges = 0;
    const clock = await this.boards.clock(course.id, course.endDate, now);
    if (!clock.firstSessionAt || !clock.currentWeek) return { weekly: 0, course: 0 };
    // Long over (its last week closed more than the award window ago): nothing left to award.
    if (clock.endsAt && now.getTime() - clock.endsAt.getTime() > (AWARD_WINDOW_DAYS + 7) * DAY_MS)
      return { weekly: 0, course: 0 };
    // Weeks and course awards already given (any award settles that week or course).
    const settled = await this.prisma.userBadge.findMany({
      where: {
        courseId: course.id,
        badgeId: { in: [topWeek?.id, topCourse?.id].filter((x): x is string => Boolean(x)) },
      },
      select: { badgeId: true, period: true },
      distinct: ['badgeId', 'period'],
    });
    const settledWeeks = new Set(
      settled.filter((b) => b.badgeId === topWeek?.id).map((b) => b.period),
    );
    const lastWeek = clock.totalWeeks ?? clock.currentWeek;
    if (topWeek?.active) {
      for (let week = 1; week <= lastWeek; week++) {
        const range = courseWeekRange(clock.firstSessionAt, week);
        if (range.end > now) break;
        if (
          range.start < launched ||
          settledWeeks.has(week) ||
          now.getTime() - range.end.getTime() > AWARD_WINDOW_DAYS * DAY_MS
        )
          continue;
        const top = (await this.boards.ranked(course, 'week', week, now, clock)).filter(
          (r) => r.rank <= TOP_AWARD_RANK,
        );
        weeklyBadges += await this.awardAll(topWeek, top, course.id, week);
      }
    }
    const courseStart = courseWeekRange(clock.firstSessionAt, 1).start;
    const courseSettled = settled.some((b) => b.badgeId === topCourse?.id);
    if (
      topCourse?.active &&
      clock.ended &&
      clock.endsAt &&
      !courseSettled &&
      courseStart >= launched &&
      now.getTime() - clock.endsAt.getTime() <= AWARD_WINDOW_DAYS * DAY_MS
    ) {
      const top = (await this.boards.ranked(course, 'course', null, now, clock)).filter(
        (r) => r.rank <= TOP_AWARD_RANK,
      );
      courseBadges += await this.awardAll(topCourse, top, course.id, null);
    }
    return { weekly: weeklyBadges, course: courseBadges };
  }

  /**
   * Gives one week's (or the course's) top students their badge all together: if any award
   * fails, the ones just created are removed again, so the week stays unsettled and is
   * retried next hour instead of being left half-awarded. Notifications go out at the end.
   */
  private async awardAll(
    badge: Badge,
    top: Ranked[],
    courseId: string,
    week: number | null,
  ): Promise<number> {
    const created: UserBadge[] = [];
    try {
      for (const r of top) {
        const award = await this.points.awardBadge(badge, r.userId, {
          courseId,
          period: week,
          reason: `${r.points} points, rank ${r.rank}`,
          notify: false,
        });
        if (award) created.push(award);
      }
    } catch (err) {
      await this.prisma.userBadge.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
      throw err;
    }
    for (const award of created) this.points.notify(badge, award);
    return created.length;
  }

  /**
   * "Speaker" for speaker accounts whose published session ended in the last two days (and
   * after points launched). It stays a manual badge: admins can give it to speakers without
   * an account, and a revoked one isn't given back unless a new session ends.
   */
  private async speakerBadges(now: Date, launched: Date): Promise<number> {
    const since = new Date(
      Math.max(now.getTime() - SPEAKER_WINDOW_DAYS * DAY_MS, launched.getTime()),
    );
    const events = await this.prisma.liveEvent.findMany({
      where: {
        status: 'PUBLISHED',
        // Sessions last at most a day: anything that ended since `since` started after this.
        startsAt: { gte: new Date(since.getTime() - DAY_MS), lte: now },
        speaker: { userId: { not: null }, user: { deletedAt: null } },
      },
      select: { startsAt: true, durationMin: true, speaker: { select: { userId: true } } },
    });
    const speaker = await this.prisma.badge.findUnique({ where: { code: BADGE_CODES.SPEAKER } });
    if (!speaker?.active) return 0;
    // An admin's revocation after a session ended wins over that session.
    const revoked = await this.prisma.auditLog.findMany({
      where: {
        action: 'badge.revoked',
        entityId: { in: events.map((e) => e.speaker!.userId!) },
        metadata: { path: ['code'], equals: BADGE_CODES.SPEAKER },
      },
      select: { entityId: true, createdAt: true },
    });
    let awarded = 0;
    const done = new Set<string>();
    for (const e of events) {
      const userId = e.speaker?.userId;
      const end = e.startsAt.getTime() + e.durationMin * 60_000;
      if (!userId || done.has(userId) || end > now.getTime() || end < since.getTime()) continue;
      if (revoked.some((r) => r.entityId === userId && r.createdAt.getTime() >= end)) continue;
      done.add(userId);
      if (await this.points.awardBadge(speaker, userId, { reason: 'Live session delivered' }))
        awarded++;
    }
    return awarded;
  }
}
