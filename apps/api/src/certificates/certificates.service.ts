import { ConflictException, ForbiddenException, GoneException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  certificateEligibility,
  certificateOffered,
  certificatePath,
  formatSerial,
  linkedInAddUrl,
  normalizeSerial,
  SERIAL_RANDOM_LENGTH,
  toCsv,
  type CertificateRosterDto,
  type CertificateRule,
  type CertificateRuleInput,
  type Eligibility,
  type InstructorName,
  type IssueCertificatesInput,
  type IssueOutcome,
  type IssueResultDto,
  type LearnCertificateDto,
  type Locale,
  type MyCertificateDto,
  type PublicCertificateDto,
  hasAdminPermission,
} from '@academy/shared';
import { Prisma, type Certificate, type Course } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { capRows } from '../admin/export';
import type { Actor } from '../applications/workflow.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { AuditService } from '../audit/audit.service';
import { LEARNER_ROLE_FILTER } from '../common/learners';
import type { AuthUser } from '../common/decorators';
import { courseKey, SignedInCache } from '../common/signed-in-cache';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * What other features get when a certificate is issued or re-issued. Points and badges are
 * called directly (PointsService.onCertificateIssued / onCertificateRevoked); anything else can
 * register with CertificatesService.onIssued(...) from a module's onModuleInit. Listeners run
 * after the certificate is saved and the student is told; a failing listener is logged, never
 * undoes the certificate. `reissued` is true when an existing certificate was re-issued
 * (re-validated after a revocation or refreshed), so a one-off reward can skip it.
 */
export interface CertificateIssuedEvent {
  certificateId: string;
  serial: string;
  userId: string;
  courseId: string;
  issuedAt: Date;
  issuedById: string | null;
  grade: string | null;
  reissued: boolean;
}
export type CertificateIssuedListener = (event: CertificateIssuedEvent) => void | Promise<void>;

/** A new serial: the year, then 40 random bits (collisions are retried, see create()). */
export function newSerial(now = new Date()): string {
  return formatSerial(now.getUTCFullYear(), randomBytes(SERIAL_RANDOM_LENGTH));
}

type CertWithCourse = Certificate & {
  enrollment: { userId: string; courseId: string; course: { slug: string }; user: { deletedAt: Date | null; anonymizedAt: Date | null } };
};

const certInclude = {
  enrollment: { select: { userId: true, courseId: true, course: { select: { slug: true } }, user: { select: { deletedAt: true, anonymizedAt: true } } } },
} as const;

const ruleOf = (c: Pick<Course, 'certMinSessionsPercent' | 'certRequireAssessments' | 'certRuleEn' | 'certRuleAr'>): CertificateRule => ({
  minSessionsPercent: c.certMinSessionsPercent,
  requireAssessments: c.certRequireAssessments,
  textEn: c.certRuleEn,
  textAr: c.certRuleAr,
});

/** Completion certificates: issue and revoke (admin), the public verification page, and the PDF. */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);
  private readonly listeners: CertificateIssuedListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly assessments: AssessmentsService,
    private readonly points: PointsService,
    @Inject(ENV) private readonly env: Env,
    private readonly cache: SignedInCache,
  ) {}

  /** The hook for points and badges (PR D): called once per certificate issued or re-issued. */
  onIssued(listener: CertificateIssuedListener): void {
    this.listeners.push(listener);
  }

  verifyUrl(locale: Locale, serial: string): string {
    return `${this.env.WEB_URL}${certificatePath(locale, serial)}`;
  }

  private publicPdfUrl(serial: string): string {
    return `${this.env.WEB_URL}/api/certificates/${serial}/pdf`;
  }

  // ------------------------------------------------------------------ eligibility

  private async course(courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  /** Each student's eligibility under the course rule: sessions completed, required assessments, capstone. */
  async eligibilityFor(course: Pick<Course, 'id' | 'certMinSessionsPercent' | 'certRequireAssessments'>, userIds: string[]): Promise<Map<string, Eligibility>> {
    const [total, progress, results, capstones] = await Promise.all([
      this.prisma.courseSession.count({ where: { courseId: course.id } }),
      userIds.length
        ? this.prisma.sessionProgress.groupBy({ by: ['userId'], where: { userId: { in: userIds }, session: { courseId: course.id } }, _count: { _all: true } })
        : Promise.resolve([]),
      this.assessments.courseResultsFor(course.id, userIds),
      // The capstone: a course-level lab or assignment that counts toward the certificate.
      this.prisma.assessment.findMany({
        where: { courseId: course.id, status: 'PUBLISHED', sessionId: null, countsForCertificate: true, type: { not: 'QUIZ' } },
        select: { id: true },
      }),
    ]);
    const done = new Map(progress.map((p) => [p.userId, p._count._all]));
    const rule = { minSessionsPercent: course.certMinSessionsPercent, requireAssessments: course.certRequireAssessments };
    const capstoneIds = capstones.map((a) => a.id);
    return new Map(
      userIds.map((id) => [id, certificateEligibility(rule, { sessions: { completed: done.get(id) ?? 0, total }, results: results.get(id)!, capstoneIds })]),
    );
  }

  // ------------------------------------------------------------------ admin: roster, rule, CSV

  private async enrolled(courseId: string) {
    return this.prisma.enrollment.findMany({
      // Certificates are for learners (students, and speakers who enrolled to study): not admins previewing, not deleted accounts.
      where: { courseId, user: { deletedAt: null, role: LEARNER_ROLE_FILTER } },
      orderBy: { enrolledAt: 'asc' },
      take: 5001,
      select: {
        id: true,
        enrolledAt: true,
        certificate: true,
        user: { select: { id: true, email: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } },
      },
    });
  }

  async roster(courseId: string): Promise<CertificateRosterDto> {
    const course = await this.course(courseId);
    const rows = (await this.enrolled(courseId)).slice(0, 5000);
    const elig = await this.eligibilityFor(course, rows.map((r) => r.user.id));
    const out = rows.map((r) => {
      const c = r.certificate;
      return {
        userId: r.user.id,
        name: r.user.profile?.fullNameEn || r.user.profile?.fullNameAr || null,
        email: r.user.email,
        enrolledAt: r.enrolledAt.toISOString(),
        eligibility: elig.get(r.user.id)!,
        certificate: c
          ? { id: c.id, serial: c.serial, issuedAt: c.issuedAt.toISOString(), grade: c.grade, revokedAt: c.revokedAt?.toISOString() ?? null, revokeReason: c.revokeReason }
          : null,
      };
    });
    return {
      rule: ruleOf(course),
      rows: out,
      counts: {
        enrolled: out.length,
        eligible: out.filter((r) => r.eligibility.eligible).length,
        issued: out.filter((r) => r.certificate && !r.certificate.revokedAt).length,
        revoked: out.filter((r) => r.certificate?.revokedAt).length,
      },
    };
  }

  async setRule(courseId: string, input: CertificateRuleInput, admin: Actor): Promise<CertificateRule> {
    await this.course(courseId);
    const c = await this.prisma.course.update({
      where: { id: courseId },
      data: { certMinSessionsPercent: input.minSessionsPercent, certRequireAssessments: input.requireAssessments, certRuleEn: input.textEn, certRuleAr: input.textAr },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'course.certificate_rule_updated',
      entityType: 'Course',
      entityId: courseId,
      metadata: { minSessionsPercent: input.minSessionsPercent, requireAssessments: input.requireAssessments },
    });
    return ruleOf(c);
  }

  async rosterCsv(courseId: string, admin: Actor): Promise<string> {
    const course = await this.course(courseId);
    const rows = await this.enrolled(courseId);
    const elig = await this.eligibilityFor(course, rows.slice(0, 5000).map((r) => r.user.id));
    await this.audit.log({ actorId: admin.id, action: 'certificates.exported', entityType: 'Course', entityId: courseId, metadata: { count: rows.length } });
    return toCsv(
      ['Name', 'Email', 'Sessions completed %', 'Required assessments passed', 'Average %', 'Capstone', 'Eligible', 'Certificate', 'Serial', 'Issued at', 'Grade', 'Revoked at', 'Revoke reason'],
      capRows(rows, (r) => {
        const e = elig.get(r.user.id)!;
        const c = r.certificate;
        return [
          r.user.profile?.fullNameEn || r.user.profile?.fullNameAr || '',
          r.user.email,
          e.sessions.percent,
          `${e.assessments.passed}/${e.assessments.required}`,
          e.averagePercent ?? '',
          e.capstone ?? '',
          e.eligible ? 'yes' : 'no',
          c ? (c.revokedAt ? 'revoked' : 'issued') : '',
          c?.serial ?? '',
          c?.issuedAt.toISOString() ?? '',
          c?.grade ?? '',
          c?.revokedAt?.toISOString() ?? '',
          c?.revokeReason ?? '',
        ];
      }),
    );
  }

  // ------------------------------------------------------------------ issue, revoke, re-issue

  /** Snapshot of what's printed: the student's name and the course as they are today. */
  private async snapshot(enrollmentId: string) {
    const e = await this.prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: {
        userId: true,
        courseId: true,
        user: { select: { email: true, locale: true, deletedAt: true, profile: { select: { fullNameEn: true, fullNameAr: true } } } },
        course: {
          select: {
            slug: true,
            titleEn: true,
            titleAr: true,
            instructors: { orderBy: { order: 'asc' }, select: { instructor: { select: { name: true, nameAr: true } } } },
          },
        },
      },
    });
    const en = e.user.profile?.fullNameEn?.trim() || '';
    const ar = e.user.profile?.fullNameAr?.trim() || '';
    const instructors: InstructorName[] = e.course.instructors.map((i) => ({ name: i.instructor.name, nameAr: i.instructor.nameAr }));
    return {
      enrollment: e,
      data: {
        // An Arabic-only profile prints the Arabic name as the main one.
        nameOnCertificate: en || ar,
        nameOnCertificateAr: en && ar && ar !== en ? ar : null,
        courseTitleEn: e.course.titleEn,
        courseTitleAr: e.course.titleAr,
        instructorNames: instructors as unknown as Prisma.InputJsonValue,
      },
    };
  }

  /**
   * Issues one enrolment's certificate (the single entry point; bulk issue calls it per student).
   * Idempotent: an enrolment that already has one (valid or revoked) gets it back with created=false.
   */
  async issue(enrollmentId: string, opts: { grade?: string | null; issuedById: string | null }): Promise<{ certificate: Certificate; created: boolean }> {
    const existing = await this.prisma.certificate.findUnique({ where: { enrollmentId } });
    if (existing) return { certificate: existing, created: false };
    const { enrollment, data } = await this.snapshot(enrollmentId);
    if (!data.nameOnCertificate) throw new ConflictException({ code: 'NO_NAME', message: 'The student has no name on their profile' });
    for (let attempt = 0; ; attempt++) {
      try {
        const certificate = await this.prisma.$transaction(async (tx) => {
          const c = await tx.certificate.create({
            data: { enrollmentId, serial: newSerial(), issuedById: opts.issuedById, grade: opts.grade ?? null, ...data },
          });
          await this.audit.log(
            {
              actorId: opts.issuedById,
              action: 'certificate.issued',
              entityType: 'Certificate',
              entityId: c.id,
              metadata: { courseId: enrollment.courseId, userId: enrollment.userId, serial: c.serial, grade: c.grade },
            },
            tx,
          );
          return c;
        });
        await this.announce(certificate, enrollment, false);
        return { certificate, created: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
          // Two admins issuing at once: the other request won, so this is the same certificate.
          if (target.includes('enrollmentId')) {
            return { certificate: await this.prisma.certificate.findUniqueOrThrow({ where: { enrollmentId } }), created: false };
          }
          // A serial collision (1 in 2^40 per pair): draw again.
          if (attempt < 3) continue;
        }
        throw err;
      }
    }
  }

  /** Admin bulk issue. Students who don't meet the rule need `force` (the admin confirmed a warning). */
  async issueBulk(courseId: string, input: IssueCertificatesInput, admin: Actor): Promise<IssueResultDto> {
    const course = await this.course(courseId);
    const userIds = [...new Set(input.userIds)];
    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, userId: { in: userIds }, user: { deletedAt: null, role: LEARNER_ROLE_FILTER } },
      select: { id: true, userId: true, certificate: { select: { serial: true, revokedAt: true } } },
    });
    const byUser = new Map(enrollments.map((e) => [e.userId, e]));
    if (!input.force) {
      const fresh = enrollments.filter((e) => !e.certificate).map((e) => e.userId);
      const elig = await this.eligibilityFor(course, fresh);
      const blocked = fresh.filter((id) => !elig.get(id)!.eligible);
      if (blocked.length) {
        throw new ConflictException({ code: 'NOT_ELIGIBLE', message: 'Some students do not meet the certificate rule', userIds: blocked });
      }
    }
    const results: IssueResultDto['results'] = [];
    for (const userId of userIds) {
      const e = byUser.get(userId);
      let outcome: IssueOutcome;
      let serial: string | undefined;
      if (!e) outcome = 'NOT_ENROLLED';
      else if (e.certificate) {
        outcome = e.certificate.revokedAt ? 'REVOKED' : 'ALREADY_ISSUED';
        serial = e.certificate.serial;
      } else {
        try {
          const r = await this.issue(e.id, { grade: input.grade, issuedById: admin.id });
          outcome = r.created ? 'ISSUED' : r.certificate.revokedAt ? 'REVOKED' : 'ALREADY_ISSUED';
          serial = r.certificate.serial;
        } catch (err) {
          if (!(err instanceof ConflictException) || (err.getResponse() as { code?: string }).code !== 'NO_NAME') throw err;
          outcome = 'NO_NAME';
        }
      }
      results.push({ userId, outcome, ...(serial ? { serial } : {}) });
    }
    return { results, issued: results.filter((r) => r.outcome === 'ISSUED').length };
  }

  /** The cached PDF's key, read under a row lock so a download caching a new copy can't slip in between. */
  private async lockPdfKey(tx: Prisma.TransactionClient, id: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ pdfKey: string | null }[]>`SELECT "pdfKey" FROM "Certificate" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0]?.pdfKey ?? null;
  }

  async revoke(id: string, reason: string, admin: Actor): Promise<void> {
    const c = await this.prisma.certificate.findUnique({ where: { id }, include: certInclude });
    if (!c) throw new NotFoundException('Certificate not found');
    const pdfKey = await this.prisma.$transaction(async (tx) => {
      const key = await this.lockPdfKey(tx, id);
      // Only a valid certificate can be revoked: two admins at once give one revocation, one reason.
      const r = await tx.certificate.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason, pdfKey: null } });
      if (r.count !== 1) throw new ConflictException({ code: 'ALREADY_REVOKED', message: 'This certificate is already revoked' });
      await this.audit.log(
        { actorId: admin.id, action: 'certificate.revoked', entityType: 'Certificate', entityId: id, metadata: { courseId: c.enrollment.courseId, userId: c.enrollment.userId, serial: c.serial } },
        tx,
      );
      return key;
    });
    // The PDF can't be downloaded any more (checked on every download); remove the cached copy too.
    if (pdfKey) await this.safeDelete(pdfKey);
    // The certificate bonus and the "Certified" badge go with it.
    await this.points
      .onCertificateRevoked(c.enrollment.userId, c.enrollment.courseId, c.id)
      .catch((err: unknown) => this.logger.error(`Points on revocation failed: ${(err as Error).message}`));
  }

  /**
   * Re-issues an existing certificate under the same serial: valid again if it was revoked, with a
   * fresh snapshot of the name, course title and instructors, a new issue date and a new PDF.
   */
  async reissue(id: string, grade: string | null | undefined, admin: Actor): Promise<void> {
    const c = await this.prisma.certificate.findUnique({ where: { id }, include: certInclude });
    if (!c) throw new NotFoundException('Certificate not found');
    if (c.enrollment.user.deletedAt) throw new ConflictException({ code: 'ACCOUNT_DELETED', message: 'This student deleted their account' });
    const { enrollment, data } = await this.snapshot(c.enrollmentId);
    if (!data.nameOnCertificate) throw new ConflictException({ code: 'NO_NAME', message: 'The student has no name on their profile' });
    const { updated, pdfKey } = await this.prisma.$transaction(async (tx) => {
      const key = await this.lockPdfKey(tx, id);
      const u = await tx.certificate.update({
        where: { id },
        data: { ...data, issuedAt: new Date(), issuedById: admin.id, revokedAt: null, revokeReason: null, pdfKey: null, grade: grade === undefined ? c.grade : grade },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'certificate.reissued',
          entityType: 'Certificate',
          entityId: id,
          metadata: { courseId: c.enrollment.courseId, userId: c.enrollment.userId, serial: c.serial, wasRevoked: Boolean(c.revokedAt), grade: u.grade },
        },
        tx,
      );
      return { updated: u, pdfKey: key };
    });
    if (pdfKey) await this.safeDelete(pdfKey);
    await this.announce(updated, enrollment, true);
  }

  /** Email (bulk lane) and in-app notification to the student, then the onIssued listeners. */
  private async announce(
    c: Certificate,
    e: { userId: string; courseId: string; user: { email: string; locale: Locale; deletedAt: Date | null }; course: { titleEn: string; titleAr: string } },
    reissued: boolean,
  ): Promise<void> {
    if (!e.user.deletedAt) {
      const path = certificatePath(e.user.locale, c.serial).replace(/^\/(en|ar)/, '');
      await this.notifications
        .create(e.userId, {
          type: 'certificate.issued',
          titleEn: `Your certificate for ${e.course.titleEn}`,
          titleAr: `شهادتك في ${e.course.titleAr || e.course.titleEn}`,
          bodyEn: 'Congratulations! Download the PDF, share the link or add it to LinkedIn.',
          bodyAr: 'مبروك! نزّل الشهادة أو شارك رابطها أو أضفها إلى LinkedIn.',
          link: path,
        })
        .catch((err: unknown) => this.logger.error(`Certificate notification failed: ${(err as Error).name}`));
      const ar = e.user.locale === 'ar';
      const courseTitle = ar ? e.course.titleAr || e.course.titleEn : e.course.titleEn;
      const verifyUrl = this.verifyUrl(e.user.locale, c.serial);
      void this.email.send(
        e.user.email,
        e.user.locale,
        {
          name: 'certificateIssued',
          courseTitle,
          serial: c.serial,
          verifyUrl,
          downloadUrl: this.publicPdfUrl(c.serial),
          linkedInUrl: linkedInAddUrl({ courseTitle: c.courseTitleEn, issuedAt: c.issuedAt, verifyUrl: this.verifyUrl('en', c.serial), serial: c.serial }),
        },
        { bulk: true },
      );
    }
    // Points and badges: the certificate bonus and "Certified" (idempotent, also after a re-issue).
    await this.points
      .onCertificateIssued(e.userId, e.courseId, c.id)
      .catch((err: unknown) => this.logger.error(`Points on issue failed: ${(err as Error).message}`));
    const event: CertificateIssuedEvent = {
      certificateId: c.id,
      serial: c.serial,
      userId: e.userId,
      courseId: e.courseId,
      issuedAt: c.issuedAt,
      issuedById: c.issuedById,
      grade: c.grade,
      reissued,
    };
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        this.logger.error(`Certificate listener failed: ${(err as Error).message}`);
      }
    }
  }

  // ------------------------------------------------------------------ students

  private toMine(c: Certificate & { enrollment: { course: { slug: string } } }): MyCertificateDto {
    return {
      id: c.id,
      serial: c.serial,
      status: c.revokedAt ? 'REVOKED' : 'VALID',
      issuedAt: c.issuedAt.toISOString(),
      grade: c.grade,
      courseSlug: c.enrollment.course.slug,
      courseTitleEn: c.courseTitleEn,
      courseTitleAr: c.courseTitleAr,
      nameOnCertificate: c.nameOnCertificate,
    };
  }

  /** The student's certificates (revoked ones too, marked, so a revocation is never silent). */
  async mine(userId: string): Promise<MyCertificateDto[]> {
    const list = await this.prisma.certificate.findMany({
      where: { enrollment: { userId } },
      orderBy: { issuedAt: 'desc' },
      include: { enrollment: { select: { course: { select: { slug: true } } } } },
    });
    return list.map((c) => this.toMine(c));
  }

  /** The learn page's card: the rule, my live status against it, and my certificate once issued. */
  async forLearner(user: AuthUser, slug: string): Promise<LearnCertificateDto> {
    // A read: the course from the signed-in cache (any write empties it).
    const course = await this.cache.get(courseKey(slug), () => this.prisma.course.findUnique({ where: { slug } }));
    if (!course) throw new NotFoundException('Course not found');
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      include: { certificate: { include: { enrollment: { select: { course: { select: { slug: true } } } } } } },
    });
    if (!enrollment && !hasAdminPermission(user, ['ACADEMIC'])) throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    const rule = ruleOf(course);
    const eligibility = (await this.eligibilityFor(course, [user.id])).get(user.id)!;
    const certificate = enrollment?.certificate ? this.toMine(enrollment.certificate) : null;
    return { offered: certificateOffered(rule, course.included as { certificate?: boolean } | null, Boolean(certificate)), rule, eligibility, certificate };
  }

  // ------------------------------------------------------------------ public verification

  private async bySerial(raw: string): Promise<CertWithCourse> {
    const serial = normalizeSerial(raw);
    const c = serial ? await this.prisma.certificate.findUnique({ where: { serial }, include: certInclude }) : null;
    if (!c) throw new NotFoundException('Certificate not found');
    return c;
  }

  async publicView(raw: string): Promise<PublicCertificateDto> {
    const c = await this.bySerial(raw);
    // A deleted (or anonymised) account: the certificate stays on record but shows nothing personal.
    if (c.enrollment.user.deletedAt || c.enrollment.user.anonymizedAt) return { status: 'UNAVAILABLE', serial: c.serial };
    return {
      status: c.revokedAt ? 'REVOKED' : 'VALID',
      serial: c.serial,
      name: c.nameOnCertificate,
      nameAr: c.nameOnCertificateAr,
      courseSlug: c.enrollment.course.slug,
      courseTitleEn: c.courseTitleEn,
      courseTitleAr: c.courseTitleAr,
      instructors: (c.instructorNames as unknown as InstructorName[]) ?? [],
      issuedAt: c.issuedAt.toISOString(),
      grade: c.grade,
      revokedAt: c.revokedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------ PDF

  /** Valid certificates of live accounts only; anything else has no PDF. */
  private assertDownloadable(c: CertWithCourse): void {
    if (c.enrollment.user.deletedAt || c.enrollment.user.anonymizedAt) throw new NotFoundException('Certificate not found');
    if (c.revokedAt) throw new GoneException({ code: 'REVOKED', message: 'This certificate has been revoked' });
  }

  async publicPdf(raw: string): Promise<{ filename: string; body: Buffer }> {
    const c = await this.bySerial(raw);
    this.assertDownloadable(c);
    return { filename: `${c.serial}.pdf`, body: await this.pdf(c) };
  }

  async myPdf(userId: string, raw: string): Promise<{ filename: string; body: Buffer }> {
    const c = await this.bySerial(raw);
    // Someone else's certificate looks exactly like an unknown one.
    if (c.enrollment.userId !== userId) throw new NotFoundException('Certificate not found');
    this.assertDownloadable(c);
    return { filename: `${c.serial}.pdf`, body: await this.pdf(c) };
  }

  /** The cached PDF from the bucket, or a freshly rendered one (then cached under certificates/). */
  private async pdf(c: Certificate): Promise<Buffer> {
    if (c.pdfKey) {
      try {
        const cached = await this.storage.get(c.pdfKey);
        if (cached) return cached;
      } catch (err) {
        this.logger.warn(`Cached certificate PDF unreadable, rendering again: ${(err as Error).name}`);
      }
    }
    // Loaded on first download, not at boot (PDFKit and fontkit add to the container's start time).
    const { renderCertificatePdf } = await import('./pdf');
    const body = await renderCertificatePdf({
      serial: c.serial,
      name: c.nameOnCertificate,
      nameAr: c.nameOnCertificateAr,
      courseTitleEn: c.courseTitleEn,
      courseTitleAr: c.courseTitleAr,
      instructors: (c.instructorNames as unknown as InstructorName[]) ?? [],
      issuedAt: c.issuedAt,
      grade: c.grade,
      verifyUrl: this.verifyUrl('en', c.serial),
    });
    try {
      const key = await this.storage.put('certificates', body, 'application/pdf');
      // Only if nothing changed meanwhile (a revocation or re-issue clears pdfKey and must win).
      const r = await this.prisma.certificate.updateMany({ where: { id: c.id, pdfKey: c.pdfKey, revokedAt: null, updatedAt: c.updatedAt }, data: { pdfKey: key } });
      if (r.count !== 1) await this.safeDelete(key);
      else if (c.pdfKey) await this.safeDelete(c.pdfKey);
    } catch (err) {
      // Caching is an optimisation: the download still works.
      this.logger.warn(`Could not cache a certificate PDF: ${(err as Error).name}`);
    }
    return body;
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`Could not delete a certificate PDF: ${(err as Error).name}`);
    }
  }
}
