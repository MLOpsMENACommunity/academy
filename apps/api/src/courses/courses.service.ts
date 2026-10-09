import { Injectable, NotFoundException } from '@nestjs/common';
import {
  courseAvailability,
  SEAT_HOLDING_STATUSES,
  type CatalogQuery,
  type CourseDetailDto,
  type CourseSummaryDto,
  type MyCourseStatusDto,
  PUBLIC_COURSE_STATUSES,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toCourseDetail, toCourseSummary } from './course.mapper';

/** Statuses visible in the public catalog. */

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Seats held per course (shortlisted through enrolled). */
  async seatsTaken(courseIds: string[], tx: Prisma.TransactionClient = this.prisma): Promise<Map<string, number>> {
    if (!courseIds.length) return new Map();
    const rows = await tx.application.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds }, status: { in: [...SEAT_HOLDING_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  }

  async listPublic(q: CatalogQuery): Promise<CourseSummaryDto[]> {
    const courses = await this.prisma.course.findMany({
      where: {
        status: { in: [...PUBLIC_COURSE_STATUSES] },
        ...(q.level ? { level: q.level } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.language ? { language: q.language } : {}),
      },
      include: { instructors: { include: { instructor: true } } },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });
    const seats = await this.seatsTaken(courses.map((c) => c.id));
    const now = new Date();
    return courses
      .filter((c) => !q.availability || courseAvailability(c, now) === q.availability)
      .map((c) => toCourseSummary(c, seats.get(c.id) ?? 0))
      // Open courses first, then upcoming, then closed.
      .sort((a, b) => ['OPEN', 'UPCOMING', 'CLOSED'].indexOf(a.availability) - ['OPEN', 'UPCOMING', 'CLOSED'].indexOf(b.availability));
  }

  async getPublic(slug: string): Promise<CourseDetailDto> {
    const course = await this.prisma.course.findFirst({
      where: { slug, status: { in: [...PUBLIC_COURSE_STATUSES] } },
      include: {
        instructors: { include: { instructor: true } },
        sessions: true,
        screeningQuestions: true,
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    const seats = await this.seatsTaken([course.id]);
    return toCourseDetail(course, seats.get(course.id) ?? 0);
  }

  async myStatus(slug: string, userId: string): Promise<MyCourseStatusDto> {
    const [app, user] = await Promise.all([
      this.prisma.application.findFirst({
        where: { userId, course: { slug } },
        select: { id: true, status: true, enrollment: { select: { id: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    // On the waiting list from this account, or with this email before signing in.
    const interested = user
      ? (await this.prisma.courseInterest.count({ where: { course: { slug }, OR: [{ userId }, { email: user.email.toLowerCase() }] } })) > 0
      : false;
    return { applicationId: app?.id ?? null, status: app?.status ?? null, enrolled: Boolean(app?.enrollment), interested };
  }

  async publicSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    return this.prisma.course.findMany({
      where: { status: { in: [...PUBLIC_COURSE_STATUSES] } },
      select: { slug: true, updatedAt: true },
    });
  }
}
