import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DriveSharingStatusDto } from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DRIVE_API, DriveShareFailed, driveFolderId, type DriveApi, type DriveShareError } from './drive-api';

/** Enrolments handled per course and run, so one run stays within a few seconds per course. */
const BATCH = 50;
/** A failed share is tried again on its own after a day (or at once with "Share now"). */
const RETRY_AFTER_MS = 24 * 3_600_000;

/** Paid courses whose recordings are in a Drive folder: the only courses shared automatically. */
const DRIVE_COURSE = { type: 'PAID', recordingsPlatform: 'GOOGLE_DRIVE', status: { not: 'ARCHIVED' }, driveFolderUrl: { not: null } } satisfies Prisma.CourseWhereInput;

/**
 * Shares each paid course's Drive folder with its enrolled students' Google accounts (Viewer),
 * and removes the old address when a student changes their Google account or deletes their
 * account. Only ever touches readers: the team's own access is never changed. Without a
 * service account it does nothing and admins share by hand as before.
 */
@Injectable()
export class DriveSharingService {
  private readonly logger = new Logger(DriveSharingService.name);

  constructor(
    @Inject(DRIVE_API) private readonly drive: DriveApi,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  isEnabled(): boolean {
    return this.drive.account() !== null;
  }

  /** Whether automatic sharing works for this course, for the enrolled students page. */
  async status(courseId: string): Promise<DriveSharingStatusDto> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { driveFolderUrl: true } });
    if (!course) throw new NotFoundException('Course not found');
    const account = this.drive.account();
    if (!account) return { state: 'off', account: null, folderName: null };
    const folderId = driveFolderId(course.driveFolderUrl);
    if (!folderId) return { state: 'no_folder', account, folderName: null };
    try {
      const f = await this.drive.folder(folderId);
      return { state: f.canShare ? 'ready' : 'cannot_share', account, folderName: f.name };
    } catch (err) {
      if (err instanceof DriveShareFailed && err.code === 'no_folder_access') return { state: 'no_access', account, folderName: null };
      this.logger.warn(`Drive folder check failed for course ${courseId}: ${(err as Error).message}`);
      return { state: 'error', account, folderName: null };
    }
  }

  /** The scheduled run: every Drive course with something to share or remove. */
  async runAll(now = new Date()): Promise<number> {
    if (!this.isEnabled()) return 0;
    const courses = await this.prisma.course.findMany({
      where: {
        ...DRIVE_COURSE,
        enrollments: {
          some: {
            OR: [
              { driveRevokeEmail: { not: null } },
              { driveAccessGranted: false, OR: [{ driveShareError: null }, { driveShareTriedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } }] },
            ],
          },
        },
      },
      select: { id: true },
    });
    let done = 0;
    for (const c of courses) done += (await this.syncCourse(c.id, { now })).changed;
    return done;
  }

  /**
   * Removes old addresses first, then shares with every enrolled student not yet shared.
   * `retry` (an admin's "Share now") also tries the ones that failed in the last day.
   */
  async syncCourse(courseId: string, opts: { now?: Date; retry?: boolean; actorId?: string } = {}): Promise<{ changed: number; failed: number }> {
    const now = opts.now ?? new Date();
    const actorId = opts.actorId ?? null;
    const course = await this.prisma.course.findFirst({ where: { id: courseId, ...DRIVE_COURSE }, select: { id: true, titleEn: true, titleAr: true, driveFolderUrl: true } });
    const folderId = driveFolderId(course?.driveFolderUrl);
    if (!course || !folderId || !this.isEnabled()) return { changed: 0, failed: 0 };

    let changed = 0;
    const newlyFailed: string[] = [];
    const fail = async (id: string, hadError: boolean, err: unknown) => {
      const code: DriveShareError = err instanceof DriveShareFailed ? err.code : 'failed';
      await this.prisma.enrollment.update({ where: { id }, data: { driveShareError: code, driveShareTriedAt: now } });
      if (!hadError) newlyFailed.push(id);
      this.logger.warn(`Drive sharing failed for enrolment ${id}: ${(err as Error).message}`);
    };

    const toRemove = await this.prisma.enrollment.findMany({
      where: { courseId, driveRevokeEmail: { not: null } },
      select: { id: true, driveRevokeEmail: true, driveShareError: true },
      take: BATCH,
    });
    for (const e of toRemove) {
      try {
        await this.drive.unshare(folderId, e.driveRevokeEmail!);
        // Only if nothing changed meanwhile (the student may have changed their Google account again).
        const r = await this.prisma.enrollment.updateMany({
          where: { id: e.id, driveRevokeEmail: e.driveRevokeEmail },
          data: { driveRevokeEmail: null, driveShareError: null, driveShareTriedAt: now },
        });
        if (r.count) {
          changed++;
          await this.audit.log({ actorId, action: 'enrollment.drive_old_access_removed', entityType: 'Enrollment', entityId: e.id, metadata: { courseId, automatic: true } });
        }
      } catch (err) {
        await fail(e.id, Boolean(e.driveShareError), err);
      }
    }

    const toShare = await this.prisma.enrollment.findMany({
      where: {
        courseId,
        driveAccessGranted: false,
        driveRevokeEmail: null,
        user: { deletedAt: null, profile: { googleEmail: { not: null } } },
        ...(opts.retry ? {} : { OR: [{ driveShareError: null }, { driveShareTriedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } }] }),
      },
      orderBy: { enrolledAt: 'asc' },
      select: { id: true, driveShareError: true, user: { select: { profile: { select: { googleEmail: true } } } } },
      take: BATCH,
    });
    for (const e of toShare) {
      const googleEmail = e.user.profile!.googleEmail!;
      try {
        await this.drive.share(folderId, googleEmail);
        // Shared with the address read above: skipped if the student changed it meanwhile (they are flagged again).
        const r = await this.prisma.enrollment.updateMany({
          where: { id: e.id, driveAccessGranted: false, driveRevokeEmail: null, user: { profile: { googleEmail } } },
          data: { driveAccessGranted: true, driveAccessGrantedAt: now, driveShareError: null, driveShareTriedAt: now },
        });
        if (r.count) {
          changed++;
          await this.audit.log({ actorId, action: 'enrollment.drive_access_granted', entityType: 'Enrollment', entityId: e.id, metadata: { courseId, automatic: true } });
        }
      } catch (err) {
        await fail(e.id, Boolean(e.driveShareError), err);
      }
    }

    if (newlyFailed.length) await this.alert(course, newlyFailed.length);
    return { changed, failed: newlyFailed.length };
  }

  /** One alert per course and run, only for enrolments that had not failed before. */
  private async alert(course: { id: string; titleEn: string; titleAr: string }, count: number): Promise<void> {
    const link = `/admin/courses/${course.id}?tab=enrolled&driveAccess=pending`;
    const copy = {
      titleEn: 'Drive sharing needs a look',
      titleAr: 'مشاركة Drive تحتاج إلى مراجعة',
      bodyEn: `The academy couldn't update the Drive folder of "${course.titleEn}" for ${count} student(s). The enrolled students page shows why.`,
      bodyAr: `تعذّر على الأكاديمية تحديث مجلد Drive لدورة "${course.titleAr}" لعدد ${count} من الطلاب. توضح صفحة الطلاب المسجلين السبب.`,
    };
    const admins = await this.notifications.notifyAdmins({ type: 'admin.drive_sharing_failed', ...copy, link }, ['ADMISSIONS', 'ACADEMIC']);
    for (const a of admins) {
      void this.email.send(a.email, a.locale, { name: 'adminAlert', message: a.locale === 'ar' ? copy.bodyAr : copy.bodyEn, url: this.email.url(a.locale, link) });
    }
  }
}
