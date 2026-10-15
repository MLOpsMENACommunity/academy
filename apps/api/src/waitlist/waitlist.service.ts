import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  courseAvailability,
  PUBLIC_COURSE_STATUSES,
  toCsv,
  type CourseInterestInput,
  type Locale,
  type WaitlistDto,
  type WaitlistLeaveResult,
  type WaitlistNotifyInput,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AnnouncementDelivery } from '../announcements/announcement-delivery.service';
import { WaitlistLinks } from '../announcements/waitlist-links';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { capRows, EXPORT_LIMIT } from '../admin/export';

const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Not told yet and not in the middle of being told (a failed send can be retried by notifying again). */
const WAITING = {
  notifiedAt: null,
  OR: [{ deliveryStatus: null }, { deliveryStatus: { in: ['FAILED', 'SKIPPED'] } }],
} satisfies Prisma.CourseInterestWhereInput;

/**
 * The waiting list ("Notify me"): people who want to hear when a course opens.
 * Joining needs a signed-in account with a confirmed email; older entries made without an
 * account ("guests") are kept, linked to an account when someone confirms that address
 * (claimGuestEntries), and told about the opening with a sign-up link instead.
 * Joining is idempotent (one row per course and email) and only the first join sends
 * a confirmation, so the endpoint can't be used to flood someone's inbox. Every email
 * carries a signed link to leave the list; the list is announced to through the same
 * durable queue as course announcements (AnnouncementDelivery).
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly delivery: AnnouncementDelivery,
    private readonly audit: AuditService,
    private readonly links: WaitlistLinks,
  ) {}

  // ------------------------------------------------------------------ public

  private async publicCourse(slug: string) {
    const course = await this.prisma.course.findFirst({
      where: { slug, status: { in: [...PUBLIC_COURSE_STATUSES] } },
      select: { id: true, slug: true, titleEn: true, titleAr: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async join(slug: string, input: CourseInterestInput, session: AuthUser): Promise<{ joined: true }> {
    // Same rule as applying: an account whose email is confirmed (so it is theirs to be told at).
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.id },
      select: { email: true, locale: true, emailVerifiedAt: true },
    });
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email address before joining the waiting list' });
    }
    const course = await this.publicCourse(slug);
    const email = user.email.toLowerCase();
    const userId = session.id;
    const locale: Locale = input.locale ?? user.locale;

    let created: { id: string } | null = null;
    try {
      created = await this.prisma.courseInterest.create({ data: { courseId: course.id, email, userId, locale }, select: { id: true } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Already on the list (from before it needed an account): link it to this account (never unlink).
      await this.prisma.courseInterest.updateMany({ where: { courseId: course.id, email, userId: null }, data: { userId } });
    }

    // One confirmation per address per day across all courses: joining many courses at once
    // sends one email, not one per course.
    const recent = created
      ? await this.prisma.courseInterest.count({
          where: { email, id: { not: created.id }, createdAt: { gt: new Date(Date.now() - CONFIRMATION_WINDOW_MS) } },
        })
      : 0;
    if (created && recent === 0) {
      const ar = locale === 'ar';
      void this.email
        .send(
          email,
          locale,
          {
            name: 'waitlistJoined',
            courseTitle: ar ? course.titleAr || course.titleEn : course.titleEn,
            courseUrl: this.email.url(locale, `/courses/${course.slug}`),
            leaveUrl: this.links.leaveUrl(locale, created.id),
          },
          { bulk: true },
        )
        .catch(() => undefined);
    }
    return { joined: true };
  }

  /** Signed-in students leave from the course page. */
  async leaveAsUser(slug: string, userId: string): Promise<void> {
    // Any status: leaving must keep working after a course is unpublished.
    const course = await this.prisma.course.findUnique({ where: { slug }, select: { id: true } });
    if (!course) throw new NotFoundException('Course not found');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    // A guest entry for the same address only once the account has proven it owns that address.
    const mine = user.emailVerifiedAt ? [{ userId }, { email: user.email.toLowerCase() }] : [{ userId }];
    await this.prisma.courseInterest.deleteMany({ where: { courseId: course.id, OR: mine } });
  }

  /**
   * Links waiting-list entries made without an account (before joining needed one) to the
   * account that has just proven it owns that address: email confirmed, Google sign-in, a
   * password reset link, or a sign-in to a verified account. Never throws.
   */
  async claimGuestEntries(userId: string): Promise<number> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, deletedAt: true } });
      if (!user?.emailVerifiedAt || user.deletedAt) return 0;
      const r = await this.prisma.courseInterest.updateMany({ where: { email: user.email.toLowerCase(), userId: null }, data: { userId } });
      return r.count;
    } catch (err) {
      this.logger.error(`Linking waiting-list entries failed: ${(err as Error).name}`);
      return 0;
    }
  }

  private async byToken(token: string) {
    const id = this.links.verify(token);
    if (!id) throw new BadRequestException({ code: 'INVALID_LINK', message: 'This link is not valid' });
    return this.prisma.courseInterest.findUnique({ where: { id }, include: { course: { select: { slug: true, titleEn: true, titleAr: true } } } });
  }

  /** What a leave link is for, without leaving (link scanners only ever GET). */
  async peek(token: string): Promise<WaitlistLeaveResult> {
    const row = await this.byToken(token);
    return { left: !row, course: row?.course ?? null };
  }

  /** Leaving through the link in an email. Using it twice is fine. */
  async leaveByToken(token: string): Promise<WaitlistLeaveResult> {
    const row = await this.byToken(token);
    if (!row) return { left: true, course: null };
    await this.prisma.courseInterest.deleteMany({ where: { id: row.id } });
    return { left: true, course: row.course };
  }

  // ------------------------------------------------------------------ admin

  private async adminCourse(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  private async rows(courseId: string, take?: number) {
    return this.prisma.courseInterest.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      take,
      include: { user: { select: { deletedAt: true, profile: { select: { fullNameEn: true } } } } },
    });
  }

  async list(courseId: string): Promise<WaitlistDto> {
    await this.adminCourse(courseId);
    const [rows, groups, notified, waiting] = await Promise.all([
      this.rows(courseId, 1000),
      this.prisma.courseInterest.groupBy({ by: ['deliveryStatus'], where: { courseId }, _count: { _all: true } }),
      this.prisma.courseInterest.count({ where: { courseId, notifiedAt: { not: null } } }),
      this.prisma.courseInterest.count({ where: { courseId, ...WAITING } }),
    ]);
    const n = (s: string | null) => groups.find((g) => g.deliveryStatus === s)?._count._all ?? 0;
    const count = groups.reduce((a, g) => a + g._count._all, 0);
    return {
      count,
      notified,
      sending: n('PENDING'),
      waiting,
      entries: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.user?.profile?.fullNameEn ?? null,
        student: Boolean(r.userId),
        locale: r.locale,
        joinedAt: r.createdAt.toISOString(),
        notifiedAt: r.notifiedAt?.toISOString() ?? null,
        delivery: r.deliveryStatus,
      })),
    };
  }

  async csv(courseId: string, admin: Actor): Promise<string> {
    await this.adminCourse(courseId);
    const rows = await this.rows(courseId, EXPORT_LIMIT + 1);
    await this.audit.log({ actorId: admin.id, action: 'waitlist.exported', entityType: 'Course', entityId: courseId, metadata: { count: rows.length } });
    return toCsv(
      ['Email', 'Name', 'Has account', 'Language', 'Joined at', 'Notified at'],
      capRows(rows, (r) => [r.email, r.user?.profile?.fullNameEn ?? '', Boolean(r.userId), r.locale, r.createdAt.toISOString(), r.notifiedAt?.toISOString() ?? '']),
    );
  }

  async remove(courseId: string, entryId: string, admin: Actor): Promise<void> {
    const r = await this.prisma.courseInterest.deleteMany({ where: { id: entryId, courseId } });
    if (!r.count) throw new NotFoundException('Not on the waiting list');
    await this.audit.log({ actorId: admin.id, action: 'waitlist.entry_removed', entityType: 'Course', entityId: courseId });
  }

  /**
   * Guest entries (from before joining needed an account) whose address now belongs to a
   * verified account that hasn't signed in since: linked now, so that person gets the usual
   * email and the in-app notification rather than "create your account".
   */
  private async linkVerifiedGuests(courseId: string, tx: Prisma.TransactionClient): Promise<void> {
    const guests = await tx.courseInterest.findMany({ where: { courseId, userId: null, ...WAITING }, select: { id: true, email: true } });
    if (!guests.length) return;
    const accounts = await tx.user.findMany({
      where: { OR: guests.map((g) => ({ email: { equals: g.email, mode: 'insensitive' as const } })), emailVerifiedAt: { not: null }, deletedAt: null },
      select: { id: true, email: true },
    });
    const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a.id]));
    for (const g of guests) {
      const userId = byEmail.get(g.email.toLowerCase());
      if (userId) await tx.courseInterest.updateMany({ where: { id: g.id, userId: null }, data: { userId } });
    }
  }

  /**
   * Tells everyone on the list who hasn't been told yet. Recorded as an announcement
   * (history, idempotency); each entry is a durable queue item that AnnouncementDelivery
   * sends from the bulk email lane. Students with an account also get an in-app notification.
   */
  async notify(courseId: string, input: WaitlistNotifyInput, admin: Actor): Promise<{ id: string; recipients: number }> {
    const existing = await this.prisma.announcement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { _count: { select: { waitlist: true } } },
    });
    if (existing) {
      if (existing.courseId !== courseId) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Generate a new key for this message' });
      return { id: existing.id, recipients: existing._count.waitlist };
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, slug: true, titleEn: true, titleAr: true, status: true, applicationsOpenAt: true, applicationDeadline: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    // "It's open" to a course people can't apply to would use up everyone's one notification:
    // the status alone isn't enough (applications may open later, or the deadline may have passed).
    if (courseAvailability(course) !== 'OPEN') {
      throw new BadRequestException({ code: 'COURSE_NOT_OPEN', message: "Applications for this course aren't open right now: check its status, opening date and deadline, then notify the waiting list" });
    }
    const where: Prisma.CourseInterestWhereInput = { courseId, ...WAITING };
    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.linkVerifiedGuests(courseId, tx);
        const people = await tx.courseInterest.findMany({ where, select: { id: true, userId: true } });
        if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: 'Nobody on the waiting list is waiting to hear' });
        const a = await tx.announcement.create({
          data: {
            courseId,
            createdById: admin.id,
            idempotencyKey: input.idempotencyKey,
            subjectEn: input.subjectEn,
            subjectAr: input.subjectAr,
            bodyEn: input.bodyEn,
            bodyAr: input.bodyAr,
            statuses: ['WAITLIST'],
          },
        });
        // Only rows still waiting: a second notify running at the same time can't claim them twice.
        const claimed = await tx.courseInterest.updateMany({
          where: { id: { in: people.map((p) => p.id) }, ...WAITING },
          data: { announcementId: a.id, deliveryStatus: 'PENDING', attempts: 0 },
        });
        if (claimed.count !== people.length) {
          throw new ConflictException({ code: 'NOTIFY_IN_PROGRESS', message: 'The waiting list is being notified already. Refresh the page.' });
        }
        const users = [...new Set(people.map((p) => p.userId).filter((x): x is string => Boolean(x)))];
        if (users.length) {
          await tx.notification.createMany({
            data: users.map((userId) => ({
              userId,
              type: 'course.waitlist',
              titleEn: `${course.titleEn}: ${input.subjectEn}`,
              titleAr: `${course.titleAr || course.titleEn}: ${subjectAr}`,
              bodyEn: input.bodyEn,
              bodyAr,
              link: `/courses/${course.slug}`,
            })),
          });
        }
        await this.audit.log(
          { actorId: admin.id, action: 'course.waitlist_notified', entityType: 'Announcement', entityId: a.id, metadata: { courseId, recipients: people.length } },
          tx,
        );
        return { id: a.id, recipients: people.length };
      });
      void this.delivery.process().catch(() => undefined);
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const a = await this.prisma.announcement.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
        return { id: a.id, recipients: await this.prisma.courseInterest.count({ where: { announcementId: a.id } }) };
      }
      throw err;
    }
  }
}
