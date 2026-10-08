import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AnnouncementInput, ApplicationStatus } from '@academy/shared';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

/** Resend allows about 2 requests a second on standard plans; stay under it. */
const SEND_INTERVAL_MS = 600;

interface Recipient {
  id: string;
  email: string;
  locale: 'en' | 'ar';
  enrolled: boolean;
}

/**
 * Messages from admins to a course's students (e.g. the study-group link, quiz links,
 * a schedule change): an in-app notification for everyone right away, and an email
 * each, sent in the background at a pace the email provider accepts.
 */
@Injectable()
export class AdminAnnouncementsService {
  private readonly logger = new Logger(AdminAnnouncementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private async course(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  /** People with an application in one of the statuses: one entry per person, live accounts only. */
  private async recipients(courseId: string, statuses: ApplicationStatus[]): Promise<Recipient[]> {
    const apps = await this.prisma.application.findMany({
      where: { courseId, status: { in: statuses }, user: { deletedAt: null, anonymizedAt: null } },
      select: { status: true, user: { select: { id: true, email: true, locale: true } } },
    });
    const byUser = new Map<string, Recipient>();
    for (const a of apps) {
      const prev = byUser.get(a.user.id);
      byUser.set(a.user.id, {
        id: a.user.id,
        email: a.user.email,
        locale: a.user.locale === 'ar' ? 'ar' : 'en',
        enrolled: (prev?.enrolled ?? false) || a.status === 'ENROLLED',
      });
    }
    return [...byUser.values()];
  }

  async audience(courseId: string, statuses: ApplicationStatus[]) {
    await this.course(courseId);
    return { count: (await this.recipients(courseId, statuses)).length };
  }

  async send(courseId: string, input: AnnouncementInput, admin: Actor) {
    const course = await this.course(courseId);
    const people = await this.recipients(courseId, input.statuses);
    if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: 'Nobody matches the selected statuses' });

    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;
    // Enrolled students land on the learning page; everyone else on their dashboard.
    const linkFor = (r: Recipient) => (r.enrolled ? `/learn/${course.slug}` : '/dashboard');
    await this.prisma.notification.createMany({
      data: people.map((r) => ({
        userId: r.id,
        type: 'course.announcement',
        titleEn: `${course.titleEn}: ${input.subjectEn}`,
        titleAr: `${course.titleAr || course.titleEn}: ${subjectAr}`,
        bodyEn: input.bodyEn,
        bodyAr,
        link: linkFor(r),
      })),
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'course.announcement_sent',
      entityType: 'Course',
      entityId: courseId,
      metadata: { subject: input.subjectEn, statuses: input.statuses, recipients: people.length },
    });

    // Emails go out after the response, paced for the provider; failures are counted, not retried.
    void this.deliver(course, people, { ...input, subjectAr, bodyAr }, linkFor);
    return { recipients: people.length };
  }

  private async deliver(
    course: { id: string; titleEn: string; titleAr: string },
    people: Recipient[],
    msg: AnnouncementInput & { subjectAr: string; bodyAr: string },
    linkFor: (r: Recipient) => string,
  ): Promise<void> {
    let sent = 0;
    for (const [i, r] of people.entries()) {
      if (i > 0) await new Promise((res) => setTimeout(res, SEND_INTERVAL_MS));
      const ar = r.locale === 'ar';
      const ok = await this.email.send(r.email, r.locale, {
        name: 'announcement',
        courseTitle: ar ? course.titleAr || course.titleEn : course.titleEn,
        subject: ar ? msg.subjectAr : msg.subjectEn,
        body: ar ? msg.bodyAr : msg.bodyEn,
        url: this.email.url(r.locale, linkFor(r)),
      });
      if (ok) sent++;
    }
    this.logger.log(`Announcement for course ${course.id}: ${sent}/${people.length} emails sent`);
    await this.audit
      .log({ actorId: null, action: 'course.announcement_delivered', entityType: 'Course', entityId: course.id, metadata: { sent, failed: people.length - sent } })
      .catch(() => undefined);
  }

  /** Past announcements for the course, newest first, with delivery results when known. */
  async history(courseId: string) {
    await this.course(courseId);
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'Course', entityId: courseId, action: { in: ['course.announcement_sent', 'course.announcement_delivered'] } },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { email: true } } },
    });
    const out: { at: string; by: string | null; subject: string; statuses: string[]; recipients: number; sent: number | null; failed: number | null }[] = [];
    for (const r of rows) {
      const m = r.metadata as Record<string, unknown>;
      if (r.action === 'course.announcement_sent') {
        out.push({
          at: r.createdAt.toISOString(),
          by: r.actor?.email ?? null,
          subject: String(m.subject ?? ''),
          statuses: (m.statuses as string[]) ?? [],
          recipients: Number(m.recipients ?? 0),
          sent: null,
          failed: null,
        });
      } else {
        // Deliveries finish in order, so attach to the oldest one still waiting.
        const pending = out.find((x) => x.sent === null);
        if (pending) {
          pending.sent = Number(m.sent ?? 0);
          pending.failed = Number(m.failed ?? 0);
        }
      }
    }
    return out.reverse();
  }
}
