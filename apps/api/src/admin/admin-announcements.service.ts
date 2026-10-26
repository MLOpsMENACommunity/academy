import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TELEGRAM_REQUEST_LINK, TELEGRAM_REQUEST_MARKER, type AnnouncementInput, type ApplicationStatus, type TelegramRequestInput } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AnnouncementDelivery } from '../announcements/announcement-delivery.service';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** The fixed "add your Telegram username" message, in both languages. */
const TELEGRAM_REQUEST = {
  subjectEn: 'Please add your Telegram username',
  subjectAr: 'من فضلك أضف اسم المستخدم على Telegram',
  bodyEn:
    "The course group, session updates and quick help happen on Telegram, and your profile doesn't have a Telegram username yet.\n\n" +
    'Please open your profile, go to Community and add it: your username, not your phone number (find it in Telegram → Settings). It takes a minute.',
  bodyAr:
    'مجموعة الدورة وتحديثات الجلسات والمساعدة السريعة تتم على Telegram، ولا يحتوي ملفك الشخصي على اسم مستخدم Telegram بعد.\n\n' +
    'من فضلك افتح ملفك الشخصي، ثم قسم المجتمع وأضفه: اسم المستخدم وليس رقم الهاتف (تجده في Telegram ← الإعدادات). لن يستغرق ذلك سوى دقيقة.',
};

type Recipient = { userId: string; enrolled: boolean };

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
  private async recipients(courseId: string, statuses: ApplicationStatus[]): Promise<Recipient[]> {
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

  /** Enrolled students (live accounts) whose profile has no Telegram username yet. */
  private async withoutTelegram(courseId: string): Promise<Recipient[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        courseId,
        user: { deletedAt: null, anonymizedAt: null, OR: [{ profile: { is: null } }, { profile: { is: { telegramUsername: null } } }] },
      },
      select: { userId: true },
    });
    return rows.map((r) => ({ userId: r.userId, enrolled: true }));
  }

  async telegramAudience(courseId: string) {
    await this.course(courseId);
    return { count: (await this.withoutTelegram(courseId)).length };
  }

  /** Asks the course's enrolled students without a Telegram username to add it (fixed message, opens the profile). */
  async requestTelegram(courseId: string, input: TelegramRequestInput, admin: Actor) {
    return this.queue(
      courseId,
      input.idempotencyKey,
      { ...TELEGRAM_REQUEST, statuses: [TELEGRAM_REQUEST_MARKER], link: TELEGRAM_REQUEST_LINK },
      () => this.withoutTelegram(courseId),
      { action: 'course.telegram_requested', noneMessage: 'Every enrolled student already has a Telegram username' },
      admin,
    );
  }

  async send(courseId: string, input: AnnouncementInput & { idempotencyKey: string }, admin: Actor) {
    return this.queue(
      courseId,
      input.idempotencyKey,
      { subjectEn: input.subjectEn, subjectAr: input.subjectAr, bodyEn: input.bodyEn, bodyAr: input.bodyAr, statuses: input.statuses, link: null },
      () => this.recipients(courseId, input.statuses),
      { action: 'course.announcement_sent', noneMessage: 'Nobody matches the selected statuses' },
      admin,
    );
  }

  /** Records the announcement, its recipients and their notifications in one go, then starts the emails. */
  private async queue(
    courseId: string,
    idempotencyKey: string,
    /** `link`: where the notification opens instead of the course (or dashboard). */
    input: { subjectEn: string; subjectAr: string; bodyEn: string; bodyAr: string; statuses: string[]; link: string | null },
    who: () => Promise<Recipient[]>,
    opts: { action: string; noneMessage: string },
    admin: Actor,
  ) {
    // Same key = same announcement (a retried request after a lost response): never send twice.
    const existing = await this.prisma.announcement.findUnique({
      where: { idempotencyKey },
      include: { _count: { select: { recipients: true } } },
    });
    if (existing) return { id: existing.id, recipients: existing._count.recipients };

    const course = await this.course(courseId);
    const people = await who();
    if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: opts.noneMessage });
    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const a = await tx.announcement.create({
          data: {
            courseId,
            createdById: admin.id,
            idempotencyKey,
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
            link: input.link ?? (p.enrolled ? `/learn/${course.slug}#announcements` : '/dashboard'),
          })),
        });
        await this.audit.log(
          { actorId: admin.id, action: opts.action, entityType: 'Announcement', entityId: a.id, metadata: { courseId, recipients: people.length } },
          tx,
        );
        return a.id;
      });
    } catch (err) {
      // Two identical requests at once: the second one returns the first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const a = await this.prisma.announcement.findUniqueOrThrow({ where: { idempotencyKey } });
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
