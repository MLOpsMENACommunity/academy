import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AddAdminInput, AddAdminResultDto, AdminPermission, AdminTeamMemberDto } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../users/account.service';
import { lockSupers } from './last-super';

const MEMBER = {
  id: true,
  email: true,
  adminPermissions: true,
  lastLoginAt: true,
  createdAt: true,
  profile: { select: { fullNameEn: true } },
} as const satisfies Prisma.UserSelect;
type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER }>;

function toMember(u: MemberRow): AdminTeamMemberDto {
  return {
    id: u.id,
    email: u.email,
    name: u.profile?.fullNameEn ?? null,
    permissions: u.adminPermissions,
    pending: !u.lastLoginAt,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Admin → Team (super admins only): who the admins are and what each may do. Every change is
 * audited (ids and presets only). There is always at least one super admin: removing or
 * demoting one runs under row locks on every super admin (see last-super.ts).
 *
 * Permissions are read from the database on every request (common/auth.guard.ts), so a change
 * applies at once, without signing anyone out.
 */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(): Promise<AdminTeamMemberDto[]> {
    const rows = await this.prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, orderBy: { createdAt: 'asc' }, select: MEMBER });
    return rows.map(toMember);
  }

  private async member(id: string): Promise<AdminTeamMemberDto> {
    return toMember(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: MEMBER }));
  }

  /** An existing student or speaker account is promoted; a new address gets an account and a set-password email. */
  async add(input: AddAdminInput, actorId: string): Promise<AddAdminResultDto> {
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: input.email, mode: 'insensitive' } },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!existing) {
      try {
        const created = await this.accounts.createByAdmin({ email: input.email, locale: input.locale, fullNameEn: input.fullNameEn }, actorId, {
          adminPermissions: input.permissions,
        });
        return { outcome: 'invited', member: await this.member(created.id) };
      } catch (err) {
        // Someone registered the address a moment ago: add it again to promote that account.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email was just created: try again' });
        }
        throw err;
      }
    }
    if (existing.deletedAt) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'This address belongs to a deleted account' });
    if (existing.role === 'ADMIN') throw new ConflictException({ code: 'ALREADY_ADMIN', message: 'This account is already an admin' });

    // Only if it is still the same non-admin, live account (a concurrent change wins).
    const promoted = await this.prisma.user.updateMany({
      where: { id: existing.id, role: existing.role, deletedAt: null },
      data: { role: 'ADMIN', adminPermissions: input.permissions },
    });
    if (!promoted.count) throw new ConflictException({ code: 'CHANGED', message: 'This account just changed: try again' });
    await this.audit.log({
      actorId,
      action: 'admin.promoted',
      entityType: 'User',
      entityId: existing.id,
      metadata: { from: existing.role, permissions: input.permissions },
    });
    await this.notifications.create(existing.id, {
      type: 'admin.added',
      titleEn: 'You are now on the academy team',
      titleAr: 'أصبحت ضمن فريق الأكاديمية',
      bodyEn: 'An admin added you to the MLOps MENA Academy team. Open the admin panel to get started.',
      bodyAr: 'أضافك أحد المسؤولين إلى فريق أكاديمية MLOps MENA. افتح لوحة الإدارة للبدء.',
      link: '/admin',
    });
    return { outcome: 'promoted', member: await this.member(existing.id) };
  }

  /** New presets for an admin. Taking SUPER from the last super admin is refused (LAST_SUPER). */
  async update(id: string, permissions: AdminPermission[], actorId: string): Promise<AdminTeamMemberDto> {
    const before = await this.prisma.$transaction(async (tx) => {
      const supers = await lockSupers(tx);
      const [target] = await tx.$queryRaw<{ id: string; adminPermissions: AdminPermission[] }[]>`
        SELECT "id", "adminPermissions"::text[] AS "adminPermissions" FROM "User"
        WHERE "id" = ${id} AND "role" = 'ADMIN' AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (!target) throw new NotFoundException('Admin not found');
      if (supers.includes(id) && !permissions.includes('SUPER') && supers.length <= 1) {
        throw new ConflictException({ code: 'LAST_SUPER', message: 'There must always be at least one super admin' });
      }
      await tx.user.update({ where: { id }, data: { adminPermissions: permissions } });
      return target.adminPermissions;
    });
    await this.audit.log({ actorId, action: 'admin.permissions_changed', entityType: 'User', entityId: id, metadata: { from: before, to: permissions } });
    return this.member(id);
  }

  /** Back to a student account (nothing else changes). The last super admin can't be removed. */
  async remove(id: string, actorId: string): Promise<void> {
    const before = await this.prisma.$transaction(async (tx) => {
      const supers = await lockSupers(tx);
      const [target] = await tx.$queryRaw<{ id: string; adminPermissions: AdminPermission[] }[]>`
        SELECT "id", "adminPermissions"::text[] AS "adminPermissions" FROM "User"
        WHERE "id" = ${id} AND "role" = 'ADMIN' AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (!target) throw new NotFoundException('Admin not found');
      if (supers.includes(id) && supers.length <= 1) {
        throw new ConflictException({ code: 'LAST_SUPER', message: 'There must always be at least one super admin' });
      }
      await tx.user.update({ where: { id }, data: { role: 'STUDENT', adminPermissions: [] } });
      return target.adminPermissions;
    });
    await this.audit.log({ actorId, action: 'admin.removed', entityType: 'User', entityId: id, metadata: { permissions: before } });
  }
}
