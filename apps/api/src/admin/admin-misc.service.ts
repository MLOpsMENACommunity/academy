import { Injectable, NotFoundException } from '@nestjs/common';
import { APPLICATION_STATUSES, FUNNEL_EVENTS, type FunnelEvent, type SavedFilterScope } from '@academy/shared';
import { Prisma } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { PrismaService } from '../prisma/prisma.service';

/** Most recent active courses shown with per-course breakdowns. */
const DASHBOARD_COURSES = 12;

@Injectable()
export class AdminMiscService {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts per course by status, pending payments, new applications this week, funnel per course. */
  async dashboard() {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const active = { status: { not: 'ARCHIVED' as const } };
    const [courseCount, courses, pendingPayments, newApplications] = await Promise.all([
      this.prisma.course.count({ where: active }),
      this.prisma.course.findMany({
        where: active,
        orderBy: { createdAt: 'desc' },
        take: DASHBOARD_COURSES,
        select: { id: true, slug: true, titleEn: true, titleAr: true, type: true, status: true, capacity: true },
      }),
      this.prisma.payment.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.application.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);
    // Breakdowns only for the courses shown, so the cost doesn't grow with history.
    const ids = courses.map((c) => c.id);
    const [statusCounts, funnelRows] = ids.length
      ? await Promise.all([
          this.prisma.application.groupBy({ by: ['courseId', 'status'], where: { courseId: { in: ids } }, _count: { _all: true } }),
          // Distinct people per step (signed-in user, or anonymous browser id).
          this.prisma.$queryRaw<{ courseId: string; event: FunnelEvent; n: bigint }[]>`
            SELECT "courseId", "event", COUNT(DISTINCT COALESCE("userId", "anonymousId", "id")) AS n
            FROM "FunnelEventLog" WHERE "courseId" IN (${Prisma.join(ids)}) GROUP BY "courseId", "event"`,
        ])
      : [[], []];
    return {
      courseCount,
      pendingPayments,
      newApplications7d: newApplications,
      courses: courses.map((c) => ({
        ...c,
        statusCounts: Object.fromEntries(
          APPLICATION_STATUSES.map((s) => [s, statusCounts.find((x) => x.courseId === c.id && x.status === s)?._count._all ?? 0]),
        ),
        funnel: Object.fromEntries(
          FUNNEL_EVENTS.map((e) => [e, Number(funnelRows.find((r) => r.courseId === c.id && r.event === e)?.n ?? 0)]),
        ),
      })),
    };
  }

  async auditLog(q: { action?: string; entityType?: string; entityId?: string; page: number }) {
    const where = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
        include: { actor: { select: { email: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: r.actor?.email ?? null,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  savedFilters(admin: Actor, scope: SavedFilterScope) {
    return this.prisma.savedFilter.findMany({
      where: { ownerId: admin.id, scope },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, scope: true, filters: true, createdAt: true },
    });
  }

  saveFilter(admin: Actor, input: { scope: SavedFilterScope; name: string; query: string }) {
    return this.prisma.savedFilter.create({
      data: { ownerId: admin.id, scope: input.scope, name: input.name, filters: { query: input.query } },
      select: { id: true, name: true, scope: true, filters: true, createdAt: true },
    });
  }

  async deleteFilter(admin: Actor, id: string) {
    const r = await this.prisma.savedFilter.deleteMany({ where: { id, ownerId: admin.id } });
    if (!r.count) throw new NotFoundException('Saved view not found');
  }
}
