import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ADMIN_POINTS_CAP,
  assessmentPoints,
  BADGE_CODES,
  badgeScopeKey,
  countedAttempt,
  ledgerDelta,
  ledgerTotal,
  parsePointsCsv,
  POINTS_SOURCES,
  type AdminStudentPointsDto,
  type CourseStudentPointsDto,
  type LedgerEntryDto,
  type ManualPointsInput,
  type PointsEditInput,
  type MyPointsDto,
  type PointsEntryDto,
  type PointsImportResultDto,
  type PointsReason,
  type PointsVoidInput,
  type UserBadgeDto,
} from '@academy/shared';
import { createHash } from 'node:crypto';
import { Prisma, type Badge, type PointsEntry, type UserBadge } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { completedSessionsBy } from '../attendance/completed-sessions';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const courseRef = { select: { slug: true, titleEn: true, titleAr: true } } as const;
type CourseRef = { slug: string; titleEn: string; titleAr: string };
type BadgeAward = UserBadge & { badge: Badge; course: CourseRef | null };
type Person = { email: string; profile: { fullNameEn: string | null } | null; speakerProfile?: { name: string } | null } | null;
const person = { select: { email: true, profile: { select: { fullNameEn: true } }, speakerProfile: { select: { name: true } } } } as const;

/** Entries that count: not voided. Every total, board and source sync reads through this. */
export const COUNTED = { voidedAt: null } as const;

/**
 * Where a points change is made from. Admins (ACADEMIC or SUPER): any student, any entry, up to
 * ±ADMIN_POINTS_CAP. A teaching speaker: only entries tagged with their course, for students
 * enrolled in it, and only up to the speaker cap (both the old and the new value).
 */
export type PointsScope = { kind: 'admin' } | { kind: 'course'; courseId: string; cap: number };

/** One answer for "too big for you": the entry, or the change, is over the cap. */
function overCap(cap: number): ForbiddenException {
  return new ForbiddenException({ code: 'POINTS_CAP', message: `Speakers can add, change or remove at most ${cap} points per entry`, cap });
}

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
    target: number | ((current: number) => number | Promise<number>),
    now = new Date(),
  ): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entries = await this.prisma.pointsEntry.findMany({
        where: { userId: s.userId, sourceType: s.sourceType, sourceId: s.sourceId },
        select: { points: true, sourceSeq: true, voidedAt: true },
      });
      const current = ledgerTotal(entries);
      // The target is worked out again on every attempt, so a retry never writes a stale one.
      const delta = ledgerDelta(entries, typeof target === 'function' ? await target(current) : target);
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
   * syncSource inside a caller's transaction, for callers that already hold a lock on the
   * source (attendance takes one per session), so there is no race to retry.
   */
  async syncSourceTx(
    tx: Prisma.TransactionClient,
    s: { userId: string; courseId: string | null; sourceType: string; sourceId: string; reason: PointsReason },
    target: number,
    now = new Date(),
  ): Promise<number> {
    const entries = await tx.pointsEntry.findMany({
      where: { userId: s.userId, sourceType: s.sourceType, sourceId: s.sourceId },
      select: { points: true, sourceSeq: true, voidedAt: true },
    });
    const delta = ledgerDelta(entries, target);
    if (!delta) return 0;
    await tx.pointsEntry.create({
      data: { userId: s.userId, courseId: s.courseId, sourceType: s.sourceType, sourceId: s.sourceId, sourceSeq: delta.sourceSeq, reason: s.reason, points: delta.points, createdAt: now },
    });
    return delta.points;
  }

  /**
   * Bonus points from a course automation rule (packages/shared/src/automation.ts). `source`
   * names the rule and occasion, so running it again never adds them twice.
   */
  async syncAutomation(userId: string, courseId: string, source: string, points: number, now = new Date()): Promise<number> {
    if (!(await this.active(userId))) return 0;
    return this.syncSource({ userId, courseId, sourceType: POINTS_SOURCES.AUTOMATION, sourceId: source, reason: 'AUTOMATION' }, points, now);
  }

  /** Deleted (or anonymised) accounts never gain points or badges again. */
  private async active(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    return Boolean(u && !u.deletedAt);
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
    if (!a || !(await this.active(userId))) return 0;
    let subs: { attempt: number; submittedAt: Date | null; score: number | null; maxScore: number }[] = [];
    const delta = await this.syncSource(
      { userId, courseId: a.courseId, sourceType: POINTS_SOURCES.ASSESSMENT, sourceId: a.id, reason: 'ASSESSMENT' },
      async () => {
        subs = await this.prisma.submission.findMany({
          where: { assessmentId, userId, submittedAt: { not: null } },
          select: { attempt: true, submittedAt: true, score: true, maxScore: true },
        });
        return a.status === 'PUBLISHED' ? assessmentPoints(countedAttempt(subs, a.scoring)?.score) : 0;
      },
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
      if (!session || !(await this.active(userId))) return;
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

  /** "Finisher": completed every session of the course (attended, or marked done before that box was retired). */
  async checkFinisher(userId: string, courseId: string): Promise<boolean> {
    const [total, done] = await Promise.all([
      this.prisma.courseSession.count({ where: { courseId } }),
      completedSessionsBy(this.prisma, courseId, [userId]).then((m) => m.get(userId)!.size),
    ]);
    if (!total || done < total) return false;
    return Boolean(await this.awardBadge(BADGE_CODES.FINISHER, userId, { courseId }));
  }

  /**
   * Certificates (PR C) call this once a certificate is issued: the certificatePoints bonus
   * and the "Certified" badge. Idempotent, so calling it twice is harmless.
   */
  async onCertificateIssued(userId: string, courseId: string, certificateId: string): Promise<void> {
    if (!(await this.active(userId))) return;
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
      // Deleted accounts are skipped: anonymisation touches their submissions but must not bring points back.
      where: { submittedAt: { not: null }, updatedAt: { gte: new Date(now.getTime() - hours * 3_600_000) }, user: { deletedAt: null } },
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
    opts: { courseId?: string | null; period?: number | null; awardedById?: string | null; reason?: string | null; now?: Date; notify?: boolean } = {},
  ): Promise<UserBadge | null> {
    const badge = typeof codeOrBadge === 'string' ? await this.prisma.badge.findUnique({ where: { code: codeOrBadge } }) : codeOrBadge;
    if (!badge?.active || !(await this.active(userId))) return null;
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
    if (opts.notify !== false) this.notify(badge, award);
    return award;
  }

  /** In-app + email for an award (fire and forget). */
  notify(badge: Badge, award: UserBadge): void {
    void this.tellBadge(badge, award).catch((err: unknown) => this.logger.error(`Badge notification failed: ${(err as Error).name}`));
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
  async importCsv(csv: string, dryRun: boolean, admin: Actor, allowRepeat = false): Promise<PointsImportResultDto> {
    const parsed = parsePointsCsv(csv);
    // The same file applied twice would double everyone's points: remember each file by its hash.
    const sha256 = createHash('sha256').update(csv.replace(/\r\n/g, '\n').trim()).digest('hex');
    const before = await this.prisma.auditLog.findFirst({
      where: { action: 'points.imported', metadata: { path: ['sha256'], equals: sha256 } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
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
    const result = { dryRun, rows, ok: ready.length, errors, totalPoints: ready.reduce((n, r) => n + r.points, 0), applied: 0, importedBefore: before?.createdAt.toISOString() ?? null };
    if (dryRun) return result;
    if (errors) throw new ConflictException({ code: 'IMPORT_HAS_ERRORS', message: 'Fix the rows with errors (see the preview) and import again' });
    if (!ready.length) throw new BadRequestException({ code: 'IMPORT_EMPTY', message: 'The file has no rows to import' });
    if (before && !allowRepeat) throw new ConflictException({ code: 'IMPORT_REPEATED', message: 'This exact file was already imported. Confirm to import it again.' });
    await this.prisma.$transaction(async (tx) => {
      // Two applies of the same file at once (two tabs, a retry): the second waits here, then sees the first.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sha256}))`;
      const latest = await tx.auditLog.findFirst({
        where: { action: 'points.imported', metadata: { path: ['sha256'], equals: sha256 } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (latest && latest.createdAt.getTime() > (before?.createdAt.getTime() ?? 0)) {
        throw new ConflictException({ code: 'IMPORT_REPEATED', message: 'This exact file was just imported. Preview it again before importing it a second time.' });
      }
      await tx.pointsEntry.createMany({ data: ready });
      await this.audit.log({ actorId: admin.id, action: 'points.imported', entityType: 'PointsEntry', metadata: { rows: ready.length, totalPoints: result.totalPoints, sha256, repeat: Boolean(before), userIds: [...new Set(ready.map((r) => r.userId))] } }, tx);
    });
    return { ...result, applied: ready.length };
  }

  // ------------------------------------------------------------------ reading

  /** Labels for automatic entries come from their source (assessment, session or course title). */
  private async entryDtos(entries: (PointsEntry & { course: CourseRef | null })[]): Promise<PointsEntryDto[]> {
    const ids = (type: string) => [...new Set(entries.filter((e) => e.sourceType === type && e.sourceId).map((e) => e.sourceId!))];
    const [assessments, sessions] = await Promise.all([
      this.prisma.assessment.findMany({ where: { id: { in: ids(POINTS_SOURCES.ASSESSMENT) } }, select: { id: true, titleEn: true, titleAr: true } }),
      this.prisma.courseSession.findMany({
        where: { id: { in: [...ids(POINTS_SOURCES.SESSION), ...ids(POINTS_SOURCES.ATTENDANCE)] } },
        select: { id: true, titleEn: true, titleAr: true, order: true },
      }),
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
      this.prisma.pointsEntry.aggregate({ where: { userId, ...COUNTED }, _sum: { points: true } }),
      this.prisma.pointsEntry.groupBy({ by: ['courseId'], where: { userId, courseId: { not: null }, ...COUNTED }, _sum: { points: true } }),
    ]);
    const courses = await this.prisma.course.findMany({ where: { id: { in: byCourse.map((c) => c.courseId!) } }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    const sums = new Map(byCourse.map((c) => [c.courseId!, c._sum.points ?? 0]));
    return { total: total._sum.points ?? 0, courses: courses.map((c) => ({ ...c, points: sums.get(c.id) ?? 0 })) };
  }

  /** The dashboard card: total, per course, the latest entries and every badge. */
  async mine(userId: string): Promise<MyPointsDto> {
    const [{ total, courses }, recent, badges] = await Promise.all([
      this.totals(userId),
      this.prisma.pointsEntry.findMany({ where: { userId, ...COUNTED }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6, include: { course: courseRef } }),
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
    // Voided entries (removed, or replaced by an edit) aren't the student's points any more.
    const entries = await this.prisma.pointsEntry.findMany({ where: { userId, ...COUNTED }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500, include: { course: courseRef } });
    return this.entryDtos(entries);
  }

  /** Ledger lines with who added them, whether they can be edited, and what replaced them. */
  private async ledgerDtos(
    entries: (PointsEntry & { course: CourseRef | null; awardedBy: Person; voidedBy: Person })[],
    who: (u: Person) => string | null,
  ): Promise<LedgerEntryDto[]> {
    const dtos = await this.entryDtos(entries);
    return dtos.map((d, i) => {
      const e = entries[i]!;
      return {
        ...d,
        sourceType: e.sourceType,
        awardedBy: who(e.awardedBy),
        automatic: e.sourceType !== null,
        voided: e.voidedAt ? { at: e.voidedAt.toISOString(), by: who(e.voidedBy), why: e.voidReason } : null,
        replaces: e.replacesId,
      };
    });
  }

  async adminStudent(userId: string): Promise<AdminStudentPointsDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } });
    if (!user) throw new NotFoundException('Student not found');
    const [{ total, courses }, entries, badges, enrolled] = await Promise.all([
      this.totals(userId),
      this.prisma.pointsEntry.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 300,
        include: { course: courseRef, awardedBy: person, voidedBy: person },
      }),
      this.prisma.userBadge.findMany({
        where: { userId },
        include: { badge: true, course: courseRef, awardedBy: { select: { email: true, profile: { select: { fullNameEn: true } } } } },
        orderBy: { awardedAt: 'desc' },
      }),
      this.prisma.enrollment.findMany({ where: { userId }, select: { course: { select: { id: true, slug: true, titleEn: true, titleAr: true } } }, orderBy: { enrolledAt: 'desc' } }),
    ]);
    const who = (u: Person) => (u ? (u.profile?.fullNameEn ?? u.email) : null);
    return {
      student: { id: user.id, name: user.profile?.fullNameEn || user.profile?.fullNameAr || null, email: user.email },
      total,
      courses,
      entries: await this.ledgerDtos(entries, who),
      badges: badges.map((b) => ({ ...toUserBadgeDto(b), awardedBy: who(b.awardedBy) })),
      enrolledCourses: enrolled.map((e) => e.course),
      cap: ADMIN_POINTS_CAP,
    };
  }

  // ------------------------------------------------------------------ editing and removing

  /** Speaker portal → Points → {student}: their entries in this course (removed ones too). 404 unless enrolled. */
  async courseStudent(courseId: string, userId: string, cap: number): Promise<CourseStudentPointsDto> {
    const enrolment = await this.prisma.enrollment.findFirst({
      where: { courseId, userId, user: { deletedAt: null } },
      select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true } } } } },
    });
    if (!enrolment) throw new NotFoundException('Student not found');
    const [entries, sum] = await Promise.all([
      this.prisma.pointsEntry.findMany({
        where: { userId, courseId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 300,
        include: { course: courseRef, awardedBy: person, voidedBy: person },
      }),
      this.prisma.pointsEntry.aggregate({ where: { userId, courseId, ...COUNTED }, _sum: { points: true } }),
    ]);
    // Speakers see names, not other team members' email addresses.
    const who = (u: Person) => (u ? u.speakerProfile?.name || u.profile?.fullNameEn || null : null);
    const u = enrolment.user;
    return { student: { userId: u.id, name: u.profile?.fullNameEn ?? null, email: u.email }, total: sum._sum.points ?? 0, entries: await this.ledgerDtos(entries, who), cap };
  }

  /**
   * The entry, if this scope may change it: a manual entry (automatic ones are corrected with
   * an ADJUSTMENT instead), not already voided, of a student who still has an account; for a
   * speaker, tagged with their course, for a student enrolled in it, and within their cap.
   */
  private async changeable(tx: Prisma.TransactionClient, entryId: string, scope: PointsScope): Promise<PointsEntry> {
    const e = await tx.pointsEntry.findUnique({ where: { id: entryId } });
    // Another course's entry looks the same as no entry to a speaker.
    if (!e || (scope.kind === 'course' && e.courseId !== scope.courseId)) throw new NotFoundException('Points entry not found');
    const user = await tx.user.findUnique({ where: { id: e.userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException('Points entry not found');
    if (scope.kind === 'course') {
      const enrolled = await tx.enrollment.findFirst({ where: { courseId: scope.courseId, userId: e.userId }, select: { id: true } });
      if (!enrolled) throw new NotFoundException('Points entry not found');
    }
    if (e.sourceType !== null) {
      throw new ConflictException({ code: 'AUTOMATIC_ENTRY', message: 'Points from an assessment, attendance, a session or a certificate change with their source. Add a correction instead.' });
    }
    if (e.voidedAt) throw new ConflictException({ code: 'ENTRY_VOIDED', message: 'This entry was already removed or changed. Reload to see the latest.' });
    if (scope.kind === 'course' && Math.abs(e.points) > scope.cap) throw overCap(scope.cap);
    return e;
  }

  /** Marks the entry voided, unless someone else got there first (409). */
  private async voidRow(tx: Prisma.TransactionClient, e: PointsEntry, why: string, actor: Actor, now: Date): Promise<void> {
    const r = await tx.pointsEntry.updateMany({ where: { id: e.id, voidedAt: null }, data: { voidedAt: now, voidedById: actor.id, voidReason: why } });
    if (r.count !== 1) throw new ConflictException({ code: 'ENTRY_VOIDED', message: 'This entry was already removed or changed. Reload to see the latest.' });
  }

  /**
   * Edits a manual entry: the old one is voided (kept, struck through) and a new one replaces
   * it, dated like the old one so it stays in the same leaderboard week. Audited with ids only.
   */
  async editEntry(entryId: string, input: PointsEditInput, actor: Actor, scope: PointsScope, now = new Date()): Promise<LedgerEntryDto> {
    const cap = scope.kind === 'course' ? scope.cap : ADMIN_POINTS_CAP;
    if (Math.abs(input.points) > cap) throw scope.kind === 'course' ? overCap(cap) : new BadRequestException('Too many points');
    const created = await this.prisma.$transaction(async (tx) => {
      const old = await this.changeable(tx, entryId, scope);
      await this.voidRow(tx, old, input.why, actor, now);
      const next = await tx.pointsEntry.create({
        data: { userId: old.userId, courseId: old.courseId, points: input.points, reason: input.reason, note: input.note, awardedById: actor.id, replacesId: old.id, createdAt: old.createdAt },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'points.edited',
          entityType: 'PointsEntry',
          entityId: old.id,
          metadata: { userId: old.userId, courseId: old.courseId, newEntryId: next.id, from: old.points, to: input.points, reason: input.reason },
        },
        tx,
      );
      return next.id;
    });
    return this.ledgerEntry(created);
  }

  /** Removes a manual entry: voided (kept, struck through, not counted), never deleted. Audited with ids only. */
  async voidEntry(entryId: string, input: PointsVoidInput, actor: Actor, scope: PointsScope, now = new Date()): Promise<LedgerEntryDto> {
    await this.prisma.$transaction(async (tx) => {
      const old = await this.changeable(tx, entryId, scope);
      await this.voidRow(tx, old, input.why, actor, now);
      await this.audit.log(
        { actorId: actor.id, action: 'points.voided', entityType: 'PointsEntry', entityId: old.id, metadata: { userId: old.userId, courseId: old.courseId, points: old.points } },
        tx,
      );
    });
    return this.ledgerEntry(entryId);
  }

  private async ledgerEntry(id: string): Promise<LedgerEntryDto> {
    const e = await this.prisma.pointsEntry.findUniqueOrThrow({ where: { id }, include: { course: courseRef, awardedBy: person, voidedBy: person } });
    return (await this.ledgerDtos([e], (u) => (u ? u.speakerProfile?.name || u.profile?.fullNameEn || null : null)))[0]!;
  }
}
