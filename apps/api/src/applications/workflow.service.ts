import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  applicationStatusLabels,
  applicationStatusMessages,
  SEAT_HOLDING_STATUSES,
  TERMINAL_STATUSES,
  transition,
  type ApplicationEvent,
  type ApplicationStatus,
  type FunnelEvent,
  type Role,
  type TransitionContext,
} from '@academy/shared';
import type { Application, ApplicationStatusHistory, Course, Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PublicDataChanges } from '../common/public-data';
import { EmailService } from '../email/email.service';
import { FunnelService } from '../funnel/funnel.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { toProfileDto } from '../users/profile.service';

/** Stored on a pending payment closed because the student was enrolled directly (no payment needed). */
export const PAYMENT_WAIVED_REASON = 'Waived: enrolled by the course team';
/** Stored on a payment still under review when the student's account was deleted (nothing was decided). */
export const PAYMENT_CLOSED_ACCOUNT_DELETED = 'Closed: the student deleted their account';
/** History reason when deleting an account withdraws its open applications. */
export const WITHDRAWN_ACCOUNT_DELETED = 'Account deleted';

/** Events a student-turned-admin may still trigger on their own application. */
const OWN_APPLICATION_EVENTS: readonly ApplicationEvent[] = ['SUBMIT_PAYMENT', 'WITHDRAW'];

export interface Actor {
  id: string;
  role: Role;
}

type Tx = Prisma.TransactionClient;

/** What the status notification needs about the student. */
export type NotifyUser = User & { profile: { timezone: string | null } | null };

/** What the status notification needs about the course (first session = its start). */
export interface NotifyCourse {
  slug: string;
  type: Course['type'];
  recordingsPlatform: Course['recordingsPlatform'];
  youtubePlaylistUrl: string | null;
  titleEn: string;
  titleAr: string;
  startDate: Date | null;
  preparation: Prisma.JsonValue;
  sessions: { startsAt: Date }[];
}

export interface LockedCourse {
  id: string;
  type: Course['type'];
  capacity: number | null;
  requiresApproval: boolean;
}

const FUNNEL_FOR: Partial<Record<ApplicationStatus, FunnelEvent>> = {
  SHORTLISTED: 'SHORTLISTED',
  PAYMENT_SUBMITTED: 'PAYMENT_SUBMITTED',
  ENROLLED: 'ENROLLED',
};

/**
 * The only place an application's status changes. Every change:
 * - runs the shared state machine (no ad-hoc ifs),
 * - locks the course row so capacity can't be oversold by concurrent requests,
 * - writes ApplicationStatusHistory (and AuditLog for admin actions),
 * - creates the Enrollment on ENROLLED,
 * - then notifies the student by email and in-app, and refreshes the public pages when the
 *   course's enrolled count or seats left moved (publicCountsChanged).
 */
@Injectable()
export class ApplicationWorkflow {
  private readonly logger = new Logger(ApplicationWorkflow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly funnel: FunnelService,
    @Optional() private readonly publicData?: PublicDataChanges,
  ) {}

  /**
   * After the commit of a status change made outside transition() (applying, enrolling by
   * email or invite): if it moved a course's public enrolled count or seats left, the public
   * cache is cleared and the site revalidated, so the course pages are current within seconds.
   */
  publicCountsChanged(from: ApplicationStatus | null, to: ApplicationStatus | null): void {
    this.publicData?.statusChanged(from, to);
  }

  /**
   * Serialises seat decisions per course for the rest of the transaction and
   * returns the seat-relevant fields as of the lock (so a concurrent capacity
   * change can't be missed). NO KEY UPDATE: inserts that merely reference the
   * course (funnel events, enrolments) aren't blocked.
   */
  async lockCourse(tx: Tx, courseId: string): Promise<LockedCourse> {
    const rows = await tx.$queryRaw<LockedCourse[]>`
      SELECT id, type, capacity, "requiresApproval" FROM "Course" WHERE id = ${courseId} FOR NO KEY UPDATE`;
    if (!rows[0]) throw new NotFoundException('Course not found');
    return rows[0];
  }

  async context(tx: Tx, course: Pick<Course, 'id' | 'type' | 'capacity'>, excludeApplicationId?: string): Promise<TransitionContext> {
    const seatsTaken = await tx.application.count({
      where: {
        courseId: course.id,
        status: { in: [...SEAT_HOLDING_STATUSES] },
        // A deleted account holds no seat (older rows from before deletion withdrew applications).
        user: { deletedAt: null },
        ...(excludeApplicationId ? { id: { not: excludeApplicationId } } : {}),
      },
    });
    return { courseType: course.type, capacity: course.capacity, seatsTaken };
  }

  /** Writes history and side tables for a status that has just been set inside `tx`; returns the history row. */
  async recordChange(
    tx: Tx,
    app: Pick<Application, 'id' | 'userId' | 'courseId'>,
    from: ApplicationStatus | null,
    to: ApplicationStatus,
    actor: Actor | null,
    reason?: string | null,
  ): Promise<ApplicationStatusHistory> {
    const history = await tx.applicationStatusHistory.create({
      data: { applicationId: app.id, fromStatus: from, toStatus: to, actorId: actor?.id ?? null, reason: reason ?? null },
    });
    if (to === 'ENROLLED') {
      await tx.enrollment.upsert({
        where: { userId_courseId: { userId: app.userId, courseId: app.courseId } },
        update: { applicationId: app.id },
        create: { userId: app.userId, courseId: app.courseId, applicationId: app.id },
      });
    }
    // Decisions about someone else's application, by an admin or by course staff (never the student's own steps).
    if (actor && actor.id !== app.userId) {
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'application.status_changed',
          entityType: 'Application',
          entityId: app.id,
          metadata: { from, to, ...(reason ? { hasReason: true } : {}) },
        },
        tx,
      );
    }
    return history;
  }

  /**
   * "Enrol by email": enrols a student directly, inside the caller's transaction, which must
   * already hold the course lock (lockCourse). With no application yet, one is created at
   * ENROLLED with no answers (there was no form); an existing one moves with ADMIN_ENROL
   * (the shared state machine). Either way history, the Enrollment and the audit entry are
   * written by recordChange, as for every other enrolment. Returns null when already enrolled.
   * The student is told by the caller (InvitesService), not by afterChange: the message differs.
   */
  async enrolDirectly(
    tx: Tx,
    course: LockedCourse,
    userId: string,
    actor: Actor | null,
    reason: string,
  ): Promise<{ app: Application; from: ApplicationStatus | null } | null> {
    const existing = await tx.application.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } });
    if (!existing) {
      const profile = await tx.profile.findUnique({ where: { userId }, include: { skills: true } });
      const app = await tx.application.create({
        data: {
          userId,
          courseId: course.id,
          status: 'ENROLLED',
          answers: {},
          profileSnapshot: toProfileDto(profile) as unknown as Prisma.InputJsonValue,
          source: { via: 'admin' },
        },
      });
      await this.recordChange(tx, app, null, 'ENROLLED', actor, reason);
      return { app, from: null };
    }
    // Same seats rule as everywhere (ADMIN_ENROL ignores capacity, but the context stays honest).
    const result = transition(existing.status, 'ADMIN_ENROL', await this.context(tx, course, existing.id));
    if (!result.ok) {
      // Already enrolled: make sure the enrolment row exists (it always should) and stop.
      await tx.enrollment.upsert({
        where: { userId_courseId: { userId, courseId: course.id } },
        update: {},
        create: { userId, courseId: course.id, applicationId: existing.id },
      });
      return null;
    }
    const app = await tx.application.update({ where: { id: existing.id }, data: { status: result.status, rejectionReason: null } });
    await this.recordChange(tx, app, existing.status, result.status, actor, reason);
    // A payment still waiting for review (from PAYMENT_SUBMITTED) is settled by the waiver: left
    // PENDING_REVIEW, approving it later would fail (the application is no longer PAYMENT_SUBMITTED)
    // and the retention job would never delete its screenshot.
    const waiting = await tx.payment.findMany({ where: { applicationId: existing.id, status: 'PENDING_REVIEW' }, select: { id: true } });
    for (const p of waiting) {
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'REJECTED', rejectionReason: PAYMENT_WAIVED_REASON, reviewedById: actor?.id ?? null, reviewedAt: new Date() },
      });
      await this.audit.log(
        { actorId: actor?.id ?? null, action: 'payment.waived', entityType: 'Payment', entityId: p.id, metadata: { applicationId: existing.id } },
        tx,
      );
    }
    return { app, from: existing.status };
  }

  /**
   * Applies an event. `within` runs extra writes in the same transaction
   * (e.g. creating or reviewing a Payment) after the status is updated.
   */
  async transition(
    applicationId: string,
    event: ApplicationEvent,
    actor: Actor | null,
    opts: { reason?: string | null; within?: (tx: Tx, app: Application) => Promise<void>; awaitSideEffects?: boolean } = {},
  ): Promise<Application> {
    const { app, from } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findUnique({
        where: { id: applicationId },
        select: { courseId: true, userId: true },
      });
      if (!current) throw new NotFoundException('Application not found');
      // An admin who applied to a course is a student there: someone else decides on their application.
      if (actor?.role === 'ADMIN' && actor.id === current.userId && !OWN_APPLICATION_EVENTS.includes(event)) {
        throw new ForbiddenException({
          code: 'OWN_APPLICATION',
          message: 'You can’t change the status of your own application. Ask another admin.',
        });
      }
      const course = await this.lockCourse(tx, current.courseId);
      // Re-read after taking the lock: another request may have changed it meanwhile.
      const fresh = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { user: { select: { anonymizedAt: true } } },
      });
      const ctx = await this.context(tx, course, applicationId);
      const result = transition(fresh.status, event, ctx);
      if (!result.ok) {
        throw new ConflictException({ code: 'INVALID_TRANSITION', message: result.error });
      }
      // Never write free text back onto an anonymised account.
      const reason = fresh.user.anonymizedAt ? null : (opts.reason ?? null);
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: result.status,
          ...(result.status === 'REJECTED' ? { rejectionReason: reason } : {}),
        },
      });
      await this.recordChange(tx, updated, fresh.status, result.status, actor, reason);
      if (opts.within) await opts.within(tx, updated);
      return { app: updated, from: fresh.status };
    });
    // Committed: withdrawing, approving a payment, accepting... the course pages show it now.
    this.publicCountsChanged(from, app.status);

    // Bulk actions don't wait for the in-app notifications either (emails are always queued); afterChange never throws.
    if (opts.awaitSideEffects === false) void this.afterChange(app, from, opts.reason).catch(() => undefined);
    else await this.afterChange(app, from, opts.reason);
    return app;
  }

  /**
   * Deleting an account withdraws its open applications (anything not enrolled, rejected or
   * withdrawn): their seats go back to the course, and a payment still under review is closed
   * with a fixed reason (so it leaves the review queue and can't enrol a deleted account).
   * The account is already marked deleted, so the student is not emailed. Never throws.
   */
  async withdrawForDeletedAccount(userId: string, actor: Actor): Promise<number> {
    const open = await this.prisma.application.findMany({
      where: { userId, status: { notIn: [...TERMINAL_STATUSES] } },
      select: { id: true },
    });
    const closed: string[] = [];
    for (const { id } of open) {
      try {
        await this.transition(id, 'WITHDRAW', actor, {
          reason: WITHDRAWN_ACCOUNT_DELETED,
          within: async (tx, app) => {
            closed.push(...(await this.closePendingPayments(tx, app, actor, PAYMENT_CLOSED_ACCOUNT_DELETED)));
          },
        });
      } catch (err) {
        this.logger.error(`Withdrawing an application of a deleted account failed: ${(err as Error).name}`);
      }
    }
    // Money may have been sent: whoever reviews payments decides on a refund.
    for (const paymentId of closed) {
      await this.notifications
        .notifyAdmins(
          {
            type: 'admin.payment_closed',
            titleEn: 'A payment under review was closed',
            titleAr: 'تم إغلاق دفعة قيد المراجعة',
            bodyEn: 'The student deleted their account while their payment was under review, so it was closed. If the money was received, arrange a refund.',
            bodyAr: 'حذف الطالب حسابه بينما كانت دفعته قيد المراجعة، لذا أُغلقت. إذا وصل المبلغ، فرتّب استرداده.',
            link: `/admin/payments/${paymentId}`,
          },
          ['FINANCE'],
        )
        .catch(() => this.logger.error('Telling the finance team about a closed payment failed'));
    }
    return open.length;
  }

  /** Closes the application's payments still under review (rejected, with `reason`), audited. Returns their ids. */
  async closePendingPayments(tx: Tx, app: Pick<Application, 'id'>, actor: Actor | null, reason: string): Promise<string[]> {
    const waiting = await tx.payment.findMany({ where: { applicationId: app.id, status: 'PENDING_REVIEW' }, select: { id: true } });
    for (const p of waiting) {
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'REJECTED', rejectionReason: reason, reviewedById: actor?.role === 'ADMIN' ? actor.id : null, reviewedAt: new Date() },
      });
      await this.audit.log(
        { actorId: actor?.id ?? null, action: 'payment.closed', entityType: 'Payment', entityId: p.id, metadata: { applicationId: app.id, reason: 'account_deleted' } },
        tx,
      );
    }
    return waiting.map((p) => p.id);
  }

  /** Email + in-app notification + funnel. Each runs independently; failures never undo the change. */
  async afterChange(
    app: Application,
    from: ApplicationStatus | null,
    reason?: string | null,
    /** The student and course, when the caller already has them (saves a read). */
    loaded?: { user: NotifyUser; course: NotifyCourse },
  ): Promise<void> {
    if (from === app.status) return;
    const funnelEvent = FUNNEL_FOR[app.status];
    const results = await Promise.allSettled([
      loaded
        ? this.notifyStudent(loaded.user, loaded.course, app, reason ?? null, from)
        : this.prisma.application
        .findUniqueOrThrow({
          where: { id: app.id },
          include: {
            user: { include: { profile: { select: { timezone: true } } } },
            course: {
              select: {
                id: true,
                slug: true,
                type: true,
                recordingsPlatform: true,
                youtubePlaylistUrl: true,
                titleEn: true,
                titleAr: true,
                startDate: true,
                preparation: true,
                sessions: { orderBy: { startsAt: 'asc' }, take: 1, select: { startsAt: true } },
              },
            },
          },
        })
        .then((full) => this.notifyStudent(full.user, full.course, app, reason ?? null, from)),
      funnelEvent ? this.funnel.record({ id: app.courseId }, funnelEvent, { userId: app.userId }) : Promise.resolve(),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.error(`Side effect failed for application ${app.id} (${app.status}): ${(r.reason as Error)?.name}`);
      }
    }
  }

  private async notifyStudent(
    user: NotifyUser,
    course: NotifyCourse,
    app: Application,
    reason: string | null,
    from: ApplicationStatus | null = null,
  ): Promise<void> {
    // Deleted accounts get nothing: no rows, no emails.
    if (user.deletedAt) return;
    const link = `/dashboard/applications/${app.id}`;
    const label = applicationStatusLabels[app.status];
    const msg = applicationStatusMessages[app.status];
    const rejected = app.status === 'REJECTED';
    // Feedback first: the notification bell shows only the first lines.
    const withReason = (text: string, prefix: string) => (reason ? `${prefix}${reason}\n\n${text}` : text);
    // Queued, not awaited: the queue is paced for the provider's rate limit, and waiting for
    // delivery held the request for seconds (QA M5). send() never throws; failures are logged there.
    void this.email.send(user.email, user.locale, {
      name: 'applicationStatus',
      courseTitle: user.locale === 'ar' ? course.titleAr || course.titleEn : course.titleEn,
      status: app.status,
      reason,
      url: this.email.url(user.locale, link),
      courseUrl: this.email.url(user.locale, app.status === 'ENROLLED' ? `/learn/${course.slug}` : `/courses/${course.slug}`),
      browseUrl: this.email.url(user.locale, '/courses'),
      startsAt: formatStart(course.sessions[0]?.startsAt ?? course.startDate, user.locale, user.profile?.timezone),
      recordingsPublic: course.recordingsPlatform === 'YOUTUBE' && Boolean(course.youtubePlaylistUrl),
      hasPreparation: hasText(course.preparation),
      // Enrolled because the payment was verified: the acceptance itself came earlier.
      paymentVerified: app.status === 'ENROLLED' && from === 'PAYMENT_SUBMITTED',
    });
    try {
      await this.notifications.create(user.id, {
        type: `application.${app.status.toLowerCase()}`,
        titleEn: `${course.titleEn}: ${label.en}`,
        titleAr: `${course.titleAr}: ${label.ar}`,
        bodyEn: withReason(msg.en, rejected ? 'Feedback from the course team: ' : 'Reason: '),
        bodyAr: withReason(msg.ar, rejected ? 'ملاحظات من فريق الدورة: ' : 'السبب: '),
        link,
      });
    } catch {
      this.logger.error(`Notifying the student failed for application ${app.id}`);
    }
  }
}

/** "on Sunday 18 October, 19:00 EEST" in the student's language and time zone (Cairo if unknown). */
export function formatStart(at: Date | null, locale: 'en' | 'ar', timezone: string | null | undefined): string | null {
  // Nothing to announce for a course that already started (late enrolment).
  if (!at || at.getTime() < Date.now()) return null;
  const timeZone = timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  try {
    const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(at);
    return locale === 'ar' ? `يوم ${when}` : `on ${when}`;
  } catch {
    return null;
  }
}

export function hasText(v: Prisma.JsonValue): boolean {
  const o = v as { en?: string; ar?: string } | null;
  return Boolean(o?.en?.trim() || o?.ar?.trim());
}
