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
} from '@academy/shared';
import type { Course } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { buildIcs } from './ics';

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
  ) {}

  /** The course, if the user may see its content; throws otherwise. */
  private async access(user: AuthUser, slug: string): Promise<Course> {
    const course = await this.prisma.course.findUnique({ where: { slug } });
    if (!course) throw new NotFoundException('Course not found');
    if (user.role === 'ADMIN') return course;
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { id: true },
    });
    if (!enrolled) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    return course;
  }

  async course(user: AuthUser, slug: string, now = new Date()): Promise<LearnCourseDto> {
    const course = await this.access(user, slug);
    const [sessions, progress, feedback, pref, profile, s] = await Promise.all([
      this.prisma.courseSession.findMany({ where: { courseId: course.id }, orderBy: { order: 'asc' } }),
      this.prisma.sessionProgress.findMany({ where: { userId: user.id, session: { courseId: course.id } }, select: { sessionId: true } }),
      this.prisma.sessionFeedback.findMany({ where: { userId: user.id, courseId: course.id } }),
      this.prisma.reminderPreference.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }),
      this.prisma.profile.findUnique({ where: { userId: user.id }, select: { googleEmail: true } }),
      this.settings.get(),
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
      liveLinkRevealMinutes: reveal,
      emailReminders: pref?.emailReminders ?? true,
      progress: { completed, total: sessions.length, percent: sessions.length ? Math.round((completed / sessions.length) * 100) : 0 },
      courseFeedback: courseFb ? { rating: courseFb.rating, comment: courseFb.comment } : null,
      sessions: sessions.map((x) => {
        const visible = user.role === 'ADMIN' || liveLinkVisible(x.startsAt, x.durationMin, reveal, now);
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

  private async sessionOf(user: AuthUser, slug: string, sessionId: string) {
    const course = await this.access(user, slug);
    const session = await this.prisma.courseSession.findFirst({ where: { id: sessionId, courseId: course.id } });
    if (!session) throw new NotFoundException('Session not found');
    return { course, session };
  }

  async setProgress(user: AuthUser, slug: string, sessionId: string, completed: boolean): Promise<void> {
    await this.sessionOf(user, slug, sessionId);
    if (completed) {
      await this.prisma.sessionProgress.upsert({
        where: { userId_sessionId: { userId: user.id, sessionId } },
        update: {},
        create: { userId: user.id, sessionId },
      });
    } else {
      await this.prisma.sessionProgress.deleteMany({ where: { userId: user.id, sessionId } });
    }
  }

  async setFeedback(user: AuthUser, slug: string, input: FeedbackInput, now = new Date()): Promise<void> {
    const course = await this.access(user, slug);
    let sessionId: string | null = null;
    if (input.sessionId) {
      const { session } = await this.sessionOf(user, slug, input.sessionId);
      if (session.startsAt > now) {
        throw new ForbiddenException({ code: 'NOT_STARTED', message: 'Feedback opens once the session has started' });
      }
      sessionId = session.id;
    }
    const existing = await this.prisma.sessionFeedback.findFirst({ where: { userId: user.id, courseId: course.id, sessionId } });
    const data = { rating: input.rating, comment: input.comment ?? null };
    if (existing) await this.prisma.sessionFeedback.update({ where: { id: existing.id }, data });
    else await this.prisma.sessionFeedback.create({ data: { ...data, userId: user.id, courseId: course.id, sessionId } });
  }

  async setReminders(user: AuthUser, slug: string, emailReminders: boolean): Promise<void> {
    const course = await this.access(user, slug);
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
    const courseTitle = locale === 'ar' ? course.titleAr : course.titleEn;
    const url = `${webUrl}/${locale}/learn/${course.slug}`;
    const body = buildIcs(
      courseTitle,
      sessions.map((x) => ({
        uid: x.id,
        title: `${courseTitle}: ${locale === 'ar' ? x.titleAr : x.titleEn}`,
        // The live link is deliberately not in the invite (invites get forwarded). Open the course page.
        description: locale === 'ar' ? `رابط الجلسة في صفحة الدورة: ${url}` : `Join from your course page: ${url}`,
        url,
        start: x.startsAt,
        durationMin: x.durationMin,
      })),
    );
    return { filename: `${course.slug}${sessionId ? `-session-${sessions[0]!.order}` : ''}.ics`, body };
  }

  /** Upcoming sessions across the user's enrolments (for "what's next" on the dashboard). */
  async nextSessions(userId: string, now = new Date()): Promise<NextSessionDto[]> {
    const rows = await this.prisma.courseSession.findMany({
      where: {
        startsAt: { gte: new Date(now.getTime() - 3 * 3600_000) },
        course: { enrollments: { some: { userId } } },
      },
      include: { course: { select: { slug: true, titleEn: true, titleAr: true } } },
      orderBy: { startsAt: 'asc' },
      take: 5,
    });
    return rows
      .filter((r) => r.startsAt.getTime() + r.durationMin * 60_000 > now.getTime())
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
