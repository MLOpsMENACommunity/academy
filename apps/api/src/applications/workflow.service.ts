import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
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
import type { Application, Course, Prisma, User } from '@prisma/client';
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

  /** Serialises seat decisions per course for the rest of the transaction. */
  async lockCourse(tx: Tx, courseId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
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

  /** Writes history and side tables for a status that has just been set inside `tx`. */
  async recordChange(
    tx: Tx,
    app: Pick<Application, 'id' | 'userId' | 'courseId'>,
    from: ApplicationStatus | null,
    to: ApplicationStatus,
    actor: Actor | null,
    reason?: string | null,
  ): Promise<void> {
    await tx.applicationStatusHistory.create({
      data: { applicationId: app.id, fromStatus: from, toStatus: to, actorId: actor?.id ?? null, reason: reason ?? null },
    });
    if (to === 'ENROLLED') {
      await tx.enrollment.upsert({
        where: { userId_courseId: { userId: app.userId, courseId: app.courseId } },
        update: { applicationId: app.id },
        create: { userId: app.userId, courseId: app.courseId, applicationId: app.id },
      });
    }
    if (actor?.role === 'ADMIN') {
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
  }

  /**
   * Applies an event. `within` runs extra writes in the same transaction
   * (e.g. creating or reviewing a Payment) after the status is updated.
   */
  async transition(
    applicationId: string,
    event: ApplicationEvent,
    actor: Actor | null,
    opts: { reason?: string | null; within?: (tx: Tx, app: Application) => Promise<void> } = {},
  ): Promise<Application> {
    const { app, from } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findUnique({
        where: { id: applicationId },
        include: { course: { select: { id: true, type: true, capacity: true } } },
      });
      if (!current) throw new NotFoundException('Application not found');
      await this.lockCourse(tx, current.courseId);
      // Re-read after taking the lock: another request may have changed it meanwhile.
      const fresh = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      const ctx = await this.context(tx, current.course, applicationId);
      const result = transition(fresh.status, event, ctx);
      if (!result.ok) {
        throw new ConflictException({ code: 'INVALID_TRANSITION', message: result.error });
      }
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: result.status,
          ...(result.status === 'REJECTED' ? { rejectionReason: opts.reason ?? null } : {}),
        },
      });
      await this.recordChange(tx, updated, fresh.status, result.status, actor, opts.reason);
      if (opts.within) await opts.within(tx, updated);
      return { app: updated, from: fresh.status };
    });

    await this.afterChange(app, from, opts.reason);
    return app;
  }

  /** Email + in-app notification + funnel. Failures here never undo the change. */
  async afterChange(app: Application, from: ApplicationStatus | null, reason?: string | null): Promise<void> {
    if (from === app.status) return;
    try {
      const full = await this.prisma.application.findUniqueOrThrow({
        where: { id: app.id },
        include: { user: true, course: { select: { id: true, titleEn: true, titleAr: true } } },
      });
      await this.notifyStudent(full.user, full.course, app, reason ?? null);
      const funnelEvent = FUNNEL_FOR[app.status];
      if (funnelEvent) await this.funnel.record({ id: app.courseId }, funnelEvent, { userId: app.userId });
    } catch (err) {
      this.logger.error(`Post-transition side effects failed: ${(err as Error).name}`);
    }
  }

  private async notifyStudent(
    user: User,
    course: { titleEn: string; titleAr: string },
    app: Application,
    reason: string | null,
  ): Promise<void> {
    const link = `/dashboard/applications/${app.id}`;
    const label = applicationStatusLabels[app.status];
    const msg = applicationStatusMessages[app.status];
    const withReason = (text: string, prefix: string) => (reason ? `${text} ${prefix}${reason}` : text);
    await this.notifications.create(user.id, {
      type: `application.${app.status.toLowerCase()}`,
      titleEn: `${course.titleEn}: ${label.en}`,
      titleAr: `${course.titleAr}: ${label.ar}`,
      bodyEn: withReason(msg.en, 'Reason: '),
      bodyAr: withReason(msg.ar, 'السبب: '),
      link,
    });
    if (user.deletedAt) return;
    await this.email.send(user.email, user.locale, {
      name: 'applicationStatus',
      courseTitle: user.locale === 'ar' ? course.titleAr : course.titleEn,
      status: app.status,
      reason,
      url: this.email.url(user.locale, link),
    });
  }
}
