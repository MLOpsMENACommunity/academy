import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Profile, type SkillRating } from '@prisma/client';
import {
  adminSectionSchemaFor,
  computeCompleteness,
  STUDENT_ONLY_CONSENTS,
  type AdminProfileSection,
  profileSectionSchemas,
  sectionSchemaFor,
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
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';

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
    telegramUsername: p?.telegramUsername ?? null,
    discordUsername: p?.discordUsername ?? null,
    communityAnsweredAt: iso(p?.communityAnsweredAt),
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

  /** The student's profile, created empty on first use. One read in the common case. */
  private async load(userId: string): Promise<ProfileWithSkills> {
    const existing = await this.prisma.profile.findUnique({ where: { userId }, include: { skills: true } });
    if (existing) return existing;
    // Upsert, not create: two first requests in parallel must not collide.
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

  /**
   * Saves one section. The profile is read once; the new completeness is
   * computed in memory from that read plus the change, and written in the same
   * UPDATE (QA M5: this used to re-read the profile and write a second time,
   * 21 database round trips per save, now 4; 8 for skills).
   *
   * The UPDATE only applies if the profile hasn't changed since it was read
   * (same updatedAt). If another save got in between, the whole save is redone
   * from a fresh read, so completeness never comes from a stale copy.
   */
  async updateSection(userId: string, section: ProfileSection, raw: unknown): Promise<ProfileDto> {
    return this.save(userId, section, raw, null);
  }

  /**
   * An admin edits a student's profile (Admin → Students → {student}): the same validation as
   * the student's form, but an admin never accepts the Terms or answers the consent questions
   * for them (core keeps acceptedTermsAt as it is; the community step's "answered" stamp is
   * left alone; consents can be turned off, never on). Audited with ids and field names only.
   */
  async adminUpdateSection(userId: string, section: AdminProfileSection, raw: unknown, adminId: string): Promise<ProfileDto> {
    return this.save(userId, section, raw, adminId);
  }

  private async save(userId: string, section: AdminProfileSection, raw: unknown, adminId: string | null): Promise<ProfileDto> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.saveSection(userId, section, raw, adminId);
      } catch (err) {
        const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
        if (!raced || attempt >= 3) throw err;
      }
    }
  }

  private async saveSection(userId: string, section: AdminProfileSection, raw: unknown, adminId: string | null): Promise<ProfileDto> {
    const before = await this.load(userId);
    // Cross-section checks (ML/AI vs total experience, primary vs secondary area) need the saved profile.
    const schema = adminId ? adminSectionSchemaFor(section, toProfileDto(before)) : sectionSchemaFor(section as ProfileSection, toProfileDto(before));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data as Record<string, unknown>;
    const now = new Date();

    let changes: Record<string, unknown>;
    let skills = before.skills;
    if (section === 'skills') {
      const { skills: ratings, ...rest } = data as z.infer<(typeof profileSectionSchemas)['skills']>;
      changes = rest;
      skills = (Object.entries(ratings) as [Skill, number][]).map(([skill, level]) => ({ profileId: before.id, skill, level }) as SkillRating);
    } else if (section === 'core') {
      const { acceptTerms: _accept, ...rest } = data as z.infer<(typeof profileSectionSchemas)['core']>;
      // Only the student accepts the Terms: an admin save keeps the stamp as it is.
      changes = { ...rest, acceptedTermsAt: adminId ? before.acceptedTermsAt : (before.acceptedTermsAt ?? now) };
      // A new primary area is no longer also a secondary one.
      if (before.secondaryAreas.includes(rest.primaryArea)) {
        changes.secondaryAreas = before.secondaryAreas.filter((a) => a !== rest.primaryArea);
      }
    } else if (section === 'community') {
      // The student answering the step stamps it; an admin correcting an answer doesn't.
      changes = adminId ? data : { ...data, communityAnsweredAt: now };
    } else {
      changes = data;
    }
    if (adminId) {
      for (const consent of STUDENT_ONLY_CONSENTS) {
        if (changes[consent] === true && !before[consent]) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'CONSENT_STUDENT_ONLY',
            message: 'Only the student can give this consent',
            errors: [{ path: consent, message: 'Only the student can turn this on' }],
          });
        }
      }
    }

    const c = computeCompleteness(toProfileDto({ ...before, ...changes, skills } as ProfileWithSkills));
    const update = this.prisma.profile.update({
      // Optimistic check: P2025 if another save changed the profile meanwhile (retried above).
      where: { id: before.id, updatedAt: before.updatedAt },
      data: {
        ...(changes as Prisma.ProfileUpdateInput),
        completeness: c.percent,
        coreCompletedAt: c.coreComplete ? (before.coreCompletedAt ?? now) : null,
      },
    });

    let after: ProfileWithSkills;
    if (section === 'skills') {
      const [, , updated] = await this.prisma.$transaction([
        this.prisma.skillRating.deleteMany({ where: { profileId: before.id } }),
        this.prisma.skillRating.createMany({ data: skills.map(({ skill, level }) => ({ profileId: before.id, skill, level })) }),
        update,
      ]);
      after = { ...updated, skills };
    } else {
      // Skills are untouched, so the ones already read are current: a single UPDATE … RETURNING.
      after = { ...(await update), skills: before.skills };
    }

    if (section === 'core' && before.googleEmail && after.googleEmail !== before.googleEmail) {
      await this.alertDriveAccess(userId, 'changed', before.googleEmail, adminId ?? userId);
    }
    if (adminId) {
      // Field names only: never the values (they are personal data).
      const fields = Object.keys(changes).filter((k) => JSON.stringify(changes[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
      await this.audit.log({ actorId: adminId, action: 'profile.updated_by_admin', entityType: 'User', entityId: userId, metadata: { section, fields } });
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
  async alertDriveAccess(userId: string, reason: 'changed' | 'deleted', oldGoogleEmail: string | null, actorId: string = userId): Promise<void> {
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
        actorId,
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
      // Whoever manages enrolments (the enrolled students page).
      const admins = await this.notifications.notifyAdmins({ type: `admin.drive_access_${reason}`, ...copy, link }, ['ADMISSIONS', 'ACADEMIC']);
      // Queued, not awaited: delivery is paced and must not hold up the student's save.
      for (const a of admins) {
        void this.email.send(a.email, a.locale, {
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

  /** The owner's own CV: a 5-minute link, like the admin view (QA L23). */
  async cvUrl(userId: string): Promise<{ url: string; expiresIn: number }> {
    const p = await this.prisma.profile.findUnique({ where: { userId }, select: { cvKey: true } });
    if (!p?.cvKey) throw new NotFoundException('No CV');
    return { url: await this.storage.signedUrl(p.cvKey), expiresIn: SIGNED_URL_TTL_SECONDS };
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
