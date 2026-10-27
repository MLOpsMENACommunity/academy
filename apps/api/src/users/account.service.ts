import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyPassword } from '../auth/password-hasher';
import { confirmMatches, type AddStudentInput, type AdminPermission, type Locale } from '@academy/shared';
import { randomToken, sha256 } from '../common/crypto';
import { ApplicationWorkflow } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../common/decorators';
import { TokensService } from '../auth/tokens.service';
import { EmailService } from '../email/email.service';
import { InvitesService } from '../invites/invites.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SpeakerPortalService } from '../speaker-portal/speaker-portal.service';
import { ProfileService, toProfileDto } from './profile.service';
import { assertNotLastSuper } from '../admin-team/last-super';

export const ANONYMIZE_AFTER_DAYS = 30;
/** "Add student": how long the choose-your-password link works (then "Forgot password" does). */
export const WELCOME_LINK_DAYS = 7;
const REAUTH_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly email: EmailService,
    private readonly profiles: ProfileService,
    private readonly audit: AuditService,
    private readonly speakerPortal: SpeakerPortalService,
    private readonly invites: InvitesService,
    private readonly workflow: ApplicationWorkflow,
    private readonly consultations: ConsultationsService,
  ) {}

  /**
   * Re-authentication for sensitive changes. Users with a password re-enter it.
   * Google-only users must be on a session that itself signed in with Google in
   * the last few minutes (checked on the session, not the account, so another
   * device's fresh sign-in doesn't unlock an old or stolen session).
   */
  private async checkPassword(session: AuthUser, password: string | undefined): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.id } });
    if (!user.passwordHash) {
      const fresh = session.amr === 'google' && Date.now() - session.authTime.getTime() < REAUTH_WINDOW_MS;
      if (!fresh) {
        throw new ForbiddenException({ code: 'REAUTH_REQUIRED', message: 'Sign in with Google again to confirm it is you' });
      }
      return;
    }
    if (!password || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException({ code: 'WRONG_PASSWORD', message: 'Your current password is incorrect' });
    }
  }

  async setLocale(userId: string, locale: Locale): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { locale } });
  }

  async changePassword(session: AuthUser, current: string | undefined, next: string): Promise<void> {
    await this.checkPassword(session, current);
    const userId = session.id;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.auth.hashPassword(next) },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.prisma.passwordResetToken.deleteMany({ where: { userId } });
    await this.audit.log({ actorId: userId, action: 'account.password_changed', entityType: 'User', entityId: userId });
    await this.email.send(user.email, user.locale, {
      name: 'securityNotice',
      kind: 'passwordChanged',
      url: this.email.url(user.locale, '/forgot-password'),
    });
  }

  /** Everything we hold about the student, as JSON (data portability, Law 151/2020). */
  async export(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: { include: { skills: true } },
        applications: {
          include: {
            course: { select: { slug: true, titleEn: true } },
            history: { select: { fromStatus: true, toStatus: true, reason: true, createdAt: true } },
            payments: {
              select: {
                method: true,
                amount: true,
                currency: true,
                transactionRef: true,
                senderName: true,
                senderPhone: true,
                paidAt: true,
                status: true,
                rejectionReason: true,
                createdAt: true,
              },
            },
          },
        },
        enrollments: {
          include: {
            course: { select: { slug: true, titleEn: true } },
            certificate: { select: { serial: true, issuedAt: true, grade: true, revokedAt: true, revokeReason: true, nameOnCertificate: true, nameOnCertificateAr: true, courseTitleEn: true } },
          },
        },
        sessionProgress: true,
        sessionFeedback: true,
        reminderPreferences: true,
        // The link itself is a credential: only whether it exists and when it was used.
        calendarFeed: { select: { createdAt: true, rotatedAt: true, lastFetchedAt: true } },
        notifications: { select: { titleEn: true, bodyEn: true, createdAt: true, readAt: true } },
        eventRegistrations: { select: { createdAt: true, event: { select: { slug: true, titleEn: true, startsAt: true } } } },
        speakerApplication: {
          omit: { id: true, userId: true, reviewedById: true },
        },
        speakerProfile: { select: { slug: true, name: true, titleEn: true, bioEn: true, photoUrl: true, linkedinUrl: true } },
        speakingSlots: {
          select: { startsAt: true, durationMin: true, status: true, title: true, abstract: true, bookedAt: true, event: { select: { slug: true, status: true } } },
          orderBy: { startsAt: 'asc' },
        },
        consultationsBooked: {
          select: {
            reference: true,
            method: true,
            transactionRef: true,
            startsAt: true,
            durationMin: true,
            priceEgp: true,
            note: true,
            status: true,
            createdAt: true,
            paidAt: true,
            cancelledAt: true,
            cancelReason: true,
            consultant: { select: { instructor: { select: { slug: true, name: true } } } },
          },
          orderBy: { startsAt: 'asc' },
        },
        submissions: {
          select: {
            attempt: true,
            answers: true,
            url: true,
            fileName: true,
            note: true,
            submittedAt: true,
            late: true,
            score: true,
            maxScore: true,
            gradedAt: true,
            feedback: true,
            rubricNotes: true,
            assessment: { select: { titleEn: true, type: true, course: { select: { slug: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    // Waiting lists joined from this account, or with this address before signing in.
    const waitingLists = await this.prisma.courseInterest.findMany({
      where: { OR: [{ userId }, { email: user.email.toLowerCase() }] },
      select: { email: true, locale: true, createdAt: true, notifiedAt: true, course: { select: { slug: true, titleEn: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // "Enrol by email": invites sent to this address, and the one this account enrolled through.
    const courseInvites = await this.prisma.courseInvite.findMany({
      where: { OR: [{ email: user.email.toLowerCase() }, { enrolledUserId: userId }] },
      select: { email: true, status: true, locale: true, createdAt: true, enrolledAt: true, lastEmailedAt: true, course: { select: { slug: true, titleEn: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const [points, badges, leaderboards, attendance] = await Promise.all([
      this.prisma.pointsEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { points: true, reason: true, note: true, createdAt: true, voidedAt: true, voidReason: true, course: { select: { slug: true, titleEn: true } } },
      }),
      this.prisma.userBadge.findMany({
        where: { userId },
        orderBy: { awardedAt: 'asc' },
        select: { awardedAt: true, period: true, reason: true, badge: { select: { code: true, nameEn: true } }, course: { select: { slug: true, titleEn: true } } },
      }),
      this.prisma.leaderboardOptIn.findMany({ where: { userId }, select: { optedIn: true, updatedAt: true, course: { select: { slug: true, titleEn: true } } } }),
      this.prisma.sessionAttendance.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { status: true, minutes: true, percent: true, updatedAt: true, session: { select: { order: true, titleEn: true, course: { select: { slug: true, titleEn: true } } } } },
      }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: user.email,
        role: user.role,
        locale: user.locale,
        emailVerifiedAt: user.emailVerifiedAt,
        signInWithGoogle: Boolean(user.googleId),
        createdAt: user.createdAt,
      },
      profile: toProfileDto(user.profile),
      // The Telegram account connected through the academy's bot (Profile → Community).
      telegram: user.profile?.telegramUserId
        ? { connected: true, telegramUserId: user.profile.telegramUserId.toString(), connectedAt: user.profile.telegramLinkedAt }
        : { connected: false },
      // The PDF isn't embedded, and a signed link would expire in minutes, so point to where it can be downloaded.
      cv: user.profile?.cvKey
        ? {
            uploadedAt: user.profile.cvUploadedAt,
            download: this.email.url(user.locale, '/profile?tab=links'),
            note: 'Your CV is not included in this file. Open the link above (signed in) and choose "View CV" to download it.',
          }
        : null,
      applications: user.applications.map((a) => ({
        course: a.course,
        status: a.status,
        answers: a.answers,
        source: a.source,
        createdAt: a.createdAt,
        history: a.history,
        payments: a.payments,
      })),
      enrollments: user.enrollments.map((e) => ({ course: e.course, enrolledAt: e.enrolledAt })),
      // The PDF itself is downloadable from the dashboard (signed in) or the public link.
      certificates: user.enrollments
        .filter((e) => e.certificate)
        .map(({ course, certificate: c }) => ({
          course,
          serial: c!.serial,
          name: c!.nameOnCertificate,
          nameAr: c!.nameOnCertificateAr,
          courseTitle: c!.courseTitleEn,
          issuedAt: c!.issuedAt,
          grade: c!.grade,
          status: c!.revokedAt ? 'revoked' : 'valid',
          revokedAt: c!.revokedAt,
          revokeReason: c!.revokeReason,
          verify: this.email.url(user.locale, `/certificates/${c!.serial}`),
        })),
      sessionProgress: user.sessionProgress,
      feedback: user.sessionFeedback,
      reminderPreferences: user.reminderPreferences,
      calendarFeed: user.calendarFeed,
      notifications: user.notifications,
      liveSessionRegistrations: user.eventRegistrations.map((r) => ({ session: r.event, registeredAt: r.createdAt })),
      speakerApplication: user.speakerApplication,
      speakerProfile: user.speakerProfile,
      speakerBookings: user.speakingSlots,
      consultations: user.consultationsBooked.map(({ consultant, ...c }) => ({ expert: consultant.instructor, ...c })),
      // Quizzes, labs and assignments: answers, links, grades and feedback (uploaded PDFs by name only).
      assessmentSubmissions: user.submissions.map(({ assessment, ...s }) => ({ assessment: assessment.titleEn, type: assessment.type, course: assessment.course.slug, ...s })),
      waitingLists: waitingLists.map((w) => ({ course: w.course, email: w.email, language: w.locale, joinedAt: w.createdAt, notifiedAt: w.notifiedAt })),
      // The inviting admin is named as the team, not by their address; the admin's note is an
      // internal remark about the student (like application review notes) and stays admin-only.
      courseInvites: courseInvites.map((i) => ({
        course: i.course,
        email: i.email,
        invitedBy: 'academy team',
        status: i.status,
        language: i.locale,
        invitedAt: i.createdAt,
        enrolledAt: i.enrolledAt,
        lastEmailedAt: i.lastEmailedAt,
      })),
      // Removed (voided) entries are listed with when and why, but don't count.
      points: {
        total: points.reduce((n, p) => n + (p.voidedAt ? 0 : p.points), 0),
        entries: points.map(({ voidedAt, voidReason, ...p }) => ({ ...p, removedAt: voidedAt, removedBecause: voidReason })),
      },
      attendance: attendance.map((a) => ({ course: a.session.course, session: `${a.session.order}. ${a.session.titleEn}`, status: a.status, minutes: a.minutes, percent: a.percent, updatedAt: a.updatedAt })),
      badges: badges.map((b) => ({ badge: b.badge, course: b.course, week: b.period, reason: b.reason, awardedAt: b.awardedAt })),
      leaderboards: leaderboards.map((l) => ({ course: l.course, shownOnLeaderboard: l.optedIn, changedAt: l.updatedAt })),
    };
  }

  /** Soft delete: sign-in is blocked now; personal data is anonymised after 30 days. */
  async deleteAccount(session: AuthUser, password: string | undefined): Promise<void> {
    await this.checkPassword(session, password);
    // The last super admin can't leave: nobody could manage the team any more. Checked and
    // marked deleted under the super admins' row locks (see AdminTeamService), so two super
    // admins deleting themselves at once can't both succeed.
    if (session.role === 'ADMIN') {
      await this.prisma.$transaction(async (tx) => {
        await assertNotLastSuper(tx, session.id);
        await tx.user.update({ where: { id: session.id }, data: { deletedAt: new Date() } });
      });
    }
    await this.softDelete(session.id, session.id);
  }

  /**
   * An admin deletes a student's or speaker's account (Admin → Students → {student}): the same
   * soft delete and 30-day anonymisation as when they delete it themselves. Never an admin
   * account. Typed confirmation: the account's email address.
   */
  async deleteByAdmin(userId: string, confirm: string, adminId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException('Student not found');
    if (user.role === 'ADMIN') throw new ForbiddenException({ code: 'ADMIN_ACCOUNT', message: "An admin account can't be edited or deleted here" });
    if (!confirmMatches(confirm, user.email)) {
      throw new BadRequestException({ code: 'CONFIRM_MISMATCH', message: "Type the account's email address exactly to delete it" });
    }
    await this.softDelete(userId, adminId);
  }

  /**
   * "Add student": creates a student account for an address, with no password. The person
   * gets a link to choose their own password (a password-reset token, which also confirms the
   * address and so claims any course invites for it). Nobody else ever sets it.
   */
  async createByAdmin(
    input: AddStudentInput,
    adminId: string,
    /** Admin → Team → Add admin: the new account is an admin with these presets. */
    asAdmin?: { adminPermissions: AdminPermission[] },
  ): Promise<{ id: string; email: string }> {
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true, deletedAt: true } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: existing.deletedAt ? 'This address belongs to a deleted account' : 'An account with this email already exists',
        ...(existing.deletedAt ? {} : { userId: existing.id }),
      });
    }
    const token = randomToken();
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        locale: input.locale,
        role: asAdmin ? 'ADMIN' : 'STUDENT',
        adminPermissions: asAdmin?.adminPermissions ?? [],
        profile: { create: { preferredLanguage: input.locale, fullNameEn: input.fullNameEn } },
        passwordResetTokens: { create: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + WELCOME_LINK_DAYS * 86_400_000) } },
      },
    });
    await this.audit.log({
      actorId: adminId,
      action: asAdmin ? 'admin.invited' : 'user.created_by_admin',
      entityType: 'User',
      entityId: user.id,
      ...(asAdmin ? { metadata: { permissions: asAdmin.adminPermissions } } : {}),
    });
    void this.email
      .send(user.email, user.locale, { name: 'accountCreated', url: this.email.url(user.locale, `/reset-password?token=${token}&welcome=1`), days: WELCOME_LINK_DAYS })
      .catch(() => undefined);
    return { id: user.id, email: user.email };
  }

  private async softDelete(userId: string, actorId: string): Promise<void> {
    const byTeam = actorId !== userId;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
      include: { profile: { select: { googleEmail: true } } },
    });
    // Open applications are withdrawn: their seats go back to the course and a payment still under
    // review leaves the queue (approving it would enrol a deleted account). Never throws.
    await this.workflow.withdrawForDeletedAccount(userId, { id: actorId, role: byTeam ? 'ADMIN' : user.role });
    // A deleted account's enrolments stop counting on the course pages ("N students enrolled").
    if (await this.prisma.enrollment.count({ where: { userId } })) this.workflow.publicCountsChanged('ENROLLED', null);
    await this.tokens.revokeAllForUser(userId);
    // Free their seats in live sessions that haven't started (past ones stay until anonymisation).
    await this.prisma.eventRegistration.deleteMany({ where: { userId, event: { startsAt: { gt: new Date() } } } });
    // The private calendar link stops working at once (calendar apps poll without signing in).
    await this.prisma.calendarFeed.deleteMany({ where: { userId } });
    // The Telegram account is disconnected at once: the bot stops letting it into course groups
    // and forgets its waiting join requests (groups it already joined keep it: removal is manual).
    const telegram = await this.prisma.profile.findUnique({ where: { userId }, select: { telegramUserId: true } });
    if (telegram?.telegramUserId) {
      await this.prisma.telegramJoinRequest.deleteMany({ where: { telegramUserId: telegram.telegramUserId } });
      await this.prisma.profile.update({ where: { userId }, data: { telegramUserId: null, telegramLinkedAt: null } });
    }
    // Off every leaderboard at once (boards also skip deleted accounts).
    await this.prisma.leaderboardOptIn.deleteMany({ where: { userId } });
    // Off every waiting list: nobody should email a deleted account about new courses.
    await this.prisma.courseInterest.deleteMany({ where: { OR: [{ userId }, { email: user.email.toLowerCase() }] } });
    // Invites to this address that were never used: nobody should be enrolled or emailed with it now.
    await this.invites.forgetPending(user.email);
    // Upcoming speaker bookings: the slot opens again, a draft session goes (a published one is
    // cancelled), the team is told. Never fails the deletion (errors are logged).
    await this.speakerPortal.releaseBookings(user);
    // Upcoming consultations (as student or as expert) are cancelled and the other side told; an
    // expert is unlisted. Paid ones show in Admin → Consultations for the refund. Never throws.
    await this.consultations.releaseForDeletedAccount(userId);
    await this.profiles.alertDriveAccess(userId, 'deleted', user.profile?.googleEmail ?? null, actorId);
    await this.audit.log({ actorId, action: byTeam ? 'account.deleted_by_admin' : 'account.deleted', entityType: 'User', entityId: userId });
    await this.email.send(user.email, user.locale, { name: 'accountDeleted', byTeam });
  }

  /**
   * Irreversibly removes personal data from a deleted account. Payment records
   * stay (amount, method, reference, dates, decision) for accounting, with the
   * sender's name and phone removed and screenshots deleted.
   */
  async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: true,
        applications: { include: { payments: true } },
        submissions: { select: { fileKey: true } },
        enrollments: { select: { certificate: { select: { pdfKey: true } } } },
        consultationsBooked: { select: { screenshotKey: true } },
      },
    });
    const keys = [
      user.profile?.cvKey,
      ...user.applications.flatMap((a) => a.payments.map((p) => p.screenshotKey)),
      ...user.submissions.map((s) => s.fileKey),
      ...user.consultationsBooked.map((c) => c.screenshotKey),
      // Certificate PDFs print the name.
      ...user.enrollments.map((e) => e.certificate?.pdfKey),
    ].filter((k): k is string => Boolean(k));
    // If any file can't be deleted, stop: keys stay referenced and tomorrow's run retries.
    for (const key of keys) {
      if (!(await this.profiles.safeDelete(key))) {
        throw new Error('Storage delete failed; anonymisation will be retried');
      }
    }

    const applicationIds = user.applications.map((a) => a.id);
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { applicationId: { in: applicationIds } },
        data: {
          senderName: '[anonymised]',
          senderPhone: '[anonymised]',
          rejectionReason: null,
          screenshotKey: null,
          screenshotSha256: null,
          screenshotDeletedAt: new Date(),
        },
      }),
      this.prisma.application.updateMany({
        where: { id: { in: applicationIds } },
        data: { profileSnapshot: {}, answers: {}, source: {}, ref: null, rejectionReason: null },
      }),
      this.prisma.applicationStatusHistory.updateMany({
        where: { applicationId: { in: applicationIds } },
        data: { reason: null },
      }),
      this.prisma.adminNote.deleteMany({ where: { subjectUserId: userId } }),
      this.prisma.enrollment.updateMany({ where: { userId }, data: { driveRevokeEmail: null } }),
      // The profile goes with the connected Telegram account; any join request still waiting from it too.
      ...(user.profile?.telegramUserId ? [this.prisma.telegramJoinRequest.deleteMany({ where: { telegramUserId: user.profile.telegramUserId } })] : []),
      this.prisma.profile.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      // Automation log rows stay (they are the rules' "already done" markers) but no longer point at the person.
      this.prisma.automationFiring.updateMany({ where: { userId }, data: { userId: null } }),
      this.prisma.eventRegistration.deleteMany({ where: { userId } }),
      this.prisma.eventReminderLog.deleteMany({ where: { userId } }),
      this.prisma.eventConfirmation.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.calendarFeed.deleteMany({ where: { userId } }),
      this.prisma.courseInterest.deleteMany({ where: { OR: [{ userId }, { email: user.email.toLowerCase() }] } }),
      // Every invite for the address goes, including the one they enrolled through (the audit log keeps ids only).
      this.prisma.courseInvite.deleteMany({ where: { OR: [{ enrolledUserId: userId }, { email: user.email.toLowerCase() }] } }),
      this.prisma.sessionFeedback.updateMany({ where: { userId }, data: { comment: null } }),
      // The speaker application (phone, bio, …) goes; the public speaker profile is the team's
      // page about past sessions and stays, but no longer points at this account.
      this.prisma.speakerApplication.deleteMany({ where: { userId } }),
      this.prisma.speakingSlot.updateMany({ where: { bookedById: userId }, data: { abstract: null, details: Prisma.DbNull } }),
      // A profile the portal created that never spoke anywhere has no history to keep: delete it.
      this.prisma.instructor.deleteMany({
        where: { userId, source: 'speaker-portal', events: { none: {} }, coSpeaking: { none: {} }, courses: { none: {} }, consultant: { is: null } },
      }),
      this.prisma.instructor.updateMany({ where: { userId }, data: { userId: null } }),
      // Grades stay (course statistics); links, files and notes go.
      this.prisma.submission.updateMany({ where: { userId }, data: { url: null, note: null, fileKey: null, fileName: null, feedback: null, rubricNotes: null } }),
      this.prisma.assessmentReminderLog.deleteMany({ where: { userId } }),
      // Consultation bookings stay for accounting (price, time, status); what they wrote and the payment proof go.
      this.prisma.consultationBooking.updateMany({
        where: { studentId: userId },
        data: { note: '', cancelReason: null, transactionRef: '', screenshotKey: null, screenshotSha256: null, screenshotDeletedAt: new Date() },
      }),
      // Points, badges and leaderboard choices are personal: removed (boards never showed deleted accounts).
      this.prisma.pointsEntry.deleteMany({ where: { userId } }),
      // Attendance (minutes per session) is personal too; course counts never included deleted accounts.
      this.prisma.sessionAttendance.deleteMany({ where: { userId } }),
      this.prisma.userBadge.deleteMany({ where: { userId } }),
      this.prisma.leaderboardOptIn.deleteMany({ where: { userId } }),
      // Certificates stay on record (serial, course, dates: the public page says "no longer
      // available"); the printed name and the PDF go.
      this.prisma.certificate.updateMany({ where: { enrollment: { userId } }, data: { nameOnCertificate: '', nameOnCertificateAr: null, pdfKey: null, revokeReason: null } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@anonymised.invalid`,
          pendingEmail: null,
          passwordHash: null,
          googleId: null,
          anonymizedAt: new Date(),
        },
      }),
    ]);
    await this.audit.log({ actorId: null, action: 'account.anonymised', entityType: 'User', entityId: userId });
  }

  async anonymizeDue(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ANONYMIZE_AFTER_DAYS * 86_400_000);
    const due = await this.prisma.user.findMany({
      where: { deletedAt: { lte: cutoff }, anonymizedAt: null },
      select: { id: true },
      // Oldest first, so one account that keeps failing can't starve the rest forever.
      orderBy: { deletedAt: 'asc' },
      take: 200,
    });
    for (const { id } of due) {
      try {
        await this.anonymize(id);
      } catch (err) {
        this.logger.error(`Anonymisation failed for a user: ${(err as Error).message}`);
      }
    }
    return due.length;
  }
}
