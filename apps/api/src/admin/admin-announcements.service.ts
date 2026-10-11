import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AnnouncementInput, ApplicationStatus } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AnnouncementDelivery } from '../announcements/announcement-delivery.service';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Messages from admins to a course's students (e.g. the study-group link, quiz links,
 * a schedule change): an in-app notification for everyone right away, and an email each
 * from a durable queue (see AnnouncementDelivery).
 */
@Injectable()
export class AdminAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: AnnouncementDelivery,
    private readonly audit: AuditService,
  ) {}

  private async course(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  /** People with an application in one of the statuses: one entry per person, live accounts only. */
  private async recipients(courseId: string, statuses: ApplicationStatus[]) {
    const apps = await this.prisma.application.findMany({
      where: { courseId, status: { in: statuses }, user: { deletedAt: null, anonymizedAt: null } },
      select: { userId: true, status: true },
    });
    const byUser = new Map<string, boolean>();
    for (const a of apps) byUser.set(a.userId, (byUser.get(a.userId) ?? false) || a.status === 'ENROLLED');
    return [...byUser].map(([userId, enrolled]) => ({ userId, enrolled }));
  }

  async audience(courseId: string, statuses: ApplicationStatus[]) {
    await this.course(courseId);
    return { count: (await this.recipients(courseId, statuses)).length };
  }

  async send(courseId: string, input: AnnouncementInput & { idempotencyKey: string }, admin: Actor) {
    // Same key = same announcement (a retried request after a lost response): never send twice.
    const existing = await this.prisma.announcement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { _count: { select: { recipients: true } } },
    });
    if (existing) return { id: existing.id, recipients: existing._count.recipients };

    const course = await this.course(courseId);
    const people = await this.recipients(courseId, input.statuses);
    if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: 'Nobody matches the selected statuses' });
    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const a = await tx.announcement.create({
          data: {
            courseId,
            createdById: admin.id,
            idempotencyKey: input.idempotencyKey,
            subjectEn: input.subjectEn,
            subjectAr: input.subjectAr,
            bodyEn: input.bodyEn,
            bodyAr: input.bodyAr,
            statuses: input.statuses,
          },
        });
        await tx.announcementRecipient.createMany({ data: people.map((p) => ({ announcementId: a.id, userId: p.userId, enrolled: p.enrolled })) });
        // Enrolled students land on the learning page; everyone else on their dashboard.
        await tx.notification.createMany({
          data: people.map((p) => ({
            userId: p.userId,
            type: 'course.announcement',
            titleEn: `${course.titleEn}: ${input.subjectEn}`,
            titleAr: `${course.titleAr || course.titleEn}: ${subjectAr}`,
            bodyEn: input.bodyEn,
            bodyAr,
            link: p.enrolled ? `/learn/${course.slug}` : '/dashboard',
          })),
        });
        await this.audit.log(
          { actorId: admin.id, action: 'course.announcement_sent', entityType: 'Announcement', entityId: a.id, metadata: { courseId, recipients: people.length } },
          tx,
        );
        return a.id;
      });
    } catch (err) {
      // Two identical requests at once: the second one returns the first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const a = await this.prisma.announcement.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
        return { id: a.id, recipients: await this.prisma.announcementRecipient.count({ where: { announcementId: a.id } }) };
      }
      throw err;
    }

    void this.delivery.process().catch(() => undefined);
    return { id, recipients: people.length };
  }

  /** Past announcements for the course, newest first, with live delivery counts. */
  async history(courseId: string) {
    await this.course(courseId);
    const list = await this.prisma.announcement.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { email: true } } },
    });
    const ids = list.map((a) => a.id);
    const [students, waitlist] = await Promise.all([
      this.prisma.announcementRecipient.groupBy({ by: ['announcementId', 'status'], where: { announcementId: { in: ids } }, _count: { _all: true } }),
      // Waiting-list announcements are delivered to CourseInterest rows instead.
      this.prisma.courseInterest.groupBy({ by: ['announcementId', 'deliveryStatus'], where: { announcementId: { in: ids } }, _count: { _all: true } }),
    ]);
    const counts = [
      ...students.map((c) => ({ id: c.announcementId, status: c.status as string, n: c._count._all })),
      ...waitlist.map((c) => ({ id: c.announcementId, status: c.deliveryStatus as string, n: c._count._all })),
    ];
    const n = (id: string, status: string) => counts.filter((c) => c.id === id && c.status === status).reduce((s, c) => s + c.n, 0);
    return list.map((a) => ({
      id: a.id,
      at: a.createdAt.toISOString(),
      by: a.createdBy?.email ?? null,
      /** The speaker who sent it (null when the team did). */
      fromSpeaker: a.fromName,
      subject: a.subjectEn,
      statuses: a.statuses as string[],
      recipients: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'].reduce((s, st) => s + n(a.id, st), 0),
      pending: n(a.id, 'PENDING'),
      sent: n(a.id, 'SENT'),
      failed: n(a.id, 'FAILED'),
      skipped: n(a.id, 'SKIPPED'),
    }));
  }
}
