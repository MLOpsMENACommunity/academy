import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistLinks } from './waitlist-links';

const MAX_ATTEMPTS = 3;
const BATCH = 50;

/**
 * Emails queued announcements. Each recipient row is PENDING until sent, so the queue
 * survives restarts and deploys: it's processed right after an announcement is created,
 * on startup, and on every jobs tick. Emails use the bulk lane of the shared email
 * queue, so sign-up and password emails are never held up or rate-limited by it.
 * Waiting-list announcements ("the course is open") use the same queue, with the
 * CourseInterest rows as their recipients.
 */
@Injectable()
export class AnnouncementDelivery implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnnouncementDelivery.name);
  private running: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly links: WaitlistLinks,
  ) {}

  onApplicationBootstrap(): void {
    // Resume anything interrupted by a restart, without delaying startup.
    void this.process().catch(() => undefined);
  }

  async pending(): Promise<number> {
    const [students, waitlist] = await Promise.all([
      this.prisma.announcementRecipient.count({ where: { status: 'PENDING' } }),
      this.prisma.courseInterest.count({ where: { deliveryStatus: 'PENDING' } }),
    ]);
    return students + waitlist;
  }

  /** Sends every pending email once per call; concurrent calls share one run. */
  process(): Promise<number> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<number> {
    // One queue failing must not hold up the other.
    let sent = 0;
    for (const [name, drain] of [
      ['announcements', () => this.drainStudents()],
      ['waiting list', () => this.drainWaitlist()],
    ] as const) {
      try {
        sent += await drain();
      } catch (err) {
        this.logger.error(`Delivery run for ${name} failed: ${(err as Error).name}`);
      }
    }
    return sent;
  }

  private async drainStudents(): Promise<number> {
    const tried = new Set<string>();
    let sent = 0;
    for (;;) {
      const batch = await this.prisma.announcementRecipient.findMany({
        where: { status: 'PENDING', id: { notIn: [...tried] } },
        orderBy: [{ announcement: { createdAt: 'asc' } }, { id: 'asc' }],
        take: BATCH,
        include: {
          user: { select: { email: true, locale: true, deletedAt: true, anonymizedAt: true } },
          announcement: { include: { course: { select: { slug: true, titleEn: true, titleAr: true } } } },
        },
      });
      if (!batch.length) break;
      for (const r of batch) {
        tried.add(r.id);
        if (r.user.deletedAt || r.user.anonymizedAt) {
          await this.prisma.announcementRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED' } });
          continue;
        }
        const a = r.announcement;
        const locale = r.user.locale === 'ar' ? 'ar' : 'en';
        const ar = locale === 'ar';
        const ok = await this.email.send(
          r.user.email,
          locale,
          {
            name: 'announcement',
            courseTitle: ar ? a.course.titleAr || a.course.titleEn : a.course.titleEn,
            subject: ar ? a.subjectAr || a.subjectEn : a.subjectEn,
            body: ar ? a.bodyAr || a.bodyEn : a.bodyEn,
            url: this.email.url(locale, r.enrolled ? `/learn/${a.course.slug}` : '/dashboard'),
          },
          { bulk: true },
        );
        const attempts = r.attempts + 1;
        await this.prisma.announcementRecipient.update({
          where: { id: r.id },
          data: ok
            ? { status: 'SENT', attempts, sentAt: new Date() }
            : { status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts },
        });
        if (ok) sent++;
      }
    }
    if (tried.size) this.logger.log(`Announcements: ${sent}/${tried.size} emails sent this run`);
    return sent;
  }

  private async drainWaitlist(): Promise<number> {
    const tried = new Set<string>();
    let sent = 0;
    for (;;) {
      const batch = await this.prisma.courseInterest.findMany({
        where: { deliveryStatus: 'PENDING', announcementId: { not: null }, id: { notIn: [...tried] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        include: {
          user: { select: { deletedAt: true } },
          announcement: { include: { course: { select: { slug: true, titleEn: true, titleAr: true } } } },
        },
      });
      if (!batch.length) break;
      for (const r of batch) {
        tried.add(r.id);
        const a = r.announcement!;
        if (r.user?.deletedAt) {
          await this.prisma.courseInterest.updateMany({ where: { id: r.id }, data: { deliveryStatus: 'SKIPPED' } });
          continue;
        }
        const locale = r.locale === 'ar' ? 'ar' : 'en';
        const ar = locale === 'ar';
        const ok = await this.email.send(
          r.email,
          locale,
          {
            name: 'waitlistOpen',
            courseTitle: ar ? a.course.titleAr || a.course.titleEn : a.course.titleEn,
            subject: ar ? a.subjectAr || a.subjectEn : a.subjectEn,
            body: ar ? a.bodyAr || a.bodyEn : a.bodyEn,
            url: this.email.url(locale, `/courses/${a.course.slug}`),
            leaveUrl: this.links.leaveUrl(locale, r.id),
          },
          { bulk: true },
        );
        const attempts = r.attempts + 1;
        // The row may be gone by now (the person left the list): updateMany then does nothing.
        await this.prisma.courseInterest.updateMany({
          where: { id: r.id },
          data: ok
            ? { deliveryStatus: 'SENT', attempts, notifiedAt: new Date() }
            : { deliveryStatus: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts },
        });
        if (ok) sent++;
      }
    }
    if (tried.size) this.logger.log(`Waiting list: ${sent}/${tried.size} emails sent this run`);
    return sent;
  }
}
