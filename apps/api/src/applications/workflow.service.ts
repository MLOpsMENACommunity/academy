import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  applicationStatusLabels,
  applicationStatusMessages,
  SEAT_HOLDING_STATUSES,
  transition,
  type ApplicationEvent,
  type ApplicationStatus,
  type FunnelEvent,
  type Role,
  type TransitionContext,
} from '@academy/shared';
import type { Application, ApplicationStatusHistory, Course, Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { FunnelService } from '../funnel/funnel.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

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
 * - then notifies the student by email and in-app.
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
  ) {}

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
    // Admin decisions about someone else's application (not an admin applying themselves).
    if (actor?.role === 'ADMIN' && actor.id !== app.userId) {
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
      const current = await tx.application.findUnique({ where: { id: applicationId }, select: { courseId: true } });
      if (!current) throw new NotFoundException('Application not found');
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

    // Bulk actions don't wait for each email; afterChange never throws (allSettled + logging).
    if (opts.awaitSideEffects === false) void this.afterChange(app, from, opts.reason).catch(() => undefined);
    else await this.afterChange(app, from, opts.reason);
    return app;
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
        ? this.notifyStudent(loaded.user, loaded.course, app, reason ?? null)
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
        .then((full) => this.notifyStudent(full.user, full.course, app, reason ?? null)),
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
  ): Promise<void> {
    // Deleted accounts get nothing: no rows, no emails.
    if (user.deletedAt) return;
    const link = `/dashboard/applications/${app.id}`;
    const label = applicationStatusLabels[app.status];
    const msg = applicationStatusMessages[app.status];
    const rejected = app.status === 'REJECTED';
    // Feedback first: the notification bell shows only the first lines.
    const withReason = (text: string, prefix: string) => (reason ? `${prefix}${reason}\n\n${text}` : text);
    const [notified, emailed] = await Promise.allSettled([
      this.notifications.create(user.id, {
      type: `application.${app.status.toLowerCase()}`,
      titleEn: `${course.titleEn}: ${label.en}`,
      titleAr: `${course.titleAr}: ${label.ar}`,
      bodyEn: withReason(msg.en, rejected ? 'Feedback from the course team: ' : 'Reason: '),
      bodyAr: withReason(msg.ar, rejected ? 'ملاحظات من فريق الدورة: ' : 'السبب: '),
      link,
    }),
      // Queued, not awaited: the email queue is paced for the provider's rate limit, so
      // waiting for delivery held the student's request for seconds (QA M5).
      this.queueEmail(user.email, user.locale, {
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
      }),
    ]);
    if (notified.status === 'rejected' || emailed.status === 'rejected') {
      this.logger.error(`Notifying the student failed for application ${app.id}`);
    }
  }

  /** Hands an email to the paced queue without waiting for delivery; failures are logged there. */
  private queueEmail(...args: Parameters<EmailService['send']>): Promise<void> {
    void this.email.send(...args);
    return Promise.resolve();
  }
}

/** "on Sunday 18 October, 19:00 EEST" in the student's language and time zone (Cairo if unknown). */
function formatStart(at: Date | null, locale: 'en' | 'ar', timezone: string | null | undefined): string | null {
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

function hasText(v: Prisma.JsonValue): boolean {
  const o = v as { en?: string; ar?: string } | null;
  return Boolean(o?.en?.trim() || o?.ar?.trim());
}
