import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, Profile, SkillRating } from '@prisma/client';
import {
  computeCompleteness,
  profileSectionSchemas,
  type ProfileDto,
  type ProfileSection,
  type Skill,
} from '@academy/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectFileType, MAX_UPLOAD_BYTES } from '../storage/file-type';
import { StorageService } from '../storage/storage.service';

type ProfileWithSkills = Profile & { skills: SkillRating[] };

export function toProfileDto(p: ProfileWithSkills | null): ProfileDto {
  const skills = Object.fromEntries((p?.skills ?? []).map((s) => [s.skill, s.level])) as Partial<
    Record<Skill, number>
  >;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    fullNameEn: p?.fullNameEn ?? null,
    fullNameAr: p?.fullNameAr ?? null,
    phone: p?.phone ?? null,
    country: p?.country ?? null,
    city: p?.city ?? null,
    timezone: p?.timezone ?? null,
    employmentStatus: p?.employmentStatus ?? null,
    jobTitle: p?.jobTitle ?? null,
    experienceYears: p?.experienceYears ?? null,
    primaryArea: p?.primaryArea ?? null,
    googleEmail: p?.googleEmail ?? null,
    preferredLanguage: p?.preferredLanguage ?? null,
    acceptedTermsAt: iso(p?.acceptedTermsAt),
    company: p?.company ?? null,
    industry: p?.industry ?? null,
    companySize: p?.companySize ?? null,
    mlExperienceYears: p?.mlExperienceYears ?? null,
    seniority: p?.seniority ?? null,
    secondaryAreas: p?.secondaryAreas ?? [],
    educationLevel: p?.educationLevel ?? null,
    fieldOfStudy: p?.fieldOfStudy ?? null,
    university: p?.university ?? null,
    graduationYear: p?.graduationYear ?? null,
    currentlyStudying: p?.currentlyStudying ?? null,
    skills,
    cloudPlatforms: p?.cloudPlatforms ?? [],
    productionTools: p?.productionTools ?? [],
    learningGoals: p?.learningGoals ?? [],
    interestedTopics: p?.interestedTopics ?? [],
    weeklyHours: p?.weeklyHours ?? null,
    preferredTimes: p?.preferredTimes ?? [],
    preferredFormat: p?.preferredFormat ?? null,
    linkedinUrl: p?.linkedinUrl ?? null,
    githubUrl: p?.githubUrl ?? null,
    websiteUrl: p?.websiteUrl ?? null,
    kaggleUrl: p?.kaggleUrl ?? null,
    huggingfaceUrl: p?.huggingfaceUrl ?? null,
    hasCv: Boolean(p?.cvKey),
    cvUploadedAt: iso(p?.cvUploadedAt),
    referralSource: p?.referralSource ?? null,
    communityMember: p?.communityMember ?? null,
    openToOpportunities: p?.openToOpportunities ?? false,
    shareWithPartners: p?.shareWithPartners ?? false,
    marketingEmails: p?.marketingEmails ?? false,
    completeness: p?.completeness ?? 0,
    coreComplete: Boolean(p?.coreCompletedAt),
    updatedAt: iso(p?.updatedAt),
  };
}

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private async load(userId: string): Promise<ProfileWithSkills> {
    return this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { skills: true },
    });
  }

  async get(userId: string): Promise<ProfileDto> {
    return toProfileDto(await this.load(userId));
  }

  async updateSection(userId: string, section: ProfileSection, raw: unknown): Promise<ProfileDto> {
    const schema = profileSectionSchemas[section];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const before = await this.load(userId);
    const data = parsed.data as Record<string, unknown>;

    await this.prisma.$transaction(async (tx) => {
      if (section === 'skills') {
        const { skills, ...rest } = data as z.infer<(typeof profileSectionSchemas)['skills']>;
        await tx.skillRating.deleteMany({ where: { profileId: before.id } });
        const entries = Object.entries(skills) as [Skill, number][];
        if (entries.length) {
          await tx.skillRating.createMany({
            data: entries.map(([skill, level]) => ({ profileId: before.id, skill, level })),
          });
        }
        await tx.profile.update({ where: { id: before.id }, data: rest });
      } else if (section === 'core') {
        const { acceptTerms: _accept, ...rest } = data as z.infer<(typeof profileSectionSchemas)['core']>;
        await tx.profile.update({
          where: { id: before.id },
          data: { ...rest, acceptedTermsAt: before.acceptedTermsAt ?? new Date() },
        });
      } else {
        await tx.profile.update({ where: { id: before.id }, data: data as Prisma.ProfileUpdateInput });
      }
    });

    const after = await this.recompute(userId);

    if (section === 'core' && before.googleEmail && after.googleEmail !== before.googleEmail) {
      await this.alertDriveAccess(userId, 'changed', before.googleEmail);
    }
    return toProfileDto(after);
  }

  /** Recomputes completeness and stamps coreCompletedAt the first time the core is done. */
  async recompute(userId: string): Promise<ProfileWithSkills> {
    const current = await this.load(userId);
    const c = computeCompleteness(toProfileDto(current));
    return this.prisma.profile.update({
      where: { id: current.id },
      data: {
        completeness: c.percent,
        coreCompletedAt: c.coreComplete ? (current.coreCompletedAt ?? new Date()) : null,
      },
      include: { skills: true },
    });
  }

  /**
   * Paid Drive courses are shared with the student's Google account by hand.
   * When that account changes (or the student deletes their account) on an
   * active enrolment, flag it so an admin updates the folder sharing (Risk 1).
   */
  async alertDriveAccess(userId: string, reason: 'changed' | 'deleted', oldGoogleEmail: string | null): Promise<void> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId, course: { type: 'PAID', recordingsPlatform: 'GOOGLE_DRIVE', status: { not: 'ARCHIVED' } } },
      include: { course: { select: { id: true, slug: true, titleEn: true, titleAr: true } } },
    });
    if (!enrollments.length) return;

    // The address to remove lives on the enrolment (shown on the admin's enrolled-students
    // page and cleared on anonymisation), never in notifications or emails, which persist.
    await this.prisma.enrollment.updateMany({
      where: { id: { in: enrollments.map((e) => e.id) } },
      data: { driveAccessGranted: false, driveAccessGrantedAt: null, driveRevokeEmail: oldGoogleEmail },
    });
    for (const e of enrollments) {
      await this.audit.log({
        actorId: userId,
        action: reason === 'changed' ? 'profile.google_email_changed' : 'account.deleted_with_drive_access',
        entityType: 'Enrollment',
        entityId: e.id,
        metadata: { courseId: e.course.id },
      });
      const link = `/admin/courses/${e.course.id}?tab=enrolled&driveAccess=pending`;
      const copy =
        reason === 'changed'
          ? {
              titleEn: 'Drive access needs updating',
              titleAr: 'يجب تحديث صلاحية الوصول إلى Drive',
              bodyEn: `An enrolled student in "${e.course.titleEn}" changed their Google account. Share the Drive folder with the new account and remove the old one (see the enrolled students page).`,
              bodyAr: `غيّر طالب مسجل في "${e.course.titleAr}" حساب Google الخاص به. شارك مجلد Drive مع الحساب الجديد واحذف القديم (راجع صفحة الطلاب المسجلين).`,
            }
          : {
              titleEn: 'Remove Drive access',
              titleAr: 'أزل صلاحية الوصول إلى Drive',
              bodyEn: `A student enrolled in "${e.course.titleEn}" deleted their account. Remove their Google account from the Drive folder (see the enrolled students page).`,
              bodyAr: `حذف طالب مسجل في "${e.course.titleAr}" حسابه. أزل حساب Google الخاص به من مجلد Drive (راجع صفحة الطلاب المسجلين).`,
            };
      const admins = await this.notifications.notifyAdmins({ type: `admin.drive_access_${reason}`, ...copy, link });
      for (const a of admins) {
        await this.email.send(a.email, a.locale, {
          name: 'adminAlert',
          message: a.locale === 'ar' ? copy.bodyAr : copy.bodyEn,
          url: this.email.url(a.locale, link),
        });
      }
    }
  }

  // ------------------------------------------------------------------ CV

  async uploadCv(userId: string, file: Express.Multer.File | undefined): Promise<ProfileDto> {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose a PDF file' });
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'The file must be 5 MB or smaller' });
    }
    if (detectFileType(file.buffer) !== 'application/pdf') {
      throw new BadRequestException({ code: 'FILE_TYPE', message: 'The CV must be a PDF file' });
    }
    const profile = await this.load(userId);
    const key = await this.storage.put('cvs', file.buffer, 'application/pdf');
    await this.prisma.profile.update({ where: { id: profile.id }, data: { cvKey: key, cvUploadedAt: new Date() } });
    if (profile.cvKey && !(await this.safeDelete(profile.cvKey))) {
      // Keys are random (no personal data), so logging one for manual cleanup is safe.
      this.logger.warn(`Orphaned CV object needs manual deletion: ${profile.cvKey}`);
    }
    this.logger.log(`CV uploaded (sha256 prefix ${sha256(file.buffer).slice(0, 8)})`);
    return toProfileDto(await this.recompute(userId));
  }

  async deleteCv(userId: string): Promise<ProfileDto> {
    const profile = await this.load(userId);
    if (!profile.cvKey) throw new NotFoundException();
    await this.prisma.profile.update({ where: { id: profile.id }, data: { cvKey: null, cvUploadedAt: null } });
    if (!(await this.safeDelete(profile.cvKey))) {
      this.logger.warn(`Orphaned CV object needs manual deletion: ${profile.cvKey}`);
    }
    return toProfileDto(await this.recompute(userId));
  }

  /** Deletes a private object; returns false (and logs) instead of throwing. */
  async safeDelete(key: string): Promise<boolean> {
    try {
      await this.storage.delete(key);
      return true;
    } catch (err) {
      this.logger.warn(`Could not delete object: ${(err as Error).name}`);
      return false;
    }
  }
}
