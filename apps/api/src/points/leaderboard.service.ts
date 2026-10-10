import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  boardName,
  courseEndsAt,
  courseWeekCount,
  courseWeekOf,
  courseWeekRange,
  LEADERBOARD_SIZE,
  rankStandings,
  toCsv,
  type AdminLeaderboardDto,
  type LeaderboardDto,
  type LeaderboardQuery,
  type Ranked,
  type Standing,
} from '@academy/shared';
import type { Course } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import type { AuthUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { capRows } from '../admin/export';

/** A course's calendar for boards: when week 1 starts, when it ends, which week it is. */
export interface CourseClock {
  firstSessionAt: Date | null;
  endsAt: Date | null;
  totalWeeks: number | null;
  /** The week now falls in, capped at the last week; null before week 1. */
  currentWeek: number | null;
  ended: boolean;
}

/**
 * Per-course leaderboards. Course points = assessment points + completed sessions + manual
 * points tagged to the course. "This week" counts entries created in that course week
 * (Cairo time); "whole course" counts all of them.
 *
 * Boards name only students who opted in (first name + last initial); everyone else is
 * counted but not named. Ranks on the board are among the students shown. A student who
 * hasn't opted in still sees, privately, where they would stand.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async clock(courseId: string, endDate: Date | null, now = new Date()): Promise<CourseClock> {
    const [first, last] = await Promise.all([
      // Week 1 starts with the first session in the course order.
      this.prisma.courseSession.findFirst({ where: { courseId }, orderBy: [{ order: 'asc' }, { startsAt: 'asc' }], select: { startsAt: true } }),
      this.prisma.courseSession.findFirst({ where: { courseId }, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }),
    ]);
    const firstSessionAt = first?.startsAt ?? null;
    const endsAt = courseEndsAt({ endDate, lastSessionAt: last?.startsAt ?? null });
    if (!firstSessionAt) return { firstSessionAt, endsAt, totalWeeks: null, currentWeek: null, ended: Boolean(endsAt && endsAt <= now) };
    const totalWeeks = courseWeekCount(firstSessionAt, endsAt);
    const week = courseWeekOf(firstSessionAt, now);
    const currentWeek = week === null ? null : totalWeeks ? Math.min(week, totalWeeks) : week;
    return { firstSessionAt, endsAt, totalWeeks, currentWeek, ended: Boolean(endsAt && endsAt <= now) };
  }

  /** Points per enrolled (not deleted) student in the course, optionally within a time range. */
  async standings(courseId: string, range?: { start: Date; end: Date }): Promise<Standing[]> {
    const rows = await this.prisma.pointsEntry.groupBy({
      by: ['userId'],
      where: {
        courseId,
        ...(range ? { createdAt: { gte: range.start, lt: range.end } } : {}),
        user: { deletedAt: null, enrollments: { some: { courseId } } },
      },
      _sum: { points: true },
      _max: { createdAt: true },
    });
    return rows.map((r) => ({ userId: r.userId, points: r._sum.points ?? 0, reachedAt: r._max.createdAt ?? new Date(0) }));
  }

  /** Top students of a course week or the whole course, for awards (opt-in doesn't matter: badges are private). */
  async ranked(course: Pick<Course, 'id' | 'endDate'>, scope: 'week' | 'course', week: number | null, now = new Date(), known?: CourseClock): Promise<Ranked[]> {
    const clock = known ?? (await this.clock(course.id, course.endDate, now));
    if (scope === 'week') {
      if (!clock.firstSessionAt || !week) return [];
      return rankStandings(await this.standings(course.id, courseWeekRange(clock.firstSessionAt, week)));
    }
    return rankStandings(await this.standings(course.id));
  }

  private weeksDto(clock: CourseClock, week: number | null): LeaderboardDto['weeks'] {
    const range = clock.firstSessionAt && week ? courseWeekRange(clock.firstSessionAt, week) : null;
    return {
      current: clock.ended ? null : clock.currentWeek,
      available: clock.currentWeek ?? 0,
      total: clock.totalWeeks,
      start: range?.start.toISOString() ?? null,
      end: range?.end.toISOString() ?? null,
    };
  }

  /** The week shown: the one asked for (if it has started), otherwise this week (or the last one). */
  private pickWeek(clock: CourseClock, q: LeaderboardQuery): number | null {
    if (q.scope !== 'week' || !clock.currentWeek) return null;
    return q.week && q.week <= clock.currentWeek ? q.week : clock.currentWeek;
  }

  private async load(course: Pick<Course, 'id' | 'endDate'>, q: LeaderboardQuery, now: Date) {
    const clock = await this.clock(course.id, course.endDate, now);
    const week = this.pickWeek(clock, q);
    const standings =
      q.scope === 'week'
        ? week && clock.firstSessionAt
          ? await this.standings(course.id, courseWeekRange(clock.firstSessionAt, week))
          : []
        : await this.standings(course.id);
    const [optIns, total] = await Promise.all([
      this.prisma.leaderboardOptIn.findMany({ where: { courseId: course.id, optedIn: true, user: { deletedAt: null, enrollments: { some: { courseId: course.id } } } }, select: { userId: true } }),
      this.prisma.enrollment.count({ where: { courseId: course.id, user: { deletedAt: null } } }),
    ]);
    return { clock, week, standings, optedIn: new Set(optIns.map((o) => o.userId)), total };
  }

  private async names(userIds: string[]): Promise<Map<string, { full: string | null }>> {
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, fullNameEn: true, fullNameAr: true } });
    return new Map(profiles.map((p) => [p.userId, { full: p.fullNameEn || p.fullNameAr || null }]));
  }

  private async badges(courseId: string, userIds: string[]) {
    const awards = await this.prisma.userBadge.findMany({
      where: { courseId, userId: { in: userIds }, badge: { active: true } },
      include: { badge: { select: { code: true, icon: true, nameEn: true, nameAr: true } } },
      orderBy: { awardedAt: 'asc' },
    });
    const out = new Map<string, LeaderboardDto['rows'][number]['badges']>();
    for (const a of awards) {
      const list = out.get(a.userId) ?? [];
      list.push({ code: a.badge.code, icon: a.badge.icon, nameEn: a.badge.nameEn, nameAr: a.badge.nameAr, period: a.period });
      out.set(a.userId, list);
    }
    return out;
  }

  /** GET /learn/:slug/leaderboard: enrolled students and admins only. */
  async board(user: AuthUser, slug: string, q: LeaderboardQuery, now = new Date()): Promise<LeaderboardDto> {
    const course = await this.prisma.course.findUnique({ where: { slug } });
    if (!course) throw new NotFoundException('Course not found');
    const enrolled = Boolean(await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, select: { id: true } }));
    if (!enrolled && user.role !== 'ADMIN') throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    const { clock, week, standings, optedIn, total } = await this.load(course, q, now);
    const shown = rankStandings(standings.filter((s) => optedIn.has(s.userId)));
    const top = shown.slice(0, LEADERBOARD_SIZE);
    const [names, badges] = await Promise.all([this.names(top.map((r) => r.userId)), this.badges(course.id, top.map((r) => r.userId))]);

    let me: LeaderboardDto['me'] = null;
    if (enrolled) {
      const mine = standings.find((s) => s.userId === user.id);
      const isIn = optedIn.has(user.id);
      // Not on the board: where they would be if they joined (only they see this).
      const ranks = isIn ? shown : rankStandings([...standings.filter((s) => optedIn.has(s.userId)), ...(mine ? [mine] : [])]);
      me = { rank: ranks.find((r) => r.userId === user.id)?.rank ?? null, points: mine?.points ?? 0, optedIn: isIn };
    }
    return {
      scope: q.scope,
      week,
      weeks: this.weeksDto(clock, week),
      courseEnded: clock.ended,
      rows: top.map((r) => ({ rank: r.rank, name: boardName(names.get(r.userId)?.full), points: r.points, badges: badges.get(r.userId) ?? [], me: r.userId === user.id })),
      me,
      participants: optedIn.size,
      total,
    };
  }

  async setOptIn(user: AuthUser, slug: string, optedIn: boolean): Promise<{ optedIn: boolean }> {
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true } });
    if (!course) throw new NotFoundException('Course not found');
    const enrolled = await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, select: { id: true } });
    if (!enrolled) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    await this.prisma.leaderboardOptIn.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      update: { optedIn },
      create: { userId: user.id, courseId: course.id, optedIn },
    });
    return { optedIn };
  }

  // ------------------------------------------------------------------ admin

  /** Everyone enrolled, ranked among all students (opted in or not), with zero-point students last. */
  async adminBoard(courseId: string, q: LeaderboardQuery, now = new Date()): Promise<AdminLeaderboardDto> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    const { clock, week, standings, optedIn, total } = await this.load(course, q, now);
    const ranked = rankStandings(standings);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { courseId, user: { deletedAt: null } },
      select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } } },
      take: 5000,
    });
    const byId = new Map(enrolled.map((e) => [e.user.id, e.user]));
    const badges = await this.badges(courseId, [...byId.keys()]);
    const rankedIds = new Set(ranked.map((r) => r.userId));
    const rest = enrolled.filter((e) => !rankedIds.has(e.user.id));
    const points = new Map(standings.map((s) => [s.userId, s.points]));
    const rows = [
      ...ranked.map((r) => ({ userId: r.userId, rank: r.rank as number | null })),
      ...rest.map((e) => ({ userId: e.user.id, rank: null })),
    ]
      .filter((r) => byId.has(r.userId))
      .map((r) => {
        const u = byId.get(r.userId)!;
        return {
          rank: r.rank,
          userId: r.userId,
          name: u.profile?.fullNameEn || u.profile?.fullNameAr || null,
          email: u.email,
          points: points.get(r.userId) ?? 0,
          optedIn: optedIn.has(r.userId),
          badges: (badges.get(r.userId) ?? []).map((b) => (b.period ? `${b.icon} ${b.nameEn} (week ${b.period})` : `${b.icon} ${b.nameEn}`)),
        };
      });
    return { scope: q.scope, week, weeks: this.weeksDto(clock, week), courseEnded: clock.ended, rows, participants: optedIn.size, total };
  }

  async adminCsv(courseId: string, q: LeaderboardQuery, admin: Actor): Promise<string> {
    const board = await this.adminBoard(courseId, q);
    await this.audit.log({ actorId: admin.id, action: 'leaderboard.exported', entityType: 'Course', entityId: courseId, metadata: { scope: q.scope, week: board.week, count: board.rows.length } });
    return toCsv(
      ['Rank', 'Name', 'Email', 'Points', 'On the public board', 'Badges'],
      capRows(board.rows, (r) => [r.rank ?? '', r.name ?? '', r.email, r.points, r.optedIn ? 'yes' : 'no', r.badges.join('; ')]),
    );
  }
}
