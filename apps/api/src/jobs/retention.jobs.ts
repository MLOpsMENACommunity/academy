import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

/**
 * Risk 3: payment screenshots and CVs are personal data. Both are deleted after
 * the retention period set in Settings (default 180 days). Payment records stay.
 */
@Injectable()
export class RetentionJobs {
  private readonly logger = new Logger(RetentionJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'Africa/Cairo' })
  async daily(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.run();
  }

  async run(now = new Date()): Promise<{ screenshots: number; cvs: number }> {
    const { screenshotRetentionDays } = await this.settings.get();
    const screenshots = await this.payments.purgeOldScreenshots(screenshotRetentionDays, now);
    const cvs = await this.purgeOldCvs(screenshotRetentionDays, now);
    if (screenshots || cvs) this.logger.log(`Retention: deleted ${screenshots} screenshot(s), ${cvs} CV(s)`);
    return { screenshots, cvs };
  }

  private async purgeOldCvs(retentionDays: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const due = await this.prisma.profile.findMany({
      where: { cvKey: { not: null }, cvUploadedAt: { lt: cutoff } },
      select: { id: true, userId: true, cvKey: true },
      orderBy: { cvUploadedAt: 'asc' },
      take: 500,
    });
    let removed = 0;
    for (const p of due) {
      try {
        await this.storage.delete(p.cvKey!);
      } catch {
        continue; // retried next run
      }
      // Raw update: removing the CV is not the student editing their profile (don't bump updatedAt).
      await this.prisma.$executeRaw`UPDATE "Profile" SET "cvKey" = NULL, "cvUploadedAt" = NULL WHERE "id" = ${p.id}`;
      await this.notifications.create(p.userId, {
        type: 'profile.cv_expired',
        titleEn: 'Your CV was removed',
        titleAr: 'تمت إزالة سيرتك الذاتية',
        bodyEn: `For your privacy we keep CVs for ${retentionDays} days. Upload a new one any time from your profile.`,
        bodyAr: `حرصًا على خصوصيتك نحتفظ بالسير الذاتية لمدة ${retentionDays} يومًا. يمكنك رفع نسخة جديدة في أي وقت من ملفك الشخصي.`,
        link: '/profile?tab=links',
      });
      removed++;
    }
    return removed;
  }
}
