import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  boardName,
  CHALLENGE_BADGE_PREFIX,
  CHALLENGE_ENTRY_STATUSES,
  CHALLENGE_PUBLIC_NAMES_MAX,
  canSubmit,
  challengePhase,
  type CannotSubmit,
  type ChallengeEntriesQuery,
  type ChallengeEntryInput,
  type ChallengeEntryStatus,
  type ChallengeInput,
  type ChallengeReviewInput,
  type ChallengeStatus,
  type ChallengeUpdate,
  type MyChallengeDto,
  type PublicChallengeDto,
  type StaffChallengeDto,
  type StaffChallengeEntryDto,
} from '@academy/shared';
import { Prisma, type Badge, type Challenge } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/** Where a challenge is managed from: Admin → Challenges (any challenge), or Teaching → {course} (that course's only). */
export type ChallengeScope = { kind: 'admin' } | { kind: 'course'; courseId: string };

const courseRef = { select: { slug: true, titleEn: true, titleAr: true } } as const;
type WithRefs = Challenge & { badge: Badge; course: { slug: string; titleEn: string; titleAr: string } | null };

/** The uniqueness scope of a challenge's badge award: once per challenge. */
export const challengeBadgeScope = (challengeId: string) => `challenge:${challengeId}`;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const BLOCKED: Record<Exclude<CannotSubmit, 'NOT_PUBLISHED'>, () => Error> = {
  NOT_ELIGIBLE: () => new ForbiddenException({ code: 'CHALLENGE_NOT_ELIGIBLE', message: 'This challenge is for the students of its course' }),
  NOT_STARTED: () => new ConflictException({ code: 'CHALLENGE_NOT_STARTED', message: 'This challenge has not started yet' }),
  CLOSED: () => new ConflictException({ code: 'CHALLENGE_CLOSED', message: 'This challenge has ended' }),
  ALREADY_APPROVED: () => new ConflictException({ code: 'CHALLENGE_APPROVED', message: 'Your entry is already approved' }),
};

/**
 * Cohort challenges: staff create them (with their badge), students submit a link, staff
 * review. Approving awards the badge (once per challenge) and the points (synced against the
 * entry, so approving twice never adds them twice); rejecting a previously approved entry takes
 * both back, the way a revoked certificate takes back its bonus and the "Certified" badge.
 * Nothing here ever removes a student from a course.
 */
@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly points: PointsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ public and students

  /** Approved entries of accounts that still exist, per challenge, and the names of those who chose to be shown. */
  private async finishers(challengeIds: string[]): Promise<Map<string, { count: number; names: string[] }>> {
    const out = new Map(challengeIds.map((id) => [id, { count: 0, names: [] as string[] }]));
    if (!challengeIds.length) return out;
    const alive = { status: 'APPROVED', challengeId: { in: challengeIds }, user: { deletedAt: null } } satisfies Prisma.ChallengeEntryWhereInput;
    const [counts, shown] = await Promise.all([
      this.prisma.challengeEntry.groupBy({ by: ['challengeId'], where: alive, _count: { _all: true } }),
      this.prisma.challengeEntry.findMany({
        where: { ...alive, showName: true },
        orderBy: { reviewedAt: 'asc' },
        select: { challengeId: true, user: { select: { profile: { select: { fullNameEn: true, fullNameAr: true } } } } },
      }),
    ]);
    for (const c of counts) out.get(c.challengeId)!.count = c._count._all;
    for (const e of shown) {
      const names = out.get(e.challengeId)!.names;
      const full = e.user.profile?.fullNameEn || e.user.profile?.fullNameAr;
      // No name on the profile: nothing to show (never an email).
      if (full && names.length < CHALLENGE_PUBLIC_NAMES_MAX) names.push(boardName(full));
    }
    return out;
  }

  private publicDto(c: WithRefs, f: { count: number; names: string[] } | undefined, now: Date): PublicChallengeDto {
    return {
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr,
      descriptionEn: c.descriptionEn,
      descriptionAr: c.descriptionAr,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      points: c.points,
      badge: { icon: c.badge.icon, nameEn: c.badge.nameEn, nameAr: c.badge.nameAr },
      course: c.course,
      phase: challengePhase(c, now),
      finishers: f?.count ?? 0,
      finisherNames: f?.names ?? [],
    };
  }

  /** Every published challenge, open first, then upcoming, then past. */
  async listPublic(now = new Date()): Promise<PublicChallengeDto[]> {
    const list = await this.prisma.challenge.findMany({ where: { status: 'PUBLISHED' }, include: { badge: true, course: courseRef }, orderBy: [{ startsAt: 'desc' }], take: 200 });
    const f = await this.finishers(list.map((c) => c.id));
    const order = { open: 0, upcoming: 1, closed: 2 } as const;
    return list.map((c) => this.publicDto(c, f.get(c.id), now)).sort((a, b) => order[a.phase] - order[b.phase]);
  }

  async getPublic(slug: string, now = new Date()): Promise<PublicChallengeDto> {
    const c = await this.published(slug);
    const f = await this.finishers([c.id]);
    return this.publicDto(c, f.get(c.id), now);
  }

  private async published(slug: string): Promise<WithRefs> {
    const c = await this.prisma.challenge.findUnique({ where: { slug }, include: { badge: true, course: courseRef } });
    if (!c || c.status !== 'PUBLISHED') throw new NotFoundException('Challenge not found');
    return c;
  }

  /** Open to every signed-in member, or enrolled in the challenge's course. */
  private async eligible(userId: string, courseId: string | null): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) return false;
    if (!courseId) return true;
    return Boolean(await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } }));
  }

  private async myDto(userId: string, c: WithRefs, f: { count: number; names: string[] } | undefined, eligible: boolean, now: Date): Promise<MyChallengeDto> {
    const entry = await this.prisma.challengeEntry.findUnique({ where: { challengeId_userId: { challengeId: c.id, userId } } });
    const can = canSubmit({ status: c.status as ChallengeStatus, startsAt: c.startsAt, endsAt: c.endsAt }, eligible, entry ? { status: entry.status as ChallengeEntryStatus } : null, now);
    return {
      ...this.publicDto(c, f, now),
      eligible,
      canSubmit: can.ok,
      blocked: can.ok ? null : can.reason,
      entry: entry
        ? {
            status: entry.status as ChallengeEntryStatus,
            url: entry.url,
            note: entry.note,
            showName: entry.showName,
            feedback: entry.feedback,
            reviewedAt: entry.reviewedAt?.toISOString() ?? null,
            submittedAt: entry.updatedAt.toISOString(),
          }
        : null,
    };
  }

  /** The challenges this student can see: every one open to all members, and those of the courses they're enrolled in. */
  async listMine(userId: string, now = new Date()): Promise<MyChallengeDto[]> {
    const enrolled = await this.prisma.enrollment.findMany({ where: { userId }, select: { courseId: true } });
    const courseIds = enrolled.map((e) => e.courseId);
    const list = await this.prisma.challenge.findMany({
      where: { status: 'PUBLISHED', OR: [{ courseId: null }, { courseId: { in: courseIds } }] },
      include: { badge: true, course: courseRef },
      orderBy: [{ startsAt: 'desc' }],
      take: 200,
    });
    const f = await this.finishers(list.map((c) => c.id));
    const active = await this.eligible(userId, null);
    const out = await Promise.all(list.map((c) => this.myDto(userId, c, f.get(c.id), active, now)));
    const order = { open: 0, upcoming: 1, closed: 2 } as const;
    return out.sort((a, b) => order[a.phase] - order[b.phase]);
  }

  async getMine(userId: string, slug: string, now = new Date()): Promise<MyChallengeDto> {
    const c = await this.published(slug);
    const f = await this.finishers([c.id]);
    return this.myDto(userId, c, f.get(c.id), await this.eligible(userId, c.courseId), now);
  }

  /** Submit or resubmit (a pending or rejected entry goes back to PENDING) while the challenge is open. */
  async submit(userId: string, slug: string, input: ChallengeEntryInput, now = new Date()): Promise<MyChallengeDto> {
    const c = await this.published(slug);
    const eligible = await this.eligible(userId, c.courseId);
    const entry = await this.prisma.challengeEntry.findUnique({ where: { challengeId_userId: { challengeId: c.id, userId } }, select: { id: true, status: true } });
    const can = canSubmit({ status: c.status as ChallengeStatus, startsAt: c.startsAt, endsAt: c.endsAt }, eligible, entry ? { status: entry.status as ChallengeEntryStatus } : null, now);
    if (!can.ok) throw can.reason === 'NOT_PUBLISHED' ? new NotFoundException('Challenge not found') : BLOCKED[can.reason]();
    const data = { url: input.url, note: input.note, showName: input.showName, status: 'PENDING' };
    if (entry) {
      // Conditional: an approval that landed a moment ago is never turned back into PENDING.
      const { count } = await this.prisma.challengeEntry.updateMany({ where: { id: entry.id, status: { not: 'APPROVED' } }, data });
      if (!count) throw BLOCKED.ALREADY_APPROVED();
    } else {
      try {
        await this.prisma.challengeEntry.create({ data: { ...data, challengeId: c.id, userId } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // A double click: the other request created it; this one updates it like a resubmission.
        await this.prisma.challengeEntry.updateMany({ where: { challengeId: c.id, userId, status: { not: 'APPROVED' } }, data });
      }
    }
    return this.getMine(userId, slug, now);
  }

  /** Show or hide my name on the public page (any time, also after approval). */
  async setVisibility(userId: string, slug: string, showName: boolean): Promise<MyChallengeDto> {
    const c = await this.published(slug);
    const { count } = await this.prisma.challengeEntry.updateMany({ where: { challengeId: c.id, userId }, data: { showName } });
    if (!count) throw new NotFoundException('No entry yet');
    return this.getMine(userId, slug);
  }

  // ------------------------------------------------------------------ staff

  private async staffDtos(list: WithRefs[], now = new Date()): Promise<StaffChallengeDto[]> {
    const counts = await this.prisma.challengeEntry.groupBy({
      by: ['challengeId', 'status'],
      where: { challengeId: { in: list.map((c) => c.id) }, user: { deletedAt: null } },
      _count: { _all: true },
    });
    return list.map((c) => {
      const byStatus = Object.fromEntries(CHALLENGE_ENTRY_STATUSES.map((s) => [s, 0])) as Record<ChallengeEntryStatus, number>;
      for (const n of counts) if (n.challengeId === c.id) byStatus[n.status as ChallengeEntryStatus] = n._count._all;
      return {
        id: c.id,
        courseId: c.courseId,
        course: c.course,
        slug: c.slug,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        points: c.points,
        icon: c.badge.icon,
        status: c.status as ChallengeStatus,
        phase: challengePhase(c, now),
        counts: byStatus,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  /** The challenge, if this scope may manage it (another course's id is a 404). */
  private async scoped(id: string, scope: ChallengeScope): Promise<WithRefs> {
    const c = await this.prisma.challenge.findUnique({ where: { id }, include: { badge: true, course: courseRef } });
    if (!c || (scope.kind === 'course' && c.courseId !== scope.courseId)) throw new NotFoundException('Challenge not found');
    return c;
  }

  async list(scope: ChallengeScope): Promise<StaffChallengeDto[]> {
    const list = await this.prisma.challenge.findMany({
      where: scope.kind === 'course' ? { courseId: scope.courseId } : {},
      include: { badge: true, course: courseRef },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return this.staffDtos(list);
  }

  async get(id: string, scope: ChallengeScope): Promise<StaffChallengeDto> {
    return (await this.staffDtos([await this.scoped(id, scope)]))[0]!;
  }

  private badgeWording(input: { titleEn: string; titleAr: string; icon: string }) {
    return {
      nameEn: input.titleEn.slice(0, 120),
      nameAr: input.titleAr.slice(0, 120),
      descriptionEn: `Completed the challenge “${input.titleEn}”.`,
      descriptionAr: `أنجز تحدّي «${input.titleAr}».`,
      icon: input.icon,
    };
  }

  /** A new challenge and its badge, in one transaction. A course scope always creates it for its course. */
  async create(input: ChallengeInput, scope: ChallengeScope, actor: Actor): Promise<StaffChallengeDto> {
    const courseId = scope.kind === 'course' ? scope.courseId : input.courseId;
    if (courseId && !(await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'courseId', message: 'Unknown course' }] });
    }
    try {
      const c = await this.prisma.$transaction(async (tx) => {
        // AUTO: approvals award it and a rejection takes it back, so it is never awarded or revoked by hand.
        const badge = await tx.badge.create({ data: { code: `${CHALLENGE_BADGE_PREFIX}${input.slug}`, kind: 'AUTO', ...this.badgeWording(input) } });
        const created = await tx.challenge.create({
          data: {
            courseId,
            slug: input.slug,
            titleEn: input.titleEn,
            titleAr: input.titleAr,
            descriptionEn: input.descriptionEn,
            descriptionAr: input.descriptionAr,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            points: input.points,
            status: input.status,
            badgeId: badge.id,
            createdById: actor.id,
          },
          include: { badge: true, course: courseRef },
        });
        await this.audit.log({ actorId: actor.id, action: 'challenge.created', entityType: 'Challenge', entityId: created.id, metadata: { courseId, badgeId: badge.id, status: input.status } }, tx);
        return created;
      });
      return (await this.staffDtos([c]))[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ statusCode: 409, message: 'Validation failed', errors: [{ path: 'slug', message: 'A challenge (or badge) with this address exists' }] });
      throw err;
    }
  }

  /** Wording, dates, points, icon and status (publish, archive, back to draft). The badge follows the title and icon. */
  async update(id: string, input: ChallengeUpdate, scope: ChallengeScope, actor: Actor): Promise<StaffChallengeDto> {
    const current = await this.scoped(id, scope);
    const c = await this.prisma.$transaction(async (tx) => {
      await tx.badge.update({ where: { id: current.badgeId }, data: this.badgeWording(input) });
      const updated = await tx.challenge.update({
        where: { id },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          points: input.points,
          status: input.status,
        },
        include: { badge: true, course: courseRef },
      });
      await this.audit.log(
        { actorId: actor.id, action: 'challenge.updated', entityType: 'Challenge', entityId: id, metadata: { from: current.status, to: input.status, points: input.points } },
        tx,
      );
      return updated;
    });
    return (await this.staffDtos([c]))[0]!;
  }

  async entries(id: string, scope: ChallengeScope, q: ChallengeEntriesQuery): Promise<StaffChallengeEntryDto[]> {
    await this.scoped(id, scope);
    const rows = await this.prisma.challengeEntry.findMany({
      where: { challengeId: id, user: { deletedAt: null }, ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ updatedAt: 'asc' }],
      take: 1000,
      include: {
        user: { select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } },
        reviewer: { select: { email: true, profile: { select: { fullNameEn: true } }, speakerProfile: { select: { name: true } } } },
      },
    });
    const pending = (s: string) => (s === 'PENDING' ? 0 : 1);
    return rows
      .sort((a, b) => pending(a.status) - pending(b.status))
      .map((e) => {
        const name = e.user.profile?.fullNameEn || e.user.profile?.fullNameAr || null;
        const reviewer = e.reviewer ? e.reviewer.speakerProfile?.name || e.reviewer.profile?.fullNameEn || (scope.kind === 'admin' ? e.reviewer.email : null) : null;
        return {
          id: e.id,
          // Course staff see a name (an email only when there is none, as in the gradebook); admins see both.
          student: { id: e.user.id, name, email: scope.kind === 'admin' || !name ? e.user.email : null },
          url: e.url,
          note: e.note,
          status: e.status as ChallengeEntryStatus,
          feedback: e.feedback,
          reviewer,
          reviewedAt: e.reviewedAt?.toISOString() ?? null,
          submittedAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        };
      });
  }

  /**
   * Approve: the badge (once per challenge) and the challenge's points (synced against the
   * entry: approving again never adds them twice). Reject: feedback for the student; if it was
   * approved, its points go back to 0 and the badge is taken back (like a revoked certificate).
   */
  async review(challengeId: string, entryId: string, input: ChallengeReviewInput, scope: ChallengeScope, actor: Actor): Promise<StaffChallengeEntryDto> {
    const c = await this.scoped(challengeId, scope);
    const entry = await this.prisma.challengeEntry.findFirst({ where: { id: entryId, challengeId, user: { deletedAt: null } } });
    if (!entry) throw new NotFoundException('Entry not found');
    const now = new Date();
    const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    // Conditional on the status read above: of two reviews at once, only one sees the change it makes.
    const { count: changed } = await this.prisma.challengeEntry.updateMany({
      where: { id: entryId, status: entry.status },
      data: { status, feedback: input.feedback || null, reviewerId: actor.id, reviewedAt: now },
    });
    if (!changed) {
      await this.prisma.challengeEntry.update({ where: { id: entryId }, data: { feedback: input.feedback || null, reviewerId: actor.id, reviewedAt: now } });
    }
    const scopeKey = challengeBadgeScope(c.id);
    const link = `/challenges/${c.slug}`;
    if (status === 'APPROVED') {
      // Both idempotent: the points are synced to the target, the badge is unique per (student, badge, challenge).
      await this.points.syncChallenge(entry.userId, c.courseId, entry.id, c.points, now);
      const award = await this.points.awardBadge(c.badge, entry.userId, { courseId: c.courseId, scopeKey, awardedById: actor.id, reason: `Challenge: ${c.titleEn}`, notify: false });
      if (award) this.points.notify(c.badge, award, { inApp: false });
      if (changed && entry.status !== 'APPROVED') {
        const pts = c.points ? { en: ` +${c.points} points and`, ar: ` +${c.points} نقطة و` } : { en: '', ar: '' };
        await this.tell(entry.userId, {
          type: 'challenge.approved',
          titleEn: `Challenge approved: ${c.titleEn}`,
          titleAr: `تمّ قبول مشاركتك في التحدّي: ${c.titleAr}`,
          bodyEn: `Well done!${pts.en} the ${c.badge.icon} ${c.badge.nameEn} badge.${input.feedback ? ` ${input.feedback}` : ''}`,
          bodyAr: `أحسنت!${pts.ar} شارة ${c.badge.icon} ${c.badge.nameAr}.${input.feedback ? ` ${input.feedback}` : ''}`,
          link,
        });
      }
    } else {
      // Always (both are no-ops unless it was approved before), so a race with an approval can't leave either behind.
      await this.points.syncChallenge(entry.userId, c.courseId, entry.id, 0, now);
      await this.prisma.userBadge.deleteMany({ where: { userId: entry.userId, badgeId: c.badgeId, scopeKey } });
      await this.tell(entry.userId, {
        type: 'challenge.rejected',
        titleEn: `Your challenge entry needs changes: ${c.titleEn}`,
        titleAr: `مشاركتك في التحدّي تحتاج إلى تعديل: ${c.titleAr}`,
        bodyEn: input.feedback,
        bodyAr: input.feedback,
        link,
      });
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'challenge.entry.reviewed',
      entityType: 'ChallengeEntry',
      entityId: entry.id,
      metadata: { challengeId: c.id, userId: entry.userId, from: entry.status, to: status, scope: scope.kind },
    });
    return (await this.entries(challengeId, scope, {})).find((e) => e.id === entryId)!;
  }

  /** In-app, in both languages. A failure never fails the review. */
  private async tell(userId: string, n: Parameters<NotificationsService['create']>[1]): Promise<void> {
    await this.notifications.create(userId, n).catch((err: unknown) => this.logger.error(`Challenge notification failed: ${(err as Error).name}`));
  }
}
