import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyPassword } from '../auth/password-hasher';
import type { Locale } from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../common/decorators';
import { TokensService } from '../auth/tokens.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpeakerPortalService } from '../speaker-portal/speaker-portal.service';
import { ProfileService, toProfileDto } from './profile.service';

export const ANONYMIZE_AFTER_DAYS = 30;
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
        enrollments: { include: { course: { select: { slug: true, titleEn: true } } } },
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
    const [points, badges, leaderboards] = await Promise.all([
      this.prisma.pointsEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { points: true, reason: true, note: true, createdAt: true, course: { select: { slug: true, titleEn: true } } },
      }),
      this.prisma.userBadge.findMany({
        where: { userId },
        orderBy: { awardedAt: 'asc' },
        select: { awardedAt: true, period: true, reason: true, badge: { select: { code: true, nameEn: true } }, course: { select: { slug: true, titleEn: true } } },
      }),
      this.prisma.leaderboardOptIn.findMany({ where: { userId }, select: { optedIn: true, updatedAt: true, course: { select: { slug: true, titleEn: true } } } }),
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
      sessionProgress: user.sessionProgress,
      feedback: user.sessionFeedback,
      reminderPreferences: user.reminderPreferences,
      calendarFeed: user.calendarFeed,
      notifications: user.notifications,
      liveSessionRegistrations: user.eventRegistrations.map((r) => ({ session: r.event, registeredAt: r.createdAt })),
      speakerApplication: user.speakerApplication,
      speakerProfile: user.speakerProfile,
      speakerBookings: user.speakingSlots,
      // Quizzes, labs and assignments: answers, links, grades and feedback (uploaded PDFs by name only).
      assessmentSubmissions: user.submissions.map(({ assessment, ...s }) => ({ assessment: assessment.titleEn, type: assessment.type, course: assessment.course.slug, ...s })),
      waitingLists: waitingLists.map((w) => ({ course: w.course, email: w.email, language: w.locale, joinedAt: w.createdAt, notifiedAt: w.notifiedAt })),
      points: { total: points.reduce((n, p) => n + p.points, 0), entries: points },
      badges: badges.map((b) => ({ badge: b.badge, course: b.course, week: b.period, reason: b.reason, awardedAt: b.awardedAt })),
      leaderboards: leaderboards.map((l) => ({ course: l.course, shownOnLeaderboard: l.optedIn, changedAt: l.updatedAt })),
    };
  }

  /** Soft delete: sign-in is blocked now; personal data is anonymised after 30 days. */
  async deleteAccount(session: AuthUser, password: string | undefined): Promise<void> {
    await this.checkPassword(session, password);
    const userId = session.id;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
      include: { profile: { select: { googleEmail: true } } },
    });
    await this.tokens.revokeAllForUser(userId);
    // Free their seats in live sessions that haven't started (past ones stay until anonymisation).
    await this.prisma.eventRegistration.deleteMany({ where: { userId, event: { startsAt: { gt: new Date() } } } });
    // The private calendar link stops working at once (calendar apps poll without signing in).
    await this.prisma.calendarFeed.deleteMany({ where: { userId } });
    // Off every leaderboard at once (boards also skip deleted accounts).
    await this.prisma.leaderboardOptIn.deleteMany({ where: { userId } });
    // Off every waiting list: nobody should email a deleted account about new courses.
    await this.prisma.courseInterest.deleteMany({ where: { OR: [{ userId }, { email: user.email.toLowerCase() }] } });
    // Upcoming speaker bookings: the slot opens again, a draft session goes (a published one is
    // cancelled), the team is told. Never fails the deletion (errors are logged).
    await this.speakerPortal.releaseBookings(user);
    await this.profiles.alertDriveAccess(userId, 'deleted', user.profile?.googleEmail ?? null);
    await this.audit.log({ actorId: userId, action: 'account.deleted', entityType: 'User', entityId: userId });
    await this.email.send(user.email, user.locale, { name: 'accountDeleted' });
  }

  /**
   * Irreversibly removes personal data from a deleted account. Payment records
   * stay (amount, method, reference, dates, decision) for accounting, with the
   * sender's name and phone removed and screenshots deleted.
   */
  async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true, applications: { include: { payments: true } }, submissions: { select: { fileKey: true } } },
    });
    const keys = [
      user.profile?.cvKey,
      ...user.applications.flatMap((a) => a.payments.map((p) => p.screenshotKey)),
      ...user.submissions.map((s) => s.fileKey),
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
      this.prisma.profile.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.eventRegistration.deleteMany({ where: { userId } }),
      this.prisma.eventReminderLog.deleteMany({ where: { userId } }),
      this.prisma.eventConfirmation.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.calendarFeed.deleteMany({ where: { userId } }),
      this.prisma.courseInterest.deleteMany({ where: { OR: [{ userId }, { email: user.email.toLowerCase() }] } }),
      this.prisma.sessionFeedback.updateMany({ where: { userId }, data: { comment: null } }),
      // The speaker application (phone, bio, …) goes; the public speaker profile is the team's
      // page about past sessions and stays, but no longer points at this account.
      this.prisma.speakerApplication.deleteMany({ where: { userId } }),
      this.prisma.speakingSlot.updateMany({ where: { bookedById: userId }, data: { abstract: null } }),
      // A profile the portal created that never spoke anywhere has no history to keep: delete it.
      this.prisma.instructor.deleteMany({
        where: { userId, source: 'speaker-portal', events: { none: {} }, coSpeaking: { none: {} }, courses: { none: {} } },
      }),
      this.prisma.instructor.updateMany({ where: { userId }, data: { userId: null } }),
      // Grades stay (course statistics); links, files and notes go.
      this.prisma.submission.updateMany({ where: { userId }, data: { url: null, note: null, fileKey: null, fileName: null, feedback: null, rubricNotes: null } }),
      this.prisma.assessmentReminderLog.deleteMany({ where: { userId } }),
      // Points, badges and leaderboard choices are personal: removed (boards never showed deleted accounts).
      this.prisma.pointsEntry.deleteMany({ where: { userId } }),
      this.prisma.userBadge.deleteMany({ where: { userId } }),
      this.prisma.leaderboardOptIn.deleteMany({ where: { userId } }),
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
