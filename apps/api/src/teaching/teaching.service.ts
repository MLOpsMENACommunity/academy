import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Material,
  SessionMaterialsInput,
  TeachingCourseDetailDto,
  TeachingCourseDto,
  TeachingPointsDto,
  TeachingPointsInput,
  TeachingSessionDto,
  PointsEntryDto,
} from '@academy/shared';
import type { CourseSession, Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { CourseAccessService } from '../course-access/course-access.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/** New assessments a speaker may create in 24 hours (all their courses together). */
export const SPEAKER_ASSESSMENTS_PER_DAY = 30;

/** Students a speaker may see: enrolled in the course, account not deleted. */
const enrolledIn = (courseId: string) => ({ courseId, user: { deletedAt: null } }) satisfies Prisma.EnrollmentWhereInput;

function toSession(s: CourseSession): TeachingSessionDto {
  return {
    id: s.id,
    order: s.order,
    titleEn: s.titleEn,
    titleAr: s.titleAr || s.titleEn,
    startsAt: s.startsAt.toISOString(),
    durationMin: s.durationMin,
    descriptionEn: s.descriptionEn,
    descriptionAr: s.descriptionAr,
    recordingUrl: s.recordingUrl,
    assignmentUrl: s.assignmentUrl,
    materials: (Array.isArray(s.materials) ? s.materials : []) as unknown as Material[],
  };
}

/**
 * The speaker side of teaching a course that isn't about assessments (those reuse
 * AdminAssessmentsService): the list of my courses, the sessions' materials and course points.
 * Callers have already checked that the user teaches the course (TeachesCourseGuard); every id
 * inside it is checked here, with a 404 when it belongs to another course.
 */
@Injectable()
export class TeachingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CourseAccessService,
    private readonly points: PointsService,
  ) {}

  /** Speaker portal → My courses: assigned, not archived. */
  async courses(userId: string): Promise<TeachingCourseDto[]> {
    const list = await this.prisma.course.findMany({
      where: this.access.teachingWhereForUser(userId),
      orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        titleEn: true,
        titleAr: true,
        status: true,
        _count: { select: { enrollments: { where: { user: { deletedAt: null } } }, assessments: true } },
      },
    });
    const pending = await this.prisma.submission.groupBy({
      by: ['assessmentId'],
      where: { assessment: { courseId: { in: list.map((c) => c.id) } }, submittedAt: { not: null }, gradedAt: null },
      _count: { _all: true },
    });
    const owner = await this.prisma.assessment.findMany({ where: { id: { in: pending.map((p) => p.assessmentId) } }, select: { id: true, courseId: true } });
    const courseOf = new Map(owner.map((a) => [a.id, a.courseId]));
    return list.map((c) => ({
      id: c.id,
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr || c.titleEn,
      status: c.status,
      students: c._count.enrollments,
      assessments: c._count.assessments,
      toGrade: pending.filter((p) => courseOf.get(p.assessmentId) === c.id).reduce((n, p) => n + p._count._all, 0),
    }));
  }

  /** 429 once the speaker created SPEAKER_ASSESSMENTS_PER_DAY assessments in the last 24 hours. */
  async assertCreateQuota(userId: string, now = new Date()): Promise<void> {
    const n = await this.prisma.auditLog.count({ where: { actorId: userId, action: 'assessment.created', createdAt: { gt: new Date(now.getTime() - 86_400_000) } } });
    if (n >= SPEAKER_ASSESSMENTS_PER_DAY) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'SPEAKER_ASSESSMENT_LIMIT', message: `At most ${SPEAKER_ASSESSMENTS_PER_DAY} new assessments in 24 hours` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async course(courseId: string): Promise<TeachingCourseDetailDto> {
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, slug: true, titleEn: true, titleAr: true, status: true, sessions: { orderBy: { order: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Course not found');
    return { id: c.id, slug: c.slug, titleEn: c.titleEn, titleAr: c.titleAr || c.titleEn, status: c.status, sessions: c.sessions.map(toSession) };
  }

  // ------------------------------------------------------------------ materials

  /** Only the session's text and links: dates, titles and the live link stay with the admins. */
  async updateMaterials(courseId: string, sessionId: string, input: SessionMaterialsInput, actor: Actor): Promise<TeachingSessionDto> {
    // Fields that weren't sent keep their stored value (undefined leaves a column alone in Prisma).
    const data = {
      descriptionEn: input.descriptionEn,
      descriptionAr: input.descriptionAr,
      recordingUrl: input.recordingUrl,
      assignmentUrl: input.assignmentUrl,
      materials: input.materials as unknown as Prisma.InputJsonValue | undefined,
    };
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.courseSession.updateMany({ where: { id: sessionId, courseId }, data });
      if (!r.count) throw new NotFoundException('Session not found');
      // Edited here now: a later archive import must not overwrite it (as for admin edits).
      await tx.course.updateMany({ where: { id: courseId, importHash: { not: null } }, data: { importHash: null } });
      await this.audit.log(
        { actorId: actor.id, action: 'session.materials_updated', entityType: 'CourseSession', entityId: sessionId, metadata: { courseId, materials: input.materials?.length ?? null } },
        tx,
      );
    });
    return toSession(await this.prisma.courseSession.findUniqueOrThrow({ where: { id: sessionId } }));
  }

  // ------------------------------------------------------------------ points

  /** Enrolled students with their points in this course, and the latest manual entries. */
  async pointsOverview(courseId: string): Promise<TeachingPointsDto> {
    const enrolled = await this.prisma.enrollment.findMany({
      where: enrolledIn(courseId),
      orderBy: { enrolledAt: 'asc' },
      take: 5000,
      select: { user: { select: { id: true, email: true, profile: { select: { fullNameEn: true } } } } },
    });
    const ids = enrolled.map((e) => e.user.id);
    const [sums, entries] = await Promise.all([
      this.prisma.pointsEntry.groupBy({ by: ['userId'], where: { courseId, userId: { in: ids } }, _sum: { points: true } }),
      this.prisma.pointsEntry.findMany({
        where: { courseId, userId: { in: ids }, sourceType: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        include: { awardedBy: { select: { profile: { select: { fullNameEn: true } }, speakerProfile: { select: { name: true } } } } },
      }),
    ]);
    const total = new Map(sums.map((s) => [s.userId, s._sum.points ?? 0]));
    const people = new Map(enrolled.map(({ user }) => [user.id, user]));
    return {
      students: enrolled.map(({ user }) => ({ userId: user.id, name: user.profile?.fullNameEn ?? null, email: user.email, points: total.get(user.id) ?? 0 })),
      entries: entries.map((e) => {
        const u = people.get(e.userId);
        return {
          id: e.id,
          userId: e.userId,
          student: u?.profile?.fullNameEn || u?.email || '',
          points: e.points,
          reason: e.reason,
          note: e.note,
          createdAt: e.createdAt.toISOString(),
          awardedBy: e.awardedBy ? e.awardedBy.speakerProfile?.name || e.awardedBy.profile?.fullNameEn || null : null,
        };
      }),
    };
  }

  /** Adds (or takes away) course points for an enrolled student: 404 for anyone else. Audited by PointsService. */
  async award(courseId: string, input: TeachingPointsInput, actor: Actor): Promise<PointsEntryDto> {
    const enrolled = await this.prisma.enrollment.findFirst({ where: { ...enrolledIn(courseId), userId: input.userId }, select: { id: true } });
    if (!enrolled) throw new NotFoundException('Student not found');
    const { userId, ...rest } = input;
    return this.points.addManual(userId, { ...rest, courseId }, actor);
  }
}
