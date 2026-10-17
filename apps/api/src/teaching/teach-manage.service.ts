import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminApplicationEvent } from '@academy/shared';
import { AdminApplicationsService } from '../admin/admin-applications.service';
import type { Actor } from '../applications/workflow.service';
import { ApplicationWorkflow } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

function ownApplication(): ForbiddenException {
  return new ForbiddenException({ code: 'OWN_APPLICATION', message: 'You can’t change the status of your own application. Ask an admin.' });
}

/**
 * The course-scoped checks the management routes need before reusing the admin services: an
 * application or certificate id must be the route's course's (404 otherwise, the same answer as
 * for an id that doesn't exist), and nobody decides on their own application.
 */
@Injectable()
export class TeachManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: AdminApplicationsService,
    private readonly workflow: ApplicationWorkflow,
    private readonly audit: AuditService,
  ) {}

  private async application(courseId: string, id: string) {
    const a = await this.prisma.application.findFirst({ where: { id, courseId }, select: { id: true, userId: true } });
    if (!a) throw new NotFoundException('Application not found');
    return a;
  }

  /**
   * The admin detail without what stays with the admins: internal notes, payments, who made
   * each change, and the CV file (whether there is one is still shown).
   */
  async applicationDetail(courseId: string, id: string, viewer: Actor) {
    await this.application(courseId, id);
    const { notes: _notes, payments: _payments, history, ...rest } = await this.applications.detail(id, viewer.id);
    // Who changed it stays with the team (their emails aren't for course staff).
    return { ...rest, history: history.map((h) => ({ ...h, actor: null })), notes: [], payments: [] };
  }

  async transition(courseId: string, id: string, event: AdminApplicationEvent, actor: Actor, reason?: string) {
    const a = await this.application(courseId, id);
    if (a.userId === actor.id) throw ownApplication();
    const app = await this.workflow.transition(id, event, actor, { reason });
    return { id: app.id, status: app.status };
  }

  async bulk(courseId: string, ids: string[], event: AdminApplicationEvent, actor: Actor, reason?: string) {
    const unique = [...new Set(ids)];
    const rows = await this.prisma.application.findMany({ where: { id: { in: unique }, courseId }, select: { id: true, userId: true } });
    if (rows.length !== unique.length) throw new NotFoundException('Application not found');
    if (rows.some((r) => r.userId === actor.id)) throw ownApplication();
    return this.applications.bulk(unique, event, actor, reason);
  }

  /** 404 unless the certificate is this course's. */
  async assertCertificateInCourse(courseId: string, id: string): Promise<void> {
    const n = await this.prisma.certificate.count({ where: { id, enrollment: { courseId } } });
    if (!n) throw new NotFoundException('Certificate not found');
  }

  /** Session order has no audit entry of its own on the admin side; staff changes do. */
  async auditReorder(courseId: string, actor: Actor, ids: string[]): Promise<void> {
    await this.audit.log({ actorId: actor.id, action: 'session.reordered', entityType: 'Course', entityId: courseId, metadata: { count: ids.length } });
  }
}
