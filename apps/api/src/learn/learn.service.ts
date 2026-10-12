import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  liveLinkVisible,
  recordingKind,
  sessionPhase,
  youtubeId,
  type FeedbackInput,
  type LearnCourseDto,
  type Material,
  type NextSessionDto,
  hasAdminPermission,
} from '@academy/shared';
import type { Course } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { buildIcs } from './ics';
import { courseSessionEvent } from './session-event';

/**
 * Enrolled-student course content. Every method checks enrolment on the
 * server; session links never leave this service for anyone else (admins can
 * preview). Live links additionally stay hidden until shortly before a session.
 */
@Injectable()
export class LearnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly points: PointsService,
  ) {}

  /**
   * The course, if the user may see its content; throws otherwise. Admins may
   * preview (read) any course, but writes (progress, feedback, reminders)
   * require a real enrolment so admin clicks never look like student data.
   */
  private async access(user: AuthUser, slug: string, mode: 'read' | 'write' = 'read'): Promise<Course> {
    const course = await this.prisma.course.findUnique({ where: { slug } });
    if (!course) throw new NotFoundException('Course not found');
    // The academic preset previews (reads) any course; other admins only as enrolled students.
    if (mode === 'read' && hasAdminPermission(user, ['ACADEMIC'])) return course;
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { id: true },
    });
    if (!enrolled) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    return course;
  }

  async course(user: AuthUser, slug: string, now = new Date()): Promise<LearnCourseDto> {
    const course = await this.access(user, slug);
    const [sessions, progress, feedback, pref, profile, s, enrollment, announcements] = await Promise.all([
      this.prisma.courseSession.findMany({ where: { courseId: course.id }, orderBy: { order: 'asc' } }),
      this.prisma.sessionProgress.findMany({ where: { userId: user.id, session: { courseId: course.id } }, select: { sessionId: true } }),
      this.prisma.sessionFeedback.findMany({ where: { userId: user.id, courseId: course.id } }),
      this.prisma.reminderPreference.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }),
      this.prisma.profile.findUnique({ where: { userId: user.id }, select: { googleEmail: true } }),
      this.settings.get(),
      this.prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        select: { driveAccessGranted: true },
      }),
      // Course-wide announcements to enrolled students, plus any sent to this student directly.
      this.prisma.announcement.findMany({
        where: {
          courseId: course.id,
          ...(hasAdminPermission(user, ['ACADEMIC']) ? {} : { OR: [{ statuses: { array_contains: ['ENROLLED'] } }, { recipients: { some: { userId: user.id } } }] }),
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, createdAt: true, subjectEn: true, subjectAr: true, bodyEn: true, bodyAr: true, fromName: true, fromNameAr: true },
      }),
    ]);
    const done = new Set(progress.map((p) => p.sessionId));
    const fbBySession = new Map(feedback.filter((f) => f.sessionId).map((f) => [f.sessionId!, f]));
    const courseFb = feedback.find((f) => !f.sessionId) ?? null;
    const reveal = s.liveLinkRevealMinutes;
    const isPaidDrive = course.type === 'PAID' && course.recordingsPlatform === 'GOOGLE_DRIVE';
    const completed = sessions.filter((x) => done.has(x.id)).length;

    return {
      slug: course.slug,
      titleEn: course.titleEn,
      titleAr: course.titleAr,
      type: course.type,
      deliveryPlatform: course.deliveryPlatform,
      recordingsPlatform: course.recordingsPlatform,
      youtubePlaylistUrl: course.youtubePlaylistUrl,
      driveFolderUrl: isPaidDrive ? course.driveFolderUrl : null,
      googleEmail: profile?.googleEmail ?? null,
      driveAccessGranted: enrollment?.driveAccessGranted ?? false,
      liveLinkRevealMinutes: reveal,
      emailReminders: pref?.emailReminders ?? true,
      progress: { completed, total: sessions.length, percent: sessions.length ? Math.round((completed / sessions.length) * 100) : 0 },
      courseFeedback: courseFb ? { rating: courseFb.rating, comment: courseFb.comment } : null,
      announcements: announcements.map((a) => ({
        id: a.id,
        at: a.createdAt.toISOString(),
        subjectEn: a.subjectEn,
        subjectAr: a.subjectAr || a.subjectEn,
        bodyEn: a.bodyEn,
        bodyAr: a.bodyAr || a.bodyEn,
        fromEn: a.fromName,
        fromAr: a.fromName ? a.fromNameAr || a.fromName : null,
      })),
      sessions: sessions.map((x) => {
        const visible = hasAdminPermission(user, ['ACADEMIC']) || liveLinkVisible(x.startsAt, x.durationMin, reveal, now);
        const fb = fbBySession.get(x.id);
        return {
          id: x.id,
          order: x.order,
          titleEn: x.titleEn,
          titleAr: x.titleAr,
          descriptionEn: x.descriptionEn,
          descriptionAr: x.descriptionAr,
          startsAt: x.startsAt.toISOString(),
          durationMin: x.durationMin,
          phase: sessionPhase(x.startsAt, x.durationMin, now),
          liveLinkAt: new Date(x.startsAt.getTime() - reveal * 60_000).toISOString(),
          liveUrl: visible ? x.liveUrl : null,
          recording: x.recordingUrl
            ? { url: x.recordingUrl, kind: recordingKind(x.recordingUrl), youtubeId: youtubeId(x.recordingUrl) }
            : null,
          materials: (x.materials as Material[] | null) ?? [],
          assignmentUrl: x.assignmentUrl,
          completed: done.has(x.id),
          myFeedback: fb ? { rating: fb.rating, comment: fb.comment } : null,
        };
      }),
    };
  }

  private async sessionOf(user: AuthUser, slug: string, sessionId: string, mode: 'read' | 'write' = 'read') {
    const course = await this.access(user, slug, mode);
    const session = await this.prisma.courseSession.findFirst({ where: { id: sessionId, courseId: course.id } });
    if (!session) throw new NotFoundException('Session not found');
    return { course, session };
  }

  async setProgress(user: AuthUser, slug: string, sessionId: string, completed: boolean): Promise<void> {
    await this.sessionOf(user, slug, sessionId, 'write');
    if (completed) {
      await this.prisma.sessionProgress.upsert({
        where: { userId_sessionId: { userId: user.id, sessionId } },
        update: {},
        create: { userId: user.id, sessionId },
      });
    } else {
      await this.prisma.sessionProgress.deleteMany({ where: { userId: user.id, sessionId } });
    }
    // Session points (and "Finisher"); unmarking takes the points back.
    await this.points.syncSession(user.id, sessionId, completed);
  }

  async setFeedback(user: AuthUser, slug: string, input: FeedbackInput, now = new Date()): Promise<void> {
    const course = await this.access(user, slug, 'write');
    let sessionId: string | null = null;
    if (!input.sessionId) {
      // End-of-course feedback opens once the last session has started.
      const last = await this.prisma.courseSession.findFirst({ where: { courseId: course.id }, orderBy: { startsAt: 'desc' } });
      if (last && last.startsAt > now) {
        throw new ForbiddenException({ code: 'NOT_STARTED', message: 'Course feedback opens at the last session' });
      }
    }
    if (input.sessionId) {
      const { session } = await this.sessionOf(user, slug, input.sessionId, 'write');
      if (session.startsAt > now) {
        throw new ForbiddenException({ code: 'NOT_STARTED', message: 'Feedback opens once the session has started' });
      }
      sessionId = session.id;
    }
    const data = { rating: input.rating, comment: input.comment ?? null };
    const scopeKey = sessionId ?? 'course';
    // One row per student per session (or per course): an atomic upsert, safe under double-submits.
    await this.prisma.sessionFeedback.upsert({
      where: { userId_courseId_scopeKey: { userId: user.id, courseId: course.id, scopeKey } },
      update: data,
      create: { ...data, userId: user.id, courseId: course.id, sessionId, scopeKey },
    });
  }

  async setReminders(user: AuthUser, slug: string, emailReminders: boolean): Promise<void> {
    const course = await this.access(user, slug, 'write');
    await this.prisma.reminderPreference.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      update: { emailReminders },
      create: { userId: user.id, courseId: course.id, emailReminders },
    });
  }

  async ics(user: AuthUser, slug: string, webUrl: string, sessionId?: string): Promise<{ filename: string; body: string }> {
    const course = await this.access(user, slug);
    const sessions = await this.prisma.courseSession.findMany({
      where: { courseId: course.id, ...(sessionId ? { id: sessionId } : {}) },
      orderBy: { order: 'asc' },
    });
    if (sessionId && !sessions.length) throw new NotFoundException('Session not found');
    const locale = (await this.prisma.user.findUnique({ where: { id: user.id }, select: { locale: true } }))?.locale ?? 'en';
    const body = buildIcs(
      locale === 'ar' ? course.titleAr : course.titleEn,
      sessions.map((x) => courseSessionEvent(x, course, locale, webUrl)),
    );
    return { filename: `${course.slug}${sessionId ? `-session-${sessions[0]!.order}` : ''}.ics`, body };
  }

  /** Upcoming sessions across the user's enrolments (for "what's next" on the dashboard). */
  async nextSessions(userId: string, now = new Date()): Promise<NextSessionDto[]> {
    const rows = await this.prisma.courseSession.findMany({
      where: {
        // Sessions can run up to 10 h; ended ones are filtered below.
        startsAt: { gte: new Date(now.getTime() - 10 * 3600_000) },
        course: { status: { in: ['OPEN', 'CLOSED'] }, enrollments: { some: { userId } } },
      },
      include: { course: { select: { slug: true, titleEn: true, titleAr: true } } },
      orderBy: { startsAt: 'asc' },
      take: 30,
    });
    return rows
      .filter((r) => r.startsAt.getTime() + r.durationMin * 60_000 > now.getTime())
      .slice(0, 5)
      .map((r) => ({
        courseSlug: r.course.slug,
        courseTitleEn: r.course.titleEn,
        courseTitleAr: r.course.titleAr,
        sessionId: r.id,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
        startsAt: r.startsAt.toISOString(),
        durationMin: r.durationMin,
      }));
  }
}
