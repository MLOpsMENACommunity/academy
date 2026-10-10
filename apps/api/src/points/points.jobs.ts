import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BADGE_CODES, courseWeekRange, TOP_AWARD_RANK } from '@academy/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from './leaderboard.service';
import { PointsService } from './points.service';

/** Courses are checked for awards until this long after they end. */
const AWARD_WINDOW_DAYS = 60;

/**
 * Hourly (idempotent: every award has a unique key, so running twice awards once):
 * - re-syncs assessment points for recently changed work (a safety net for the hooks);
 * - "Top of the week" for ranks 1–3 of each course week once it has closed;
 * - "Top of the course" for ranks 1–3 once the course has ended.
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

  async run(now = new Date()): Promise<{ pointsResynced: number; weeklyBadges: number; courseBadges: number }> {
    const pointsResynced = await this.points.sweepRecent(now);
    let weeklyBadges = 0;
    let courseBadges = 0;
    const courses = await this.prisma.course.findMany({
      where: { status: { notIn: ['DRAFT', 'ARCHIVED'] }, archivedAt: null, sessions: { some: {} } },
      select: { id: true, endDate: true },
    });
    for (const course of courses) {
      const clock = await this.boards.clock(course.id, course.endDate, now);
      if (!clock.firstSessionAt || !clock.currentWeek) continue;
      if (clock.endsAt && now.getTime() - clock.endsAt.getTime() > AWARD_WINDOW_DAYS * 86_400_000) continue;
      // Every course week that has closed (its end has passed), within the course.
      const lastWeek = clock.totalWeeks ?? clock.currentWeek;
      for (let week = 1; week <= lastWeek; week++) {
        if (courseWeekRange(clock.firstSessionAt, week).end > now) break;
        const top = (await this.boards.ranked(course, 'week', week, now)).filter((r) => r.rank <= TOP_AWARD_RANK);
        for (const r of top) {
          if (await this.points.awardBadge(BADGE_CODES.TOP_WEEK, r.userId, { courseId: course.id, period: week, reason: `${r.points} points, rank ${r.rank}` })) weeklyBadges++;
        }
      }
      if (clock.ended) {
        const top = (await this.boards.ranked(course, 'course', null, now)).filter((r) => r.rank <= TOP_AWARD_RANK);
        for (const r of top) {
          if (await this.points.awardBadge(BADGE_CODES.TOP_COURSE, r.userId, { courseId: course.id, reason: `${r.points} points, rank ${r.rank}` })) courseBadges++;
        }
      }
    }
    if (weeklyBadges || courseBadges) this.logger.log(`Awarded ${weeklyBadges} weekly and ${courseBadges} course leaderboard badge(s)`);
    return { pointsResynced, weeklyBadges, courseBadges };
  }
}
