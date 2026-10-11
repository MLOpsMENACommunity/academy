import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  SPEAKER_ANNOUNCEMENTS_PER_DAY,
  SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY,
  SPEAKER_SESSION_ANNOUNCE_DAYS,
  type AssignedCourseDto,
  type SpeakerAnnouncementInput,
  type SpeakerAnnouncementTargetKind,
  type SpeakerAnnouncementsDto,
  type SpeakerAssignmentsDto,
  type SpeakerSentAnnouncementDto,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AnnouncementDelivery } from '../announcements/announcement-delivery.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** People who can receive mail: not deleted, not anonymised. */
const LIVE_USER = { deletedAt: null, anonymizedAt: null } satisfies Prisma.UserWhereInput;

const courseSelect = { id: true, slug: true, titleEn: true, titleAr: true, status: true } satisfies Prisma.CourseSelect;

/** The same answer for "doesn't exist" and "not yours": a speaker can't probe other ids. */
function notYours(): ForbiddenException {
  return new ForbiddenException({ code: 'NOT_YOUR_AUDIENCE', message: 'You can only send announcements to your assigned courses and your own sessions' });
}

function limitReached(scope: 'target' | 'day'): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: scope === 'target' ? 'SPEAKER_TARGET_LIMIT' : 'SPEAKER_DAILY_LIMIT',
      message:
        scope === 'target'
          ? `At most ${SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY} announcements per course or session in 24 hours`
          : `At most ${SPEAKER_ANNOUNCEMENTS_PER_DAY} announcements in 24 hours`,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Speakers' announcements (speaker portal) and their course assignments (admin).
 *
 * A speaker is "assigned" to a course when their public speaker profile (Instructor, linked
 * to their account by Instructor.userId) is one of the course's instructors (CourseInstructor):
 * the same link that lists them on the course page. They can then message the course's
 * ENROLLED students; and the registrants of any published live session they speak at, host
 * or guest. Nothing else (no materials, assessments or grading).
 *
 * Messages reuse the course announcement queue (Announcement + AnnouncementRecipient,
 * AnnouncementDelivery's bulk email lane, in-app notifications, the learn page), go out at
 * once, and carry the speaker's name ("From …"). Speakers only ever see counts, never who.
 */
@Injectable()
export class SpeakerAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: AnnouncementDelivery,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ who may reach whom

  private profile(userId: string) {
    return this.prisma.instructor.findUnique({ where: { userId }, select: { id: true, name: true, nameAr: true } });
  }

  private courseWhere(instructorId: string): Prisma.CourseWhereInput {
    return { status: { not: 'ARCHIVED' }, instructors: { some: { instructorId } } };
  }

  private sessionWhere(instructorId: string, now: Date): Prisma.LiveEventWhereInput {
    return {
      status: 'PUBLISHED',
      startsAt: { gte: new Date(now.getTime() - SPEAKER_SESSION_ANNOUNCE_DAYS * DAY_MS) },
      OR: [{ speakerId: instructorId }, { coSpeakers: { some: { instructorId } } }],
    };
  }

  private courseRecipients(courseId: string) {
    return this.prisma.application.findMany({
      where: { courseId, status: 'ENROLLED', user: LIVE_USER },
      select: { userId: true },
    });
  }

  private sessionRecipients(eventId: string) {
    return this.prisma.eventRegistration.findMany({ where: { eventId, user: LIVE_USER }, select: { userId: true } });
  }

  // ------------------------------------------------------------------ speaker side

  async overview(userId: string, now = new Date()): Promise<SpeakerAnnouncementsDto> {
    const limits = { perTargetPerDay: SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY, perDay: SPEAKER_ANNOUNCEMENTS_PER_DAY, sentToday: 0 };
    const profile = await this.profile(userId);
    if (!profile) return { hasProfile: false, courses: [], sessions: [], sent: [], limits };
    const since = new Date(now.getTime() - DAY_MS);
    const [courses, sessions, recent, history] = await Promise.all([
      this.prisma.course.findMany({
        where: this.courseWhere(profile.id),
        orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { ...courseSelect, _count: { select: { applications: { where: { status: 'ENROLLED', user: LIVE_USER } } } } },
      }),
      this.prisma.liveEvent.findMany({
        where: this.sessionWhere(profile.id, now),
        orderBy: { startsAt: 'asc' },
        take: 50,
        select: {
          id: true,
          slug: true,
          titleEn: true,
          titleAr: true,
          startsAt: true,
          speakerId: true,
          coSpeakers: { where: { instructorId: profile.id }, select: { role: true } },
          _count: { select: { registrations: { where: { user: LIVE_USER } } } },
        },
      }),
      this.prisma.announcement.findMany({
        where: { createdById: userId, fromName: { not: null }, createdAt: { gt: since } },
        select: { courseId: true, eventId: true },
      }),
      this.prisma.announcement.findMany({
        where: { createdById: userId, fromName: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { course: { select: { titleEn: true, titleAr: true } }, event: { select: { titleEn: true, titleAr: true } } },
      }),
    ]);
    const today = (key: 'courseId' | 'eventId', id: string) => recent.filter((a) => a[key] === id).length;
    return {
      hasProfile: true,
      courses: courses.map((c) => ({
        id: c.id,
        slug: c.slug,
        titleEn: c.titleEn,
        titleAr: c.titleAr || c.titleEn,
        status: c.status,
        audience: c._count.applications,
        sentToday: today('courseId', c.id),
      })),
      sessions: sessions.map((e) => ({
        id: e.id,
        slug: e.slug,
        titleEn: e.titleEn,
        titleAr: e.titleAr || e.titleEn,
        startsAt: e.startsAt.toISOString(),
        role: e.speakerId === profile.id ? 'SPEAKER' : (e.coSpeakers[0]?.role ?? 'GUEST'),
        audience: e._count.registrations,
        sentToday: today('eventId', e.id),
      })),
      sent: await this.withCounts(history),
      limits: { ...limits, sentToday: recent.length },
    };
  }

  private async withCounts(
    list: (Prisma.AnnouncementGetPayload<{ include: { course: { select: { titleEn: true; titleAr: true } }; event: { select: { titleEn: true; titleAr: true } } } }>)[],
  ): Promise<SpeakerSentAnnouncementDto[]> {
    const counts = await this.prisma.announcementRecipient.groupBy({
      by: ['announcementId', 'status'],
      where: { announcementId: { in: list.map((a) => a.id) } },
      _count: { _all: true },
    });
    const n = (id: string, status?: string) =>
      counts.filter((c) => c.announcementId === id && (!status || c.status === status)).reduce((s, c) => s + c._count._all, 0);
    return list.map((a) => {
      const target = a.course ?? a.event;
      return {
        id: a.id,
        at: a.createdAt.toISOString(),
        kind: a.eventId ? 'session' : 'course',
        targetId: (a.courseId ?? a.eventId)!,
        targetTitleEn: target?.titleEn ?? '',
        targetTitleAr: target?.titleAr || target?.titleEn || '',
        subjectEn: a.subjectEn,
        subjectAr: a.subjectAr || a.subjectEn,
        recipients: n(a.id),
        sent: n(a.id, 'SENT'),
        pending: n(a.id, 'PENDING'),
        // Skipped = the account was deleted before delivery: not a failure the speaker can act on.
        failed: n(a.id, 'FAILED'),
      };
    });
  }

  /**
   * Sends at once to the course's enrolled students or the session's registrants: an in-app
   * notification now, an email each from the durable queue. 403 for anything that isn't the
   * speaker's own audience (an unknown id included); 429 past the rate limits.
   */
  async send(
    userId: string,
    kind: SpeakerAnnouncementTargetKind,
    targetId: string,
    input: SpeakerAnnouncementInput,
    now = new Date(),
  ): Promise<{ id: string; recipients: number }> {
    // Same key = same message (a retried request after a lost response): never send twice.
    const existing = await this.prisma.announcement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, createdById: true, courseId: true, eventId: true, _count: { select: { recipients: true } } },
    });
    if (existing) return this.replay(existing, userId, kind, targetId);

    const profile = await this.profile(userId);
    if (!profile) throw notYours();
    const target =
      kind === 'course'
        ? await this.prisma.course.findFirst({ where: { id: targetId, ...this.courseWhere(profile.id) }, select: { id: true, slug: true, titleEn: true, titleAr: true } })
        : await this.prisma.liveEvent.findFirst({ where: { id: targetId, ...this.sessionWhere(profile.id, now) }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
    if (!target) throw notYours();

    const people = kind === 'course' ? await this.courseRecipients(target.id) : await this.sessionRecipients(target.id);
    if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: 'Nobody to send this to yet' });

    const fromName = profile.name;
    const fromNameAr = profile.nameAr || null;
    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;
    const titleAr = target.titleAr || target.titleEn;
    const link = kind === 'course' ? `/learn/${target.slug}` : `/sessions/${target.slug}`;
    const since = new Date(now.getTime() - DAY_MS);

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        // One send at a time per speaker, so two parallel requests can't both pass the limits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`speaker-announcement:${userId}`}))`;
        const mine = { createdById: userId, fromName: { not: null }, createdAt: { gt: since } } satisfies Prisma.AnnouncementWhereInput;
        const [forTarget, forDay] = await Promise.all([
          tx.announcement.count({ where: { ...mine, ...(kind === 'course' ? { courseId: target.id } : { eventId: target.id }) } }),
          tx.announcement.count({ where: mine }),
        ]);
        if (forDay >= SPEAKER_ANNOUNCEMENTS_PER_DAY) throw limitReached('day');
        if (forTarget >= SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY) throw limitReached('target');

        const a = await tx.announcement.create({
          data: {
            ...(kind === 'course' ? { courseId: target.id } : { eventId: target.id }),
            createdById: userId,
            idempotencyKey: input.idempotencyKey,
            subjectEn: input.subjectEn,
            subjectAr: input.subjectAr,
            bodyEn: input.bodyEn,
            bodyAr: input.bodyAr,
            // Course messages reach enrolled students only (the learn page shows them to every enrolled student).
            statuses: kind === 'course' ? ['ENROLLED'] : [],
            fromName,
            fromNameAr,
          },
        });
        await tx.announcementRecipient.createMany({ data: people.map((p) => ({ announcementId: a.id, userId: p.userId, enrolled: kind === 'course' })) });
        await tx.notification.createMany({
          data: people.map((p) => ({
            userId: p.userId,
            type: kind === 'course' ? 'course.announcement' : 'session.announcement',
            titleEn: `${target.titleEn}: ${input.subjectEn}`,
            titleAr: `${titleAr}: ${subjectAr}`,
            bodyEn: `From ${fromName}\n${input.bodyEn}`,
            bodyAr: `من ${fromNameAr || fromName}\n${bodyAr}`,
            link,
          })),
        });
        await this.audit.log(
          {
            actorId: userId,
            action: 'announcement.sent_by_speaker',
            entityType: 'Announcement',
            entityId: a.id,
            metadata: { [kind === 'course' ? 'courseId' : 'eventId']: target.id, instructorId: profile.id, recipients: people.length },
          },
          tx,
        );
        return a.id;
      });
    } catch (err) {
      // Two identical requests at once: the second one returns the first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const a = await this.prisma.announcement.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true, createdById: true, courseId: true, eventId: true, _count: { select: { recipients: true } } },
        });
        return this.replay(a, userId, kind, targetId);
      }
      throw err;
    }

    void this.delivery.process().catch(() => undefined);
    return { id, recipients: people.length };
  }

  /** A key reused for a different sender or audience is a client bug, never a way to read another message. */
  private replay(
    a: { id: string; createdById: string | null; courseId: string | null; eventId: string | null; _count: { recipients: number } },
    userId: string,
    kind: SpeakerAnnouncementTargetKind,
    targetId: string,
  ) {
    const same = a.createdById === userId && (kind === 'course' ? a.courseId : a.eventId) === targetId;
    if (!same) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request key was already used' });
    return { id: a.id, recipients: a._count.recipients };
  }

  // ------------------------------------------------------------------ admin side

  private async instructor(id: string) {
    const i = await this.prisma.instructor.findUnique({
      where: { id },
      select: { id: true, user: { select: { email: true, role: true, deletedAt: true } } },
    });
    if (!i) throw new NotFoundException('Speaker not found');
    return i;
  }

  async assignments(instructorId: string): Promise<SpeakerAssignmentsDto> {
    const i = await this.instructor(instructorId);
    const [assigned, available] = await Promise.all([
      this.prisma.courseInstructor.findMany({
        where: { instructorId },
        orderBy: { course: { createdAt: 'desc' } },
        select: { course: { select: courseSelect } },
      }),
      this.prisma.course.findMany({
        where: { status: { not: 'ARCHIVED' }, instructors: { none: { instructorId } } },
        orderBy: { createdAt: 'desc' },
        select: courseSelect,
      }),
    ]);
    const dto = (c: AssignedCourseDto): AssignedCourseDto => ({ id: c.id, slug: c.slug, titleEn: c.titleEn, titleAr: c.titleAr || c.titleEn, status: c.status });
    return {
      account: i.user ? { email: i.user.email, role: i.user.role, active: !i.user.deletedAt && i.user.role === 'SPEAKER' } : null,
      assigned: assigned.map((a) => dto(a.course)),
      available: available.map(dto),
    };
  }

  /** Adds the speaker to the course's instructors (last in order). Archived courses can't be assigned. */
  async assign(instructorId: string, courseId: string, actorId: string): Promise<SpeakerAssignmentsDto> {
    await this.instructor(instructorId);
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, status: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status === 'ARCHIVED') throw new BadRequestException({ code: 'COURSE_ARCHIVED', message: 'Archived courses cannot be assigned' });
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.courseInstructor.findUnique({ where: { courseId_instructorId: { courseId, instructorId } } });
      if (exists) return;
      const last = await tx.courseInstructor.aggregate({ where: { courseId }, _max: { order: true } });
      await tx.courseInstructor.create({ data: { courseId, instructorId, order: (last._max.order ?? -1) + 1 } });
      await this.audit.log({ actorId, action: 'instructor.course_assigned', entityType: 'Instructor', entityId: instructorId, metadata: { courseId } }, tx);
    });
    return this.assignments(instructorId);
  }

  async unassign(instructorId: string, courseId: string, actorId: string): Promise<SpeakerAssignmentsDto> {
    await this.instructor(instructorId);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.courseInstructor.deleteMany({ where: { courseId, instructorId } });
      if (removed.count) {
        await this.audit.log({ actorId, action: 'instructor.course_unassigned', entityType: 'Instructor', entityId: instructorId, metadata: { courseId } }, tx);
      }
    });
    return this.assignments(instructorId);
  }
}
