import { Injectable, Logger } from '@nestjs/common';
import type { FunnelEvent } from '@academy/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Course slug from a returnTo like /en/courses/<slug>/apply?ref=... */
export function courseSlugFromPath(path: string | null | undefined): string | null {
  const m = path?.match(/^\/(?:en|ar)\/courses\/([a-z0-9-]+)/);
  return m?.[1] ?? null;
}

/** Funnel counters per course (course view → … → enrolled). Never throws. */
@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    course: { id?: string; slug?: string | null },
    event: FunnelEvent,
    who: { userId?: string | null; anonymousId?: string | null } = {},
  ): Promise<void> {
    try {
      const courseId =
        course.id ??
        (course.slug
          ? (await this.prisma.course.findUnique({ where: { slug: course.slug }, select: { id: true } }))?.id
          : undefined);
      if (!courseId) return;
      await this.prisma.funnelEventLog.create({
        data: { courseId, event, userId: who.userId ?? null, anonymousId: who.anonymousId?.slice(0, 64) ?? null },
      });
    } catch (err) {
      this.logger.warn(`Funnel event ${event} not recorded: ${(err as Error).message}`);
    }
  }
}
