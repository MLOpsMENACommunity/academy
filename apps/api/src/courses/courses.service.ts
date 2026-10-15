import { Injectable, NotFoundException } from '@nestjs/common';
import {
  courseAvailability,
  matchesCatalog,
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
      where: { courseId: { in: courseIds }, status: { in: [...SEAT_HOLDING_STATUSES] }, user: { deletedAt: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  }

  async listPublic(q: CatalogQuery): Promise<CourseSummaryDto[]> {
    // The catalog is a few dozen courses: filter in memory with the same matcher as the static
    // catalog page (English/Arabic include bilingual courses; "Paid" means a price is set).
    const courses = await this.prisma.course.findMany({
      where: { status: { in: [...PUBLIC_COURSE_STATUSES] } },
      include: { instructors: { include: { instructor: true } } },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    const matching = courses.filter((c) =>
      matchesCatalog({ ...c, availability: courseAvailability(c, now) }, q),
    );
    const seats = await this.seatsTaken(matching.map((c) => c.id));
    return (
      matching
        .map((c) => toCourseSummary(c, seats.get(c.id) ?? 0))
        // Open courses first, then upcoming, then closed.
        .sort(
          (a, b) =>
            ['OPEN', 'UPCOMING', 'CLOSED'].indexOf(a.availability) -
            ['OPEN', 'UPCOMING', 'CLOSED'].indexOf(b.availability),
        )
    );
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
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
    ]);
    // On the waiting list from this account, or (once the address is confirmed) with this email before it needed an account.
    const interested = user
      ? (await this.prisma.courseInterest.count({
          where: { course: { slug }, OR: user.emailVerifiedAt ? [{ userId }, { email: user.email.toLowerCase() }] : [{ userId }] },
        })) > 0
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
