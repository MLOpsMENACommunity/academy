import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  COURSE_PERMISSIONS,
  type CoursePermission,
  type Material,
  type SessionMaterialsInput,
  type TeachingCourseDetailDto,
  type TeachingCourseDto,
  type TeachingPointsDto,
  type TeachingPointsInput,
  type TeachingSessionDto,
  type TeachRosterStudentDto,
  type PointsEntryDto,
} from '@academy/shared';
import type { CourseSession, Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { CourseAccessService, type CourseMembership, type Teacher } from '../course-access/course-access.service';
import { COUNTED, PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

/** New assessments a speaker may create in 24 hours (all their courses together). */
export const SPEAKER_ASSESSMENTS_PER_DAY = 30;

/** Students staff may see: enrolled in the course, account not deleted. */
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
 * The staff side of a course that isn't about assessments (those reuse AdminAssessmentsService):
 * the list of my courses, the sessions' materials, course points and the roster. Callers have
 * already checked the user's permission in the course (CoursePermissionGuard); every id inside
 * it is checked here, with a 404 when it belongs to another course.
 */
@Injectable()
export class TeachingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CourseAccessService,
    private readonly points: PointsService,
    private readonly settings: SettingsService,
  ) {}

  /** Teaching → My courses: every course whose staff this account is on (not archived), with what they may do there. */
  async courses(user: Teacher): Promise<TeachingCourseDto[]> {
    const list = await this.prisma.course.findMany({
      where: this.access.staffCoursesWhere(user.id),
      orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        titleEn: true,
        titleAr: true,
        status: true,
        staff: { where: { userId: user.id }, take: 1, select: { role: { select: { name: true, nameAr: true, permissions: true } } } },
        _count: { select: { enrollments: { where: { user: { deletedAt: null } } }, assessments: true } },
      },
    });
    const admin = this.access.isCourseAdmin(user);
    const perms = (c: (typeof list)[number]): CoursePermission[] =>
      admin ? [...COURSE_PERMISSIONS] : COURSE_PERMISSIONS.filter((p) => c.staff[0]?.role.permissions.includes(p));
    const graders = list.filter((c) => perms(c).includes('GRADE')).map((c) => c.id);
    const pending = await this.prisma.submission.groupBy({
      by: ['assessmentId'],
      where: { assessment: { courseId: { in: graders } }, submittedAt: { not: null }, gradedAt: null },
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
      permissions: perms(c),
      roleName: c.staff[0]?.role.name ?? null,
      roleNameAr: c.staff[0]?.role.nameAr ?? null,
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

  async course(courseId: string, m: CourseMembership, user: Teacher): Promise<TeachingCourseDetailDto> {
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, slug: true, titleEn: true, titleAr: true, status: true, type: true, sessions: { orderBy: { order: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Course not found');
    return {
      id: c.id,
      slug: c.slug,
      titleEn: c.titleEn,
      titleAr: c.titleAr || c.titleEn,
      status: c.status,
      type: c.type,
      sessions: c.sessions.map(toSession),
      permissions: m.permissions,
      roleName: m.roleName,
      roleNameAr: m.roleNameAr,
      canWaivePayment: this.access.canWaivePayment(user),
    };
  }

  // ------------------------------------------------------------------ roster

  /** Enrolled students (VIEW_ROSTER): names, email and community usernames. Read is audited like an export. */
  async roster(courseId: string, actor: Actor): Promise<TeachRosterStudentDto[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: enrolledIn(courseId),
      orderBy: { enrolledAt: 'asc' },
      take: 5000,
      select: { enrolledAt: true, user: { select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } } },
    });
    await this.audit.log({ actorId: actor.id, action: 'course.roster_viewed', entityType: 'Course', entityId: courseId, metadata: { count: rows.length } });
    return rows.map((r) => ({
      userId: r.user.id,
      name: r.user.profile?.fullNameEn ?? null,
      nameAr: r.user.profile?.fullNameAr ?? null,
      email: r.user.email,
      // Telegram and Discord usernames: not on profiles yet (null until they are).
      telegram: null,
      discord: null,
      enrolledAt: r.enrolledAt.toISOString(),
    }));
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
      this.prisma.pointsEntry.groupBy({ by: ['userId'], where: { courseId, userId: { in: ids }, ...COUNTED }, _sum: { points: true } }),
      this.prisma.pointsEntry.findMany({
        where: { courseId, userId: { in: ids }, sourceType: null, ...COUNTED },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        include: { awardedBy: { select: { profile: { select: { fullNameEn: true } }, speakerProfile: { select: { name: true } } } } },
      }),
    ]);
    const total = new Map(sums.map((s) => [s.userId, s._sum.points ?? 0]));
    const cap = await this.pointsCap();
    const people = new Map(enrolled.map(({ user }) => [user.id, user]));
    return {
      cap,
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

  /** The largest single entry a speaker may add, set or remove (Settings.speakerPointsCap). */
  async pointsCap(): Promise<number> {
    return (await this.settings.get()).speakerPointsCap;
  }

  /**
   * Adds (or takes away) course points for an enrolled student: 404 for anyone else, 403
   * POINTS_CAP over the speaker cap. Audited by PointsService.
   */
  async award(courseId: string, input: TeachingPointsInput, actor: Actor): Promise<PointsEntryDto> {
    const enrolled = await this.prisma.enrollment.findFirst({ where: { ...enrolledIn(courseId), userId: input.userId }, select: { id: true } });
    if (!enrolled) throw new NotFoundException('Student not found');
    const cap = await this.pointsCap();
    if (Math.abs(input.points) > cap) {
      throw new ForbiddenException({ code: 'POINTS_CAP', message: `Speakers can add, change or remove at most ${cap} points per entry`, cap });
    }
    const { userId, ...rest } = input;
    return this.points.addManual(userId, { ...rest, courseId }, actor);
  }
}
