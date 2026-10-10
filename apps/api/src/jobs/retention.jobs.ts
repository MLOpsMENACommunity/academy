import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssessmentsService } from '../assessments/assessments.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

/**
 * Risk 3: payment screenshots, CVs and uploaded assignment PDFs are personal data. They are
 * deleted after the retention period set in Settings (default 180 days). Payment records and
 * grades stay.
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
    private readonly assessments: AssessmentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'Africa/Cairo' })
  async daily(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    await this.run();
  }

  async run(now = new Date()): Promise<{ screenshots: number; cvs: number; submissionFiles: number }> {
    const { screenshotRetentionDays } = await this.settings.get();
    const screenshots = await this.payments.purgeOldScreenshots(screenshotRetentionDays, now);
    const cvs = await this.purgeOldCvs(screenshotRetentionDays, now);
    const submissionFiles = await this.assessments.purgeOldFiles(screenshotRetentionDays, now);
    if (screenshots || cvs || submissionFiles) {
      this.logger.log(`Retention: deleted ${screenshots} screenshot(s), ${cvs} CV(s), ${submissionFiles} submission file(s)`);
    }
    return { screenshots, cvs, submissionFiles };
  }

  private async purgeOldCvs(retentionDays: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const due = await this.prisma.profile.findMany({
      where: { cvKey: { not: null }, cvUploadedAt: { lt: cutoff }, user: { deletedAt: null } },
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
      // Only if the CV wasn't replaced meanwhile (a new upload keeps its new key). Raw update so
      // removing the CV isn't treated as the student editing their profile (no updatedAt bump).
      const changed = await this.prisma.$executeRaw`
        UPDATE "Profile" SET "cvKey" = NULL, "cvUploadedAt" = NULL WHERE "id" = ${p.id} AND "cvKey" = ${p.cvKey}`;
      if (changed !== 1) continue;
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
