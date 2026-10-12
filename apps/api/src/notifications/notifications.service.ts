import { Injectable } from '@nestjs/common';
import type { AdminPermission } from '@academy/shared';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  type: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  /** Path without locale, e.g. /dashboard */
  link?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, n: NotificationInput, tx: Prisma.TransactionClient = this.prisma): Promise<Notification> {
    return tx.notification.create({ data: { userId, ...n, link: n.link ?? null } });
  }

  /** Tells the admins whose presets cover it (SUPER always), in the app; returns them for emails. */
  async notifyAdmins(n: NotificationInput, permissions: AdminPermission[]): Promise<{ id: string; email: string; locale: 'en' | 'ar' }[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null, adminPermissions: { hasSome: ['SUPER', ...permissions] } },
      select: { id: true, email: true, locale: true },
    });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({ userId: a.id, ...n, link: n.link ?? null })),
    });
    return admins;
  }

  async list(userId: string): Promise<{ items: Notification[]; unread: number }> {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
