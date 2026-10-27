import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { TELEGRAM_REQUEST_LINK, TELEGRAM_REQUEST_MARKER } from '@academy/shared';
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
 * CourseInterest rows as their recipients: accounts get the course link, and entries
 * without an account (from before joining needed one) a "create your account" variant.
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
          announcement: {
            include: {
              course: { select: { slug: true, titleEn: true, titleAr: true } },
              event: { select: { slug: true, titleEn: true, titleAr: true } },
            },
          },
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
        // A course's students, or a live session's registrants (exactly one is set).
        const target = (a.course ?? a.event)!;
        // "Add your Telegram username" opens the profile instead.
        const profile = Array.isArray(a.statuses) && a.statuses.includes(TELEGRAM_REQUEST_MARKER);
        const path = profile ? TELEGRAM_REQUEST_LINK : a.event ? `/sessions/${a.event.slug}` : r.enrolled ? `/learn/${target.slug}#announcements` : '/dashboard';
        const ok = await this.email.send(
          r.user.email,
          locale,
          {
            name: 'announcement',
            courseTitle: ar ? target.titleAr || target.titleEn : target.titleEn,
            subject: ar ? a.subjectAr || a.subjectEn : a.subjectEn,
            body: ar ? a.bodyAr || a.bodyEn : a.bodyEn,
            url: this.email.url(locale, path),
            from: ar ? a.fromNameAr || a.fromName : a.fromName,
            session: Boolean(a.event),
            profile,
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

  /**
   * A guest entry (joined before the waiting list needed an account): applying needs an
   * account, so the button goes to sign-up (or sign-in, when the address has an account that
   * hasn't confirmed it yet: verified accounts were linked when the list was notified, see
   * WaitlistService.notify) and then back to the course. The address goes in the fragment,
   * like "Enrol by email" invitations: it prefills the form and never reaches a server log.
   */
  private async guestLinks(
    email: string,
    locale: 'en' | 'ar',
    slug: string,
  ): Promise<{ url: string; hasAccount: boolean; courseUrl: string } | { verifiedUserId: string }> {
    const account = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, emailVerifiedAt: true },
    });
    // Verified since the list was notified: theirs now (linked), and they get the usual email.
    if (account?.emailVerifiedAt) return { verifiedUserId: account.id };
    const q = `returnTo=${encodeURIComponent(`/${locale}/courses/${slug}`)}#email=${encodeURIComponent(email)}`;
    return {
      url: this.email.url(locale, `${account ? '/login' : '/register'}?${q}`),
      hasAccount: Boolean(account),
      courseUrl: this.email.url(locale, `/courses/${slug}`),
    };
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
        // Waiting-list announcements always belong to a course.
        const course = a.course!;
        if (r.user?.deletedAt) {
          await this.prisma.courseInterest.updateMany({ where: { id: r.id }, data: { deliveryStatus: 'SKIPPED' } });
          continue;
        }
        const locale = r.locale === 'ar' ? 'ar' : 'en';
        const ar = locale === 'ar';
        const courseTitle = ar ? course.titleAr || course.titleEn : course.titleEn;
        const subject = ar ? a.subjectAr || a.subjectEn : a.subjectEn;
        const body = ar ? a.bodyAr || a.bodyEn : a.bodyEn;
        const leaveUrl = this.links.leaveUrl(locale, r.id);
        let guest: { url: string; hasAccount: boolean; courseUrl: string } | null = null;
        if (!r.userId) {
          try {
            const links = await this.guestLinks(r.email, locale, course.slug);
            if ('verifiedUserId' in links) await this.prisma.courseInterest.updateMany({ where: { id: r.id, userId: null }, data: { userId: links.verifiedUserId } });
            else guest = links;
          } catch (err) {
            // One failed lookup must not stop the run: count it as a failed attempt and retry later.
            this.logger.error(`Waiting-list sign-up link failed: ${(err as Error).name}`);
            const attempts = r.attempts + 1;
            await this.prisma.courseInterest.updateMany({ where: { id: r.id }, data: { deliveryStatus: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts } });
            continue;
          }
        }
        const ok = !guest
          ? await this.email.send(
              r.email,
              locale,
              { name: 'waitlistOpen', courseTitle, subject, body, url: this.email.url(locale, `/courses/${course.slug}`), leaveUrl },
              { bulk: true },
            )
          : await this.email.send(
              r.email,
              locale,
              { name: 'waitlistOpenGuest', courseTitle, subject, body, ...guest, leaveUrl },
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
