import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  classifyInvite,
  countOutcomes,
  COURSE_INVITE_STATUSES,
  INVITE_MAX_RESENDS,
  INVITE_RESEND_INTERVAL_MS,
  INVITE_RETENTION_DAYS,
  normaliseInviteEntries,
  SEAT_HOLDING_STATUSES,
  toCsv,
  type CourseInviteDto,
  type CourseInvitesDto,
  type CourseInviteStatus,
  type InviteApplyInput,
  type InviteApplyResultDto,
  type InviteEntryInput,
  type InvitePreviewDto,
  type InvitePreviewRow,
  type Locale,
  type Role,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { capRows, EXPORT_LIMIT } from '../admin/export';
import { ApplicationWorkflow, formatStart, hasText, type Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { FunnelService } from '../funnel/funnel.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** Shown to the student in their application history. */
const HISTORY_REASON = 'Enrolled directly by the course team';

/** One batch is one transaction holding the course lock; a few hundred enrolments fit well inside this. */
const BATCH_TX = { timeout: 60_000, maxWait: 10_000 };
/** One claim is one enrolment; waiting on a busy course lock must not hold a sign-in for long. */
const CLAIM_TX = { timeout: 15_000, maxWait: 5_000 };

/** Courses nobody can be added to: apply refuses them, and their pending invites wait (claimFor). */
const CLOSED_TO_INVITES = new Set(['DRAFT', 'ARCHIVED']);

interface Fact {
  user: { id: string; role: Role; verified: boolean; deleted: boolean } | null;
  enrolled: boolean;
  invite: { id: string; status: CourseInviteStatus } | null;
}

interface CourseRow {
  id: string;
  slug: string;
  type: 'FREE' | 'PAID';
  status: string;
  capacity: number | null;
  titleEn: string;
  titleAr: string;
}

/**
 * "Enrol by email". Admins add addresses to a course; a verified student account is enrolled
 * at once through the same workflow as an accepted application (history, Enrollment, audit),
 * so it gets everything an enrolled student gets (learn page, calendar, reminders, Drive
 * tracking, points and certificates). Any other address gets a PENDING invite, enrolled only
 * once an account with that address has proven it owns the inbox (email confirmation, a
 * password reset link or Google sign-in): registering with someone else's address claims nothing.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApplicationWorkflow,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly funnel: FunnelService,
  ) {}

  private async course(courseId: string): Promise<CourseRow> {
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, slug: true, type: true, status: true, capacity: true, titleEn: true, titleAr: true },
    });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  /** Drafts and archived courses take nobody: refused before anything is written. */
  private assertOpenToInvites(course: CourseRow): void {
    if (CLOSED_TO_INVITES.has(course.status)) {
      throw new ConflictException({
        code: 'COURSE_NOT_INVITABLE',
        message: course.status === 'DRAFT' ? 'Publish this course before adding people to it' : 'This course is archived: nobody can be added to it',
      });
    }
  }

  private seatsTaken(courseId: string, tx: Tx = this.prisma): Promise<number> {
    return tx.application.count({ where: { courseId, status: { in: [...SEAT_HOLDING_STATUSES] }, user: { deletedAt: null } } });
  }

  /** What we know about each address for this course: account, enrolment, existing invite. */
  private async facts(tx: Tx, courseId: string, emails: string[]): Promise<Map<string, Fact>> {
    const out = new Map<string, Fact>(emails.map((e) => [e, { user: null, enrolled: false, invite: null }]));
    if (!emails.length) return out;
    const [users, invites] = await Promise.all([
      tx.user.findMany({
        // Accounts are stored lower-cased; insensitive anyway, for any older row.
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true, role: true, emailVerifiedAt: true, deletedAt: true, enrollments: { where: { courseId }, select: { id: true } } },
      }),
      tx.courseInvite.findMany({ where: { courseId, email: { in: emails } }, select: { id: true, email: true, status: true } }),
    ]);
    for (const u of users) {
      const f = out.get(u.email.toLowerCase());
      if (!f) continue;
      f.user = { id: u.id, role: u.role, verified: Boolean(u.emailVerifiedAt), deleted: Boolean(u.deletedAt) };
      f.enrolled = u.enrollments.length > 0;
    }
    for (const i of invites) {
      const f = out.get(i.email);
      if (f) f.invite = { id: i.id, status: i.status };
    }
    return out;
  }

  private classify(entries: ReturnType<typeof normaliseInviteEntries>['entries'], facts: Map<string, Fact>): InvitePreviewRow[] {
    return entries.map((e) => {
      const f = e.valid ? facts.get(e.email) : undefined;
      const outcome = classifyInvite({
        valid: e.valid,
        duplicate: e.duplicate,
        account: f?.user ? { role: f.user.role, verified: f.user.verified, deleted: f.user.deleted } : null,
        enrolled: f?.enrolled ?? false,
        invite: f?.invite?.status ?? null,
      });
      return { email: e.email, name: e.name, note: e.note, outcome };
    });
  }

  private validEmails(entries: ReturnType<typeof normaliseInviteEntries>['entries']): string[] {
    return [...new Set(entries.filter((e) => e.valid).map((e) => e.email))];
  }

  // ------------------------------------------------------------------ admin

  async preview(courseId: string, input: { entries: InviteEntryInput[] }): Promise<InvitePreviewDto> {
    const course = await this.course(courseId);
    this.assertOpenToInvites(course);
    const { entries } = normaliseInviteEntries(input.entries);
    const facts = await this.facts(this.prisma, courseId, this.validEmails(entries));
    const rows = this.classify(entries, facts);
    return { rows, counts: countOutcomes(rows), course: { type: course.type, capacity: course.capacity, seatsTaken: await this.seatsTaken(courseId) } };
  }

  /** Applies a batch in one transaction (holding the course lock), then emails and notifies. */
  async apply(courseId: string, input: InviteApplyInput, admin: Actor): Promise<InviteApplyResultDto> {
    const course = await this.course(courseId);
    this.assertOpenToInvites(course);
    if (course.type === 'PAID' && !input.skipPayment) {
      throw new BadRequestException({
        code: 'PAYMENT_WAIVER_REQUIRED',
        message: 'This is a paid course: confirm that these people are enrolled without paying',
      });
    }
    const { entries } = normaliseInviteEntries(input.entries);
    const { rows, enrolled, invited } = await this.prisma.$transaction(async (tx) => {
      const locked = await this.workflow.lockCourse(tx, courseId);
      const now = new Date();
      // Read after taking the lock, so a concurrent batch or application is seen.
      const facts = await this.facts(tx, courseId, this.validEmails(entries));
      const rows = this.classify(entries, facts);
      const enrolled: { userId: string; applicationId: string }[] = [];
      const invited: string[] = [];
      for (const row of rows) {
        const f = facts.get(row.email);
        if (row.outcome === 'ENROL' && f?.user) {
          const res = await this.workflow.enrolDirectly(tx, locked, f.user.id, admin, HISTORY_REASON);
          // Already enrolled after all (the facts saw no Enrollment): nothing happened, nothing to record.
          if (!res) continue;
          const invite = await tx.courseInvite.upsert({
            where: { courseId_email: { courseId, email: row.email } },
            // lastEmailedAt: the "You've been added" email goes out right after the commit.
            create: { courseId, email: row.email, invitedById: admin.id, note: row.note, status: 'ENROLLED', enrolledUserId: f.user.id, enrolledAt: now, lastEmailedAt: input.sendEmail ? now : null },
            update: { status: 'ENROLLED', enrolledUserId: f.user.id, enrolledAt: now, invitedById: admin.id, ...(input.sendEmail ? { lastEmailedAt: now } : {}), ...(row.note ? { note: row.note } : {}) },
            select: { id: true },
          });
          await this.audit.log(
            {
              actorId: admin.id,
              action: 'course.enrolled_by_admin',
              entityType: 'Course',
              entityId: courseId,
              metadata: { inviteId: invite.id, applicationId: res.app.id, fromStatus: res.from, trigger: 'direct', skipPayment: course.type === 'PAID' },
            },
            tx,
          );
          enrolled.push({ userId: f.user.id, applicationId: res.app.id });
        } else if (row.outcome === 'INVITE' || row.outcome === 'INVITE_UNVERIFIED') {
          // One row per course and address. INVITE is only classified for an address with no
          // pending invite, so an existing row here is REVOKED, or ENROLLED from an enrolment that
          // was since undone (the student is no longer enrolled). Either way it is spent and starts
          // over as a new invite: new date (the retention clock restarts), resends from zero.
          const invite = await tx.courseInvite.upsert({
            where: { courseId_email: { courseId, email: row.email } },
            create: { courseId, email: row.email, invitedById: admin.id, note: row.note, locale: input.locale, status: 'PENDING' },
            update: { status: 'PENDING', invitedById: admin.id, note: row.note, locale: input.locale, enrolledUserId: null, enrolledAt: null, lastEmailedAt: null, resendCount: 0, createdAt: now },
            select: { id: true },
          });
          await this.audit.log(
            {
              actorId: admin.id,
              action: 'course.invited',
              entityType: 'Course',
              entityId: courseId,
              metadata: { inviteId: invite.id, hasAccount: row.outcome === 'INVITE_UNVERIFIED', skipPayment: course.type === 'PAID' },
            },
            tx,
          );
          invited.push(invite.id);
        }
      }
      return { rows, enrolled, invited };
    }, BATCH_TX);

    // After the commit: the course pages' enrolled count and seats left (the admin route
    // revalidates too; this also clears the cache for a batch that only enrolled).
    if (enrolled.length) this.workflow.publicCountsChanged(null, 'ENROLLED');
    // After the commit: tell people. Never fails the request (sends are queued; errors logged).
    for (const e of enrolled) {
      await this.funnel.record({ id: courseId }, 'ENROLLED', { userId: e.userId });
      await this.tellEnrolled(e.userId, courseId, input.sendEmail);
    }
    let emailed = 0;
    if (input.sendEmail) {
      for (const id of invited) if (await this.sendInvite(id)) emailed++;
    }
    return {
      rows,
      counts: countOutcomes(rows),
      course: { type: course.type, capacity: course.capacity, seatsTaken: await this.seatsTaken(courseId) },
      enrolled: enrolled.length,
      invited: invited.length,
      emailed: emailed + (input.sendEmail ? enrolled.length : 0),
    };
  }

  async list(courseId: string): Promise<CourseInvitesDto> {
    await this.course(courseId);
    const [rows, groups] = await Promise.all([
      this.rows(courseId, 1000),
      this.prisma.courseInvite.groupBy({ by: ['status'], where: { courseId }, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(COURSE_INVITE_STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0])) as Record<CourseInviteStatus, number>;
    return { counts, items: rows.map(toDto) };
  }

  private rows(courseId: string, take: number) {
    return this.prisma.courseInvite.findMany({
      where: { courseId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
      include: { invitedBy: { select: { email: true } }, enrolledUser: { select: { profile: { select: { fullNameEn: true } } } } },
    });
  }

  async csv(courseId: string, admin: Actor): Promise<string> {
    await this.course(courseId);
    const rows = await this.rows(courseId, EXPORT_LIMIT + 1);
    await this.audit.log({ actorId: admin.id, action: 'course.invites_exported', entityType: 'Course', entityId: courseId, metadata: { count: Math.min(rows.length, EXPORT_LIMIT) } });
    return toCsv(
      ['Email', 'Name', 'Status', 'Invited at', 'Invited by', 'Enrolled at', 'Last emailed at', 'Language', 'Note'],
      capRows(rows, (r) => {
        const d = toDto(r);
        return [d.email, d.name ?? '', d.status, d.createdAt, d.invitedBy ?? '', d.enrolledAt ?? '', d.lastEmailedAt ?? '', d.locale, d.note ?? ''];
      }),
    );
  }

  async resend(courseId: string, inviteId: string, admin: Actor): Promise<CourseInviteDto> {
    const invite = await this.prisma.courseInvite.findFirst({ where: { id: inviteId, courseId } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'PENDING') throw new ConflictException({ code: 'INVITE_NOT_PENDING', message: 'Only a pending invite can be emailed again' });
    const limit = () => new ConflictException({ code: 'INVITE_RESEND_LIMIT', message: `This invite was already emailed again ${INVITE_MAX_RESENDS} times` });
    if (invite.resendCount >= INVITE_MAX_RESENDS) throw limit();
    if (invite.lastEmailedAt && Date.now() - invite.lastEmailedAt.getTime() < INVITE_RESEND_INTERVAL_MS) {
      throw new ConflictException({ code: 'INVITE_RECENTLY_SENT', message: 'This invite was emailed less than a minute ago' });
    }
    // Counted with a conditional update, so two quick clicks can't go past the cap.
    const counted = await this.prisma.courseInvite.updateMany({
      where: { id: invite.id, status: 'PENDING', resendCount: { lt: INVITE_MAX_RESENDS } },
      data: { resendCount: { increment: 1 } },
    });
    if (!counted.count) throw limit();
    await this.sendInvite(invite.id);
    await this.audit.log({ actorId: admin.id, action: 'course.invite_resent', entityType: 'Course', entityId: courseId, metadata: { inviteId } });
    return toDto(await this.oneRow(invite.id));
  }

  async revoke(courseId: string, inviteId: string, admin: Actor): Promise<CourseInviteDto> {
    const r = await this.prisma.courseInvite.updateMany({ where: { id: inviteId, courseId, status: 'PENDING' }, data: { status: 'REVOKED' } });
    if (!r.count) {
      const exists = await this.prisma.courseInvite.count({ where: { id: inviteId, courseId } });
      if (!exists) throw new NotFoundException('Invite not found');
      throw new ConflictException({ code: 'INVITE_NOT_PENDING', message: 'Only a pending invite can be revoked' });
    }
    await this.audit.log({ actorId: admin.id, action: 'course.invite_revoked', entityType: 'Course', entityId: courseId, metadata: { inviteId } });
    return toDto(await this.oneRow(inviteId));
  }

  private oneRow(id: string) {
    return this.prisma.courseInvite.findUniqueOrThrow({
      where: { id },
      include: { invitedBy: { select: { email: true } }, enrolledUser: { select: { profile: { select: { fullNameEn: true } } } } },
    });
  }

  // ------------------------------------------------------------------ claiming

  /**
   * Enrols a verified student account in every course its address was invited to. Called when
   * an account proves it owns its address (email confirmed, password reset by email, Google
   * sign-in) and on sign-in; idempotent (each invite is claimed by a conditional update in
   * the enrolling transaction). Never throws: signing in must not fail because of an invite.
   * Returns the slugs of the courses it enrolled in.
   */
  async claimFor(userId: string): Promise<string[]> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, emailVerifiedAt: true, deletedAt: true },
      });
      // Unverified: whoever registered may not own the inbox. Speakers and admins are never students here.
      if (!user || !user.emailVerifiedAt || user.deletedAt || user.role !== 'STUDENT') return [];
      const pending = await this.prisma.courseInvite.findMany({
        where: { email: user.email.toLowerCase(), status: 'PENDING' },
        select: { id: true, courseId: true, invitedById: true, course: { select: { slug: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const slugs: string[] = [];
      for (const inv of pending) {
        // A draft or archived course takes nobody: the invite waits (and expires with retention).
        if (CLOSED_TO_INVITES.has(inv.course.status)) continue;
        try {
          const res = await this.prisma.$transaction(async (tx) => {
            const locked = await this.workflow.lockCourse(tx, inv.courseId);
            const claimed = await tx.courseInvite.updateMany({
              where: { id: inv.id, status: 'PENDING' },
              data: { status: 'ENROLLED', enrolledUserId: user.id, enrolledAt: new Date() },
            });
            if (!claimed.count) return { claimed: false, enrolled: null };
            const actor: Actor | null = inv.invitedById ? { id: inv.invitedById, role: 'ADMIN' } : null;
            const enrolled = await this.workflow.enrolDirectly(tx, locked, user.id, actor, HISTORY_REASON);
            // Already enrolled (e.g. through an application): the invite is spent, but nothing
            // was enrolled by it, so there is no audit entry and nobody is told.
            if (!enrolled) return { claimed: true, enrolled: null };
            await this.audit.log(
              {
                actorId: inv.invitedById,
                action: 'course.enrolled_by_admin',
                entityType: 'Course',
                entityId: inv.courseId,
                metadata: { inviteId: inv.id, applicationId: enrolled.app.id, fromStatus: enrolled.from, trigger: 'invite_claimed' },
              },
              tx,
            );
            return { claimed: true, enrolled };
          }, CLAIM_TX);
          if (res.enrolled) {
            // Claimed at sign-in, not by an admin request: the course pages need telling.
            this.workflow.publicCountsChanged(res.enrolled.from, 'ENROLLED');
            await this.funnel.record({ id: inv.courseId }, 'ENROLLED', { userId: user.id });
            await this.tellEnrolled(user.id, inv.courseId, true);
            slugs.push(inv.course.slug);
          }
        } catch (err) {
          this.logger.error(`Claiming an invite failed: ${(err as Error).name}`);
        }
      }
      return slugs;
    } catch (err) {
      this.logger.error(`Looking up invites failed: ${(err as Error).name}`);
      return [];
    }
  }

  // ------------------------------------------------------------------ privacy

  /** Account deleted: invites not yet used for that address go now (enrolled ones go at anonymisation). */
  async forgetPending(email: string, tx: Tx = this.prisma): Promise<void> {
    await tx.courseInvite.deleteMany({ where: { email: email.toLowerCase(), status: { in: ['PENDING', 'REVOKED'] } } });
  }

  /** Retention: pending and revoked invites older than INVITE_RETENTION_DAYS are deleted. */
  async purgeStale(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * 86_400_000);
    const r = await this.prisma.courseInvite.deleteMany({ where: { status: { in: ['PENDING', 'REVOKED'] }, createdAt: { lt: cutoff } } });
    return r.count;
  }

  // ------------------------------------------------------------------ telling people

  /** Email (optional) and in-app notification for a student who was just enrolled. Never throws. */
  private async tellEnrolled(userId: string, courseId: string, sendEmail: boolean): Promise<void> {
    try {
      const [user, course] = await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true, locale: true, deletedAt: true, profile: { select: { timezone: true, coreCompletedAt: true } } },
        }),
        this.prisma.course.findUniqueOrThrow({
          where: { id: courseId },
          select: { slug: true, titleEn: true, titleAr: true, startDate: true, preparation: true, sessions: { orderBy: { startsAt: 'asc' }, take: 1, select: { startsAt: true } } },
        }),
      ]);
      if (user.deletedAt) return;
      const incomplete = !user.profile?.coreCompletedAt;
      const link = `/learn/${course.slug}`;
      if (sendEmail) {
        void this.email.send(user.email, user.locale, {
          name: 'courseAdded',
          courseTitle: user.locale === 'ar' ? course.titleAr || course.titleEn : course.titleEn,
          courseUrl: this.email.url(user.locale, link),
          startsAt: formatStart(course.sessions[0]?.startsAt ?? course.startDate, user.locale, user.profile?.timezone),
          hasPreparation: hasText(course.preparation),
          profileUrl: incomplete ? this.email.url(user.locale, '/profile') : null,
        });
      }
      await this.notifications.create(userId, {
        type: 'course.added',
        titleEn: `${course.titleEn}: you've been added`,
        titleAr: `${course.titleAr || course.titleEn}: تمت إضافتك`,
        bodyEn: `The course team enrolled you directly: no application or payment needed. Session links, the schedule and calendar invites are on your course page.${incomplete ? ' When you have a moment, complete your profile so the team knows you.' : ''}`,
        bodyAr: `سجّلك فريق الدورة مباشرةً دون تقديم أو دفع. روابط الجلسات والجدول ودعوات التقويم موجودة في صفحة الدورة.${incomplete ? ' عندما يتسنى لك ذلك، أكمل ملفك الشخصي ليتعرف إليك الفريق.' : ''}`,
        link,
      });
    } catch (err) {
      this.logger.error(`Telling an enrolled student failed: ${(err as Error).name}`);
    }
  }

  /** The invitation email. Stamps lastEmailedAt once handed to the queue; false if the invite isn't pending. */
  private async sendInvite(inviteId: string): Promise<boolean> {
    const invite = await this.prisma.courseInvite.findUnique({
      where: { id: inviteId },
      include: { course: { select: { slug: true, titleEn: true, titleAr: true } } },
    });
    if (!invite || invite.status !== 'PENDING') return false;
    const account = await this.prisma.user.findFirst({
      where: { email: { equals: invite.email, mode: 'insensitive' }, deletedAt: null },
      select: { locale: true },
    });
    const locale: Locale = account?.locale ?? invite.locale;
    const learn = `/${locale}/learn/${invite.course.slug}`;
    // The address goes in the fragment: browsers never send it, so it stays out of access logs and Referer headers.
    const q = `returnTo=${encodeURIComponent(learn)}#email=${encodeURIComponent(invite.email)}`;
    void this.email.send(invite.email, locale, {
      name: 'courseInvite',
      courseTitle: locale === 'ar' ? invite.course.titleAr || invite.course.titleEn : invite.course.titleEn,
      email: invite.email,
      hasAccount: Boolean(account),
      url: this.email.url(locale, `${account ? '/login' : '/register'}?${q}`),
      courseUrl: this.email.url(locale, `/courses/${invite.course.slug}`),
    });
    await this.prisma.courseInvite.update({ where: { id: invite.id }, data: { lastEmailedAt: new Date() } });
    return true;
  }
}

type InviteRow = Prisma.CourseInviteGetPayload<{
  include: { invitedBy: { select: { email: true } }; enrolledUser: { select: { profile: { select: { fullNameEn: true } } } } };
}>;

function toDto(r: InviteRow): CourseInviteDto {
  return {
    id: r.id,
    email: r.email,
    status: r.status,
    note: r.note,
    locale: r.locale,
    invitedBy: r.invitedBy?.email ?? null,
    createdAt: r.createdAt.toISOString(),
    enrolledAt: r.enrolledAt?.toISOString() ?? null,
    lastEmailedAt: r.lastEmailedAt?.toISOString() ?? null,
    resendCount: r.resendCount,
    name: r.enrolledUser?.profile?.fullNameEn ?? null,
  };
}
