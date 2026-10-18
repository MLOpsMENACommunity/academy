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
  type TeachAnnouncementsDto,
} from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AnnouncementDelivery } from '../announcements/announcement-delivery.service';
import { AuditService } from '../audit/audit.service';
import { CourseAccessService, type Teacher } from '../course-access/course-access.service';
import { setCourseInstructors, syncCourseInstructors } from '../course-staff/staff-sync';
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
 * Staff and speakers' announcements, and speakers' course assignments (admin).
 *
 * Course staff whose role has ANNOUNCE (course-staff/) can message the course's ENROLLED
 * students (Teaching → {course} → Announcements, or the speaker portal); a speaker can also
 * message the registrants of any published live session they speak at, host or guest.
 * "Assigning" a speaker to a course (Admin → Speakers → {speaker}) adds their profile to the
 * course staff (Co-instructor, or Main instructor when the course has none).
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
    private readonly access: CourseAccessService,
  ) {}

  // ------------------------------------------------------------------ who may reach whom

  private profile(userId: string) {
    return this.prisma.instructor.findUnique({ where: { userId }, select: { id: true, name: true, nameAr: true } });
  }

  /** The courses this account may announce to: on the staff, in a role with ANNOUNCE (CourseAccessService). */
  private courseWhere(userId: string): Prisma.CourseWhereInput {
    return this.access.staffCoursesWhere(userId, 'ANNOUNCE');
  }

  /** "From …" on a message: the speaker profile's name, else the account's, else the course team. */
  private async sender(userId: string): Promise<{ name: string; nameAr: string | null; instructorId: string | null }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { speakerProfile: { select: { id: true, name: true, nameAr: true } }, profile: { select: { fullNameEn: true, fullNameAr: true } } },
    });
    if (u?.speakerProfile) return { name: u.speakerProfile.name, nameAr: u.speakerProfile.nameAr || null, instructorId: u.speakerProfile.id };
    const en = u?.profile?.fullNameEn?.trim();
    return { name: en || 'The course team', nameAr: u?.profile?.fullNameAr?.trim() || (en ? null : 'فريق الدورة'), instructorId: null };
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
        where: this.courseWhere(userId),
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

  /**
   * Teaching → {course} → Announcements (staff with ANNOUNCE, checked by the caller): who would
   * get a message, what the course's staff sent (counts only, never who), and the limits.
   */
  async courseOverview(courseId: string, userId: string, now = new Date()): Promise<TeachAnnouncementsDto> {
    const since = new Date(now.getTime() - DAY_MS);
    const [audience, history, today, mine] = await Promise.all([
      this.prisma.application.count({ where: { courseId, status: 'ENROLLED', user: LIVE_USER } }),
      this.prisma.announcement.findMany({ where: { courseId, fromName: { not: null } }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.announcement.count({ where: { courseId, fromName: { not: null }, createdAt: { gt: since } } }),
      this.prisma.announcement.count({ where: { createdById: userId, fromName: { not: null }, createdAt: { gt: since } } }),
    ]);
    const counts = await this.prisma.announcementRecipient.groupBy({
      by: ['announcementId', 'status'],
      where: { announcementId: { in: history.map((a) => a.id) } },
      _count: { _all: true },
    });
    const n = (id: string, status?: string) => counts.filter((c) => c.announcementId === id && (!status || c.status === status)).reduce((s, c) => s + c._count._all, 0);
    return {
      audience,
      sentToday: today,
      limits: { perTargetPerDay: SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY, perDay: SPEAKER_ANNOUNCEMENTS_PER_DAY, sentTodayByMe: mine },
      sent: history.map((a) => ({
        id: a.id,
        at: a.createdAt.toISOString(),
        subjectEn: a.subjectEn,
        subjectAr: a.subjectAr || a.subjectEn,
        from: a.fromName,
        recipients: n(a.id),
        sent: n(a.id, 'SENT'),
        pending: n(a.id, 'PENDING'),
        failed: n(a.id, 'FAILED'),
      })),
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
    user: Teacher,
    kind: SpeakerAnnouncementTargetKind,
    targetId: string,
    input: SpeakerAnnouncementInput,
    now = new Date(),
  ): Promise<{ id: string; recipients: number }> {
    const userId = user.id;
    // Same key = same message (a retried request after a lost response): never send twice.
    const existing = await this.prisma.announcement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, createdById: true, courseId: true, eventId: true, _count: { select: { recipients: true } } },
    });
    if (existing) return this.replay(existing, userId, kind, targetId);

    let target: { id: string; slug: string; titleEn: string; titleAr: string } | null;
    let from: { name: string; nameAr: string | null; instructorId: string | null };
    if (kind === 'course') {
      // Course staff with ANNOUNCE (and SUPER/ACADEMIC admins): the shared rule, read now.
      if (!(await this.access.can(user, targetId, 'ANNOUNCE'))) throw notYours();
      target = await this.prisma.course.findUnique({ where: { id: targetId }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
      from = await this.sender(userId);
    } else {
      const profile = await this.profile(userId);
      if (!profile) throw notYours();
      target = await this.prisma.liveEvent.findFirst({ where: { id: targetId, ...this.sessionWhere(profile.id, now) }, select: { id: true, slug: true, titleEn: true, titleAr: true } });
      from = { name: profile.name, nameAr: profile.nameAr || null, instructorId: profile.id };
    }
    if (!target) throw notYours();

    const people = kind === 'course' ? await this.courseRecipients(target.id) : await this.sessionRecipients(target.id);
    if (!people.length) throw new BadRequestException({ code: 'NO_RECIPIENTS', message: 'Nobody to send this to yet' });

    const fromName = from.name;
    const fromNameAr = from.nameAr;
    const subjectAr = input.subjectAr || input.subjectEn;
    const bodyAr = input.bodyAr || input.bodyEn;
    const titleAr = target.titleAr || target.titleEn;
    const link = kind === 'course' ? `/learn/${target.slug}#announcements` : `/sessions/${target.slug}`;
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
            metadata: { [kind === 'course' ? 'courseId' : 'eventId']: target.id, instructorId: from.instructorId, recipients: people.length },
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
      select: { id: true, userId: true, user: { select: { email: true, role: true, deletedAt: true } } },
    });
    if (!i) throw new NotFoundException('Speaker not found');
    return i;
  }

  /** Staff rows of this speaker: by their profile, or by the account behind it. */
  private staffOf(i: { id: string; userId: string | null }): Prisma.CourseStaffWhereInput {
    return { OR: [{ instructorId: i.id }, ...(i.userId ? [{ userId: i.userId }] : [])] };
  }

  /** The courses whose staff this speaker is on (any role), and the ones they could join. */
  async assignments(instructorId: string): Promise<SpeakerAssignmentsDto> {
    const i = await this.instructor(instructorId);
    const [rows, available] = await Promise.all([
      this.prisma.courseStaff.findMany({
        where: this.staffOf(i),
        orderBy: { course: { createdAt: 'desc' } },
        select: { course: { select: courseSelect }, role: { select: { name: true } } },
      }),
      this.prisma.course.findMany({
        where: { status: { not: 'ARCHIVED' }, staff: { none: this.staffOf(i) } },
        orderBy: { createdAt: 'desc' },
        select: courseSelect,
      }),
    ]);
    const dto = (c: AssignedCourseDto, roleName: string | null = null): AssignedCourseDto => ({
      id: c.id,
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr || c.titleEn,
      status: c.status,
      roleName,
    });
    const seen = new Set<string>();
    return {
      // Any account can be course staff now; it acts while it isn't deleted.
      account: i.user ? { email: i.user.email, role: i.user.role, active: !i.user.deletedAt } : null,
      assigned: rows.filter((r) => !seen.has(r.course.id) && seen.add(r.course.id)).map((r) => dto(r.course, r.role.name)),
      available: available.map((c) => dto(c)),
    };
  }

  /**
   * A shortcut to the course staff: adds the speaker's profile (and account) as a Co-instructor,
   * or as the Main instructor when the course has none. Archived courses can't be assigned.
   */
  async assign(instructorId: string, courseId: string, actorId: string): Promise<SpeakerAssignmentsDto> {
    const i = await this.instructor(instructorId);
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, status: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status === 'ARCHIVED') throw new BadRequestException({ code: 'COURSE_ARCHIVED', message: 'Archived courses cannot be assigned' });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-staff:${courseId}`}))`;
      if (await tx.courseStaff.count({ where: { courseId, ...this.staffOf(i) } })) return;
      const current = await tx.courseStaff.findMany({
        where: { courseId, instructorId: { not: null }, role: { builtin: { in: ['MAIN', 'CO'] } } },
        select: { instructorId: true, order: true, role: { select: { order: true } } },
      });
      const ids = current.sort((a, b) => a.role.order - b.role.order || a.order - b.order).map((r) => r.instructorId!);
      await setCourseInstructors(tx, courseId, [...ids, instructorId]);
      await this.audit.log({ actorId, action: 'instructor.course_assigned', entityType: 'Instructor', entityId: instructorId, metadata: { courseId } }, tx);
    });
    return this.assignments(instructorId);
  }

  /** Takes the speaker off the course staff (their profile and their account). */
  async unassign(instructorId: string, courseId: string, actorId: string): Promise<SpeakerAssignmentsDto> {
    const i = await this.instructor(instructorId);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.courseStaff.deleteMany({ where: { courseId, ...this.staffOf(i) } });
      if (removed.count) {
        await syncCourseInstructors(tx, courseId);
        await this.audit.log({ actorId, action: 'instructor.course_unassigned', entityType: 'Instructor', entityId: instructorId, metadata: { courseId } }, tx);
      }
    });
    return this.assignments(instructorId);
  }
}
