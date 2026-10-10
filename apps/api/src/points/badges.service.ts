import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AwardBadgeInput, BadgeDto, BadgeInput, BadgeUpdate } from '@academy/shared';
import { Prisma, type Badge } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from './points.service';

function toDto(b: Badge): BadgeDto {
  return { id: b.id, code: b.code, nameEn: b.nameEn, nameAr: b.nameAr, descriptionEn: b.descriptionEn, descriptionAr: b.descriptionAr, icon: b.icon, kind: b.kind, active: b.active };
}

/** Admin: the badge catalog (extra manual badges) and awarding or revoking badges by hand. */
@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly points: PointsService,
  ) {}

  async list(): Promise<(BadgeDto & { awarded: number })[]> {
    const badges = await this.prisma.badge.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }], include: { _count: { select: { awards: true } } } });
    return badges.map((b) => ({ ...toDto(b), awarded: b._count.awards }));
  }

  /** New badges are always manual: automatic ones need code behind them. */
  async create(input: BadgeInput, admin: Actor): Promise<BadgeDto> {
    try {
      const b = await this.prisma.badge.create({ data: { ...input, kind: 'MANUAL' } });
      await this.audit.log({ actorId: admin.id, action: 'badge.created', entityType: 'Badge', entityId: b.id, metadata: { code: b.code } });
      return toDto(b);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ statusCode: 409, message: 'Validation failed', errors: [{ path: 'code', message: 'A badge with this code exists' }] });
      }
      throw err;
    }
  }

  /** Wording, icon and active can change for any badge (an inactive badge is no longer awarded or shown on boards). */
  async update(id: string, input: BadgeUpdate, admin: Actor): Promise<BadgeDto> {
    const current = await this.prisma.badge.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Badge not found');
    const b = await this.prisma.badge.update({ where: { id }, data: input });
    await this.audit.log({ actorId: admin.id, action: 'badge.updated', entityType: 'Badge', entityId: id, metadata: { code: b.code, fields: Object.keys(input) } });
    return toDto(b);
  }

  /** Manual badges only; once per course (or once overall without a course). */
  async award(userId: string, input: AwardBadgeInput, admin: Actor): Promise<{ id: string }> {
    const [user, badge] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } }),
      this.prisma.badge.findUnique({ where: { id: input.badgeId } }),
    ]);
    if (!user || user.deletedAt) throw new NotFoundException('Student not found');
    if (!badge || !badge.active) throw new NotFoundException('Badge not found');
    if (badge.kind !== 'MANUAL') throw new BadRequestException({ code: 'AUTO_BADGE', message: 'This badge is awarded automatically' });
    if (input.courseId && !(await this.prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true } }))) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: 'courseId', message: 'Unknown course' }] });
    }
    const award = await this.points.awardBadge(badge, userId, { courseId: input.courseId, awardedById: admin.id, reason: input.reason });
    if (!award) throw new ConflictException({ code: 'ALREADY_AWARDED', message: input.courseId ? 'The student already has this badge for this course' : 'The student already has this badge' });
    await this.audit.log({ actorId: admin.id, action: 'badge.awarded', entityType: 'User', entityId: userId, metadata: { badgeId: badge.id, code: badge.code, courseId: input.courseId, awardId: award.id } });
    return { id: award.id };
  }

  /**
   * Removes a manual award. Automatic badges follow their rule (the hourly job would give a
   * still-qualifying student the badge again), so they're corrected through points instead.
   */
  async revoke(awardId: string, admin: Actor): Promise<void> {
    const award = await this.prisma.userBadge.findUnique({ where: { id: awardId }, include: { badge: { select: { code: true, kind: true } } } });
    if (!award) throw new NotFoundException('Award not found');
    if (award.badge.kind !== 'MANUAL') throw new BadRequestException({ code: 'AUTO_BADGE', message: 'Automatic badges follow their rule: adjust the points instead' });
    await this.prisma.userBadge.delete({ where: { id: awardId } });
    await this.audit.log({
      actorId: admin.id,
      action: 'badge.revoked',
      entityType: 'User',
      entityId: award.userId,
      metadata: { awardId, code: award.badge.code, courseId: award.courseId, period: award.period },
    });
  }
}
