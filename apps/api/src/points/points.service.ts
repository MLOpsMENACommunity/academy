import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  assessmentPoints,
  BADGE_CODES,
  badgeScopeKey,
  countedAttempt,
  ledgerDelta,
  parsePointsCsv,
  POINTS_SOURCES,
  type AdminStudentPointsDto,
  type ManualPointsInput,
  type MyPointsDto,
  type PointsEntryDto,
  type PointsImportResultDto,
  type PointsReason,
  type UserBadgeDto,
} from '@academy/shared';
import { Prisma, type Badge, type PointsEntry, type UserBadge } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const courseRef = { select: { slug: true, titleEn: true, titleAr: true } } as const;
type CourseRef = { slug: string; titleEn: string; titleAr: string };
type BadgeAward = UserBadge & { badge: Badge; course: CourseRef | null };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function toUserBadgeDto(b: BadgeAward): UserBadgeDto {
  return {
    id: b.id,
    badge: { code: b.badge.code, nameEn: b.badge.nameEn, nameAr: b.badge.nameAr, descriptionEn: b.badge.descriptionEn, descriptionAr: b.badge.descriptionAr, icon: b.badge.icon, kind: b.badge.kind },
    course: b.course,
    period: b.period,
    awardedAt: b.awardedAt.toISOString(),
    reason: b.reason,
  };
}

/**
 * The points ledger and badge awards.
 *
 * Points are append-only: automatic sources (an assessment's counted score, a completed
 * session, a certificate) are "synced": the service works out what the source should be
 * worth now and appends the difference (ledgerDelta), with a (student, source, sequence)
 * unique key so concurrent or repeated syncs never double-award.
 *
 * Integration point for certificates (PR C): call onCertificateIssued / onCertificateRevoked.
 */
@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------------ the ledger

  /** Appends whatever makes this source's entries add up to `target`. Returns the delta (0 = already right). */
  private async syncSource(
    s: { userId: string; courseId: string | null; sourceType: string; sourceId: string; reason: PointsReason },
    target: number | ((current: number) => number),
    now = new Date(),
  ): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entries = await this.prisma.pointsEntry.findMany({
        where: { userId: s.userId, sourceType: s.sourceType, sourceId: s.sourceId },
        select: { points: true, sourceSeq: true },
      });
      const current = entries.reduce((n, e) => n + e.points, 0);
      const delta = ledgerDelta(entries, typeof target === 'function' ? target(current) : target);
      if (!delta) return 0;
      try {
        await this.prisma.pointsEntry.create({
          data: { userId: s.userId, courseId: s.courseId, sourceType: s.sourceType, sourceId: s.sourceId, sourceSeq: delta.sourceSeq, reason: s.reason, points: delta.points, createdAt: now },
        });
        return delta.points;
      } catch (err) {
        // Another sync appended the same sequence number first: read again and recompute.
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return 0;
  }

  /**
   * An assessment's points for one student = its counted score (best or last attempt, per the
   * assessment's rule), as whole points; 0 while unpublished. A regrade or a better attempt
   * appends the difference. Also awards "Perfect score" for a 100% quiz.
   */
  async syncAssessment(assessmentId: string, userId: string, now = new Date()): Promise<number> {
    const a = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, courseId: true, type: true, status: true, scoring: true, maxPoints: true },
    });
    if (!a) return 0;
    const subs = await this.prisma.submission.findMany({
      where: { assessmentId, userId, submittedAt: { not: null } },
      select: { attempt: true, submittedAt: true, score: true, maxScore: true },
    });
    const counted = countedAttempt(subs, a.scoring);
    const target = a.status === 'PUBLISHED' ? assessmentPoints(counted?.score) : 0;
    const delta = await this.syncSource(
      { userId, courseId: a.courseId, sourceType: POINTS_SOURCES.ASSESSMENT, sourceId: a.id, reason: 'ASSESSMENT' },
      target,
      now,
    );
    if (a.type === 'QUIZ' && a.status === 'PUBLISHED' && subs.some((s) => s.score !== null && s.maxScore > 0 && s.score >= s.maxScore)) {
      await this.awardBadge(BADGE_CODES.PERFECT_SCORE, userId, { courseId: a.courseId });
    }
    return delta;
  }

  /** Every student with work on this assessment (after it's published or unpublished). */
  async syncAssessmentForAll(assessmentId: string): Promise<void> {
    const users = await this.prisma.submission.findMany({ where: { assessmentId, submittedAt: { not: null } }, distinct: ['userId'], select: { userId: true } });
    for (const { userId } of users) await this.syncAssessment(assessmentId, userId);
  }

  /** Never fails the caller: points are a side effect of grading, retried by the hourly sweep. */
  async syncAssessmentSafe(assessmentId: string, userId: string): Promise<void> {
    try {
      await this.syncAssessment(assessmentId, userId);
    } catch (err) {
      this.logger.error(`Points sync failed for an assessment: ${(err as Error).name}`);
    }
  }

  /**
   * Marking a session done is worth the sessionCompletedPoints setting; unmarking takes it
   * back (a negative entry). Marking every session of the course awards "Finisher".
   */
  async syncSession(userId: string, sessionId: string, completed: boolean): Promise<void> {
    try {
      const session = await this.prisma.courseSession.findUnique({ where: { id: sessionId }, select: { courseId: true } });
      if (!session) return;
      const { sessionCompletedPoints } = await this.settings.get();
      await this.syncSource(
        { userId, courseId: session.courseId, sourceType: POINTS_SOURCES.SESSION, sourceId: sessionId, reason: 'SESSION_COMPLETED' },
        // Keep what was given before if the setting changed since.
        (current) => (completed ? (current > 0 ? current : sessionCompletedPoints) : 0),
      );
      if (completed) await this.checkFinisher(userId, session.courseId);
    } catch (err) {
      this.logger.error(`Points sync failed for a session: ${(err as Error).name}`);
    }
  }

  async checkFinisher(userId: string, courseId: string): Promise<boolean> {
    const [total, done] = await Promise.all([
      this.prisma.courseSession.count({ where: { courseId } }),
      this.prisma.sessionProgress.count({ where: { userId, session: { courseId } } }),
    ]);
    if (!total || done < total) return false;
    return Boolean(await this.awardBadge(BADGE_CODES.FINISHER, userId, { courseId }));
  }

  /**
   * Certificates (PR C) call this once a certificate is issued: the certificatePoints bonus
   * and the "Certified" badge. Idempotent, so calling it twice is harmless.
   */
  async onCertificateIssued(userId: string, courseId: string, certificateId: string): Promise<void> {
    const { certificatePoints } = await this.settings.get();
    await this.syncSource(
      { userId, courseId, sourceType: POINTS_SOURCES.CERTIFICATE, sourceId: certificateId, reason: 'CERTIFICATE' },
      (current) => (current > 0 ? current : certificatePoints),
    );
    await this.awardBadge(BADGE_CODES.CERTIFIED, userId, { courseId });
  }

  /** A revoked certificate takes its bonus and the "Certified" badge back. */
  async onCertificateRevoked(userId: string, courseId: string, certificateId: string): Promise<void> {
    await this.syncSource({ userId, courseId, sourceType: POINTS_SOURCES.CERTIFICATE, sourceId: certificateId, reason: 'CERTIFICATE' }, 0);
    await this.prisma.userBadge.deleteMany({ where: { userId, badge: { code: BADGE_CODES.CERTIFIED }, scopeKey: badgeScopeKey(courseId) } });
  }

  /** Hourly safety net: re-syncs work graded or changed recently (a missed hook, a crash). */
  async sweepRecent(now = new Date(), hours = 26): Promise<number> {
    const recent = await this.prisma.submission.findMany({
      where: { submittedAt: { not: null }, updatedAt: { gte: new Date(now.getTime() - hours * 3_600_000) } },
      distinct: ['assessmentId', 'userId'],
      select: { assessmentId: true, userId: true },
      take: 5000,
    });
    let changed = 0;
    for (const r of recent) if ((await this.syncAssessment(r.assessmentId, r.userId, now)) !== 0) changed++;
    return changed;
  }

  // ------------------------------------------------------------------ badges

  /**
   * Gives a badge once per scope (see badgeScopeKey) and tells the student in-app and by
   * email (bulk lane). Returns null when they already hold it or the badge is inactive.
   */
  async awardBadge(
    codeOrBadge: string | Badge,
    userId: string,
    opts: { courseId?: string | null; period?: number | null; awardedById?: string | null; reason?: string | null; now?: Date } = {},
  ): Promise<UserBadge | null> {
    const badge = typeof codeOrBadge === 'string' ? await this.prisma.badge.findUnique({ where: { code: codeOrBadge } }) : codeOrBadge;
    if (!badge?.active) return null;
    const courseId = opts.courseId ?? null;
    let award: UserBadge;
    try {
      award = await this.prisma.userBadge.create({
        data: {
          userId,
          badgeId: badge.id,
          courseId,
          period: opts.period ?? null,
          scopeKey: badgeScopeKey(courseId, opts.period ?? null),
          awardedById: opts.awardedById ?? null,
          reason: opts.reason ?? null,
          ...(opts.now ? { awardedAt: opts.now } : {}),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
    void this.tellBadge(badge, award).catch((err: unknown) => this.logger.error(`Badge notification failed: ${(err as Error).name}`));
    return award;
  }

  private async tellBadge(badge: Badge, award: UserBadge): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: award.userId }, select: { email: true, locale: true, deletedAt: true } });
    if (!user || user.deletedAt) return;
    const course = award.courseId ? await this.prisma.course.findUnique({ where: { id: award.courseId }, ...courseRef }) : null;
    const week = award.period ? { en: ` (week ${award.period})`, ar: ` (الأسبوع ${award.period})` } : { en: '', ar: '' };
    await this.notifications.create(award.userId, {
      type: 'badge.awarded',
      titleEn: `New badge: ${badge.icon} ${badge.nameEn}${week.en}`,
      titleAr: `شارة جديدة: ${badge.icon} ${badge.nameAr}${week.ar}`,
      bodyEn: course ? `${badge.descriptionEn} ${course.titleEn}.`.trim() : badge.descriptionEn,
      bodyAr: course ? `${badge.descriptionAr} ${course.titleAr}.`.trim() : badge.descriptionAr,
      link: '/dashboard#points',
    });
    const ar = user.locale === 'ar';
    void this.email.send(
      user.email,
      user.locale,
      {
        name: 'badgeAwarded',
        icon: badge.icon,
        badgeName: (ar ? badge.nameAr : badge.nameEn) + (ar ? week.ar : week.en),
        description: ar ? badge.descriptionAr : badge.descriptionEn,
        courseTitle: course ? (ar ? course.titleAr : course.titleEn) : null,
        url: this.email.url(user.locale, '/dashboard#points'),
      },
      { bulk: true },
    );
  }

  // ------------------------------------------------------------------ admin: manual points

  private async student(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException('Student not found');
    return user;
  }

  private async checkCourse(courseId: string | null): Promise<void> {
    if (!courseId) return;
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!c) throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'courseId', message: 'Unknown course' }] });
  }

  /** Points added or taken away by an admin, with a reason and a note. Audited; the student is told in-app. */
  async addManual(userId: string, input: ManualPointsInput, admin: Actor): Promise<PointsEntryDto> {
    await this.student(userId);
    await this.checkCourse(input.courseId);
    const entry = await this.prisma.$transaction(async (tx) => {
      const e = await tx.pointsEntry.create({
        data: { userId, courseId: input.courseId, points: input.points, reason: input.reason, note: input.note, awardedById: admin.id },
        include: { course: courseRef },
      });
      await this.audit.log(
        { actorId: admin.id, action: 'points.awarded', entityType: 'User', entityId: userId, metadata: { entryId: e.id, points: input.points, reason: input.reason, courseId: input.courseId } },
        tx,
      );
      return e;
    });
    if (input.points > 0) {
      void this.notifications
        .create(userId, {
          type: 'points.awarded',
          titleEn: `+${input.points} points`,
          titleAr: `+${input.points} نقطة`,
          bodyEn: input.note,
          bodyAr: input.note,
          link: '/dashboard#points',
        })
        .catch(() => undefined);
    }
    return (await this.entryDtos([entry]))[0]!;
  }

  /**
   * Community points from a CSV (email, points, note, course slug). A dry run validates every
   * row and shows what would happen; applying needs a file without errors and is audited.
   */
  async importCsv(csv: string, dryRun: boolean, admin: Actor): Promise<PointsImportResultDto> {
    const parsed = parsePointsCsv(csv);
    const emails = [...new Set(parsed.rows.map((r) => r.email))];
    const slugs = [...new Set(parsed.rows.map((r) => r.courseSlug).filter((s): s is string => Boolean(s)))];
    const [users, courses] = await Promise.all([
      this.prisma.user.findMany({ where: { email: { in: emails, mode: 'insensitive' }, deletedAt: null }, select: { id: true, email: true } }),
      this.prisma.course.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }),
    ]);
    const userBy = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const courseBy = new Map(courses.map((c) => [c.slug, c.id]));
    const rows: PointsImportResultDto['rows'] = parsed.errors.map((e) => ({ line: e.line, email: '', points: 0, note: null, course: null, status: 'error' as const, message: e.message }));
    const ready: Prisma.PointsEntryCreateManyInput[] = [];
    for (const r of parsed.rows) {
      const row = { line: r.line, email: r.email, points: r.points, note: r.note, course: r.courseSlug };
      const userId = userBy.get(r.email);
      const courseId = r.courseSlug ? courseBy.get(r.courseSlug) : null;
      if (!userId) rows.push({ ...row, status: 'error', message: 'No student with this email' });
      else if (courseId === undefined) rows.push({ ...row, status: 'error', message: 'No course with this slug' });
      else {
        rows.push({ ...row, status: 'ok' });
        ready.push({ userId, courseId, points: r.points, reason: 'MANUAL_COMMUNITY', note: r.note ?? 'Community points (import)', awardedById: admin.id });
      }
    }
    rows.sort((a, b) => a.line - b.line);
    const errors = rows.filter((r) => r.status === 'error').length;
    const result = { dryRun, rows, ok: ready.length, errors, totalPoints: ready.reduce((n, r) => n + r.points, 0), applied: 0 };
    if (dryRun) return result;
    if (errors) throw new ConflictException({ code: 'IMPORT_HAS_ERRORS', message: 'Fix the rows with errors (see the preview) and import again' });
    if (!ready.length) throw new BadRequestException({ code: 'IMPORT_EMPTY', message: 'The file has no rows to import' });
    await this.prisma.$transaction(async (tx) => {
      await tx.pointsEntry.createMany({ data: ready });
      await this.audit.log({ actorId: admin.id, action: 'points.imported', entityType: 'PointsEntry', metadata: { rows: ready.length, totalPoints: result.totalPoints } }, tx);
    });
    return { ...result, applied: ready.length };
  }

  // ------------------------------------------------------------------ reading

  /** Labels for automatic entries come from their source (assessment, session or course title). */
  private async entryDtos(entries: (PointsEntry & { course: CourseRef | null })[]): Promise<PointsEntryDto[]> {
    const ids = (type: string) => [...new Set(entries.filter((e) => e.sourceType === type && e.sourceId).map((e) => e.sourceId!))];
    const [assessments, sessions] = await Promise.all([
      this.prisma.assessment.findMany({ where: { id: { in: ids(POINTS_SOURCES.ASSESSMENT) } }, select: { id: true, titleEn: true, titleAr: true } }),
      this.prisma.courseSession.findMany({ where: { id: { in: ids(POINTS_SOURCES.SESSION) } }, select: { id: true, titleEn: true, titleAr: true, order: true } }),
    ]);
    const titles = new Map<string, { en: string; ar: string }>([
      ...assessments.map((a) => [a.id, { en: a.titleEn, ar: a.titleAr || a.titleEn }] as const),
      ...sessions.map((s) => [s.id, { en: `${s.order}. ${s.titleEn}`, ar: `${s.order}. ${s.titleAr || s.titleEn}` }] as const),
    ]);
    return entries.map((e) => {
      const title = e.sourceId ? titles.get(e.sourceId) : undefined;
      return {
        id: e.id,
        points: e.points,
        reason: e.reason,
        note: e.note,
        label: title ?? null,
        adjustment: e.sourceSeq > 0,
        course: e.course,
        createdAt: e.createdAt.toISOString(),
      };
    });
  }

  private async badgesOf(userId: string): Promise<BadgeAward[]> {
    return this.prisma.userBadge.findMany({ where: { userId }, include: { badge: true, course: courseRef }, orderBy: { awardedAt: 'desc' } });
  }

  private async totals(userId: string) {
    const [total, byCourse] = await Promise.all([
      this.prisma.pointsEntry.aggregate({ where: { userId }, _sum: { points: true } }),
      this.prisma.pointsEntry.groupBy({ by: ['courseId'], where: { userId, courseId: { not: null } }, _sum: { points: true } }),
    ]);
    const courses = await this.prisma.course.findMany({ where: { id: { in: byCourse.map((c) => c.courseId!) } }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    const sums = new Map(byCourse.map((c) => [c.courseId!, c._sum.points ?? 0]));
    return { total: total._sum.points ?? 0, courses: courses.map((c) => ({ ...c, points: sums.get(c.id) ?? 0 })) };
  }

  /** The dashboard card: total, per course, the latest entries and every badge. */
  async mine(userId: string): Promise<MyPointsDto> {
    const [{ total, courses }, recent, badges] = await Promise.all([
      this.totals(userId),
      this.prisma.pointsEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6, include: { course: courseRef } }),
      this.badgesOf(userId),
    ]);
    return {
      total,
      courses: courses.map(({ id: _id, ...c }) => c),
      recent: await this.entryDtos(recent),
      badges: badges.map(toUserBadgeDto),
    };
  }

  /** The full history (profile page). */
  async history(userId: string): Promise<PointsEntryDto[]> {
    const entries = await this.prisma.pointsEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500, include: { course: courseRef } });
    return this.entryDtos(entries);
  }

  async adminStudent(userId: string): Promise<AdminStudentPointsDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Student not found');
    const [{ total, courses }, entries, badges, enrolled] = await Promise.all([
      this.totals(userId),
      this.prisma.pointsEntry.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        include: { course: courseRef, awardedBy: { select: { email: true, profile: { select: { fullNameEn: true } } } } },
      }),
      this.prisma.userBadge.findMany({
        where: { userId },
        include: { badge: true, course: courseRef, awardedBy: { select: { email: true, profile: { select: { fullNameEn: true } } } } },
        orderBy: { awardedAt: 'desc' },
      }),
      this.prisma.enrollment.findMany({ where: { userId }, select: { course: { select: { id: true, slug: true, titleEn: true, titleAr: true } } }, orderBy: { enrolledAt: 'desc' } }),
    ]);
    const dtos = await this.entryDtos(entries);
    const who = (u: { email: string; profile: { fullNameEn: string | null } | null } | null) => (u ? (u.profile?.fullNameEn ?? u.email) : null);
    return {
      total,
      courses,
      entries: dtos.map((d, i) => ({ ...d, sourceType: entries[i]!.sourceType, awardedBy: who(entries[i]!.awardedBy) })),
      badges: badges.map((b) => ({ ...toUserBadgeDto(b), awardedBy: who(b.awardedBy) })),
      enrolledCourses: enrolled.map((e) => e.course),
    };
  }
}
