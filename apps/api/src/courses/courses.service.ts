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
import { NO_SEATS, toCourseDetail, toCourseSummary, type SeatCount } from './course.mapper';

/** Rows of accounts that aren't deleted: a deleted account holds no seat and isn't enrolled any more. */
const LIVE_ACCOUNT = { user: { deletedAt: null } } satisfies Prisma.ApplicationWhereInput & Prisma.EnrollmentWhereInput;

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per course: seats held (shortlisted through enrolled) and active enrolments. A deleted
   * account holds no seat and isn't counted as enrolled (the same rule as the workflow's seat
   * check). Only numbers: the public pages never learn who.
   */
  async seatCounts(courseIds: string[], tx: Prisma.TransactionClient = this.prisma): Promise<Map<string, SeatCount>> {
    if (!courseIds.length) return new Map();
    const [taken, enrolled] = await Promise.all([
      tx.application.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, status: { in: [...SEAT_HOLDING_STATUSES] }, ...LIVE_ACCOUNT },
        _count: { _all: true },
      }),
      tx.enrollment.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, ...LIVE_ACCOUNT },
        _count: { _all: true },
      }),
    ]);
    const out = new Map<string, SeatCount>(courseIds.map((id) => [id, { ...NO_SEATS }]));
    for (const r of taken) out.get(r.courseId)!.taken = r._count._all;
    for (const r of enrolled) out.get(r.courseId)!.enrolled = r._count._all;
    return out;
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
    const seats = await this.seatCounts(matching.map((c) => c.id));
    return (
      matching
        .map((c) => toCourseSummary(c, seats.get(c.id) ?? NO_SEATS, now))
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
    const seats = await this.seatCounts([course.id]);
    return toCourseDetail(course, seats.get(course.id) ?? NO_SEATS);
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
