import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SpeakerAccountDto, SpeakerAccountInput, SpeakerAccountResultDto } from '@academy/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { linkProfileStaffToAccount } from '../course-staff/staff-sync';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../users/account.service';
import { SPEAKER_ACCOUNT_SELECT, toSpeakerAccount } from './speaker-account';

/**
 * Admin → Speakers → {speaker} → Account: the team gives a public speaker profile (e.g. one from
 * the archive) a login, without the speaker filling in the speaker application. The account then
 * teaches every course the profile is on (its staff rows act as the account). It isn't approved to
 * book speaking slots: that still goes through the application.
 */
@Injectable()
export class SpeakerAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly notifications: NotificationsService,
  ) {}

  /** A new address gets a speaker account and an invitation; an existing, confirmed account is linked. */
  async invite(instructorId: string, input: SpeakerAccountInput, actorId: string): Promise<SpeakerAccountResultDto> {
    const profile = await this.prisma.instructor.findUnique({ where: { id: instructorId }, select: { id: true, name: true, user: { select: { deletedAt: true } } } });
    if (!profile) throw new NotFoundException('Instructor not found');
    if (profile.user && !profile.user.deletedAt) throw new ConflictException({ code: 'PROFILE_HAS_ACCOUNT', message: 'This speaker profile already has an account: unlink it first' });

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: input.email, mode: 'insensitive' } },
      select: { id: true, role: true, deletedAt: true, emailVerifiedAt: true, speakerProfile: { select: { id: true } } },
    });
    if (!existing) {
      let created: { id: string };
      try {
        created = await this.accounts.createByAdmin({ email: input.email, locale: input.locale, fullNameEn: profile.name }, actorId, { role: 'SPEAKER' });
      } catch (err) {
        // Someone registered the address a moment ago: invite it again to link that account.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email was just created: try again' });
        }
        throw err;
      }
      await this.link(instructorId, created.id, actorId, { invited: true });
      return { outcome: 'invited', account: await this.account(created.id) };
    }

    if (existing.deletedAt) throw new ConflictException({ code: 'ACCOUNT_DELETED', message: 'This address belongs to a deleted account' });
    if (existing.speakerProfile) throw new ConflictException({ code: 'ACCOUNT_HAS_PROFILE', message: 'This account already has another speaker profile' });
    // Anyone can register any address: only an account that proved it owns the address may take
    // over a speaker's page and courses (as with adding an admin).
    if (!existing.emailVerifiedAt) {
      throw new ConflictException({ code: 'EMAIL_UNVERIFIED', message: "This account hasn't confirmed its email address yet: ask them to, then add them again" });
    }
    // A student becomes a speaker (keeping their applications and enrolments); an admin stays an admin.
    await this.link(instructorId, existing.id, actorId, { invited: false, from: existing.role === 'STUDENT' ? 'STUDENT' : undefined });
    await this.notifications.create(existing.id, {
      type: 'speaker.linked',
      titleEn: 'Your speaker page is linked to your account',
      titleAr: 'رُبطت صفحتك كمتحدث بحسابك',
      bodyEn: 'The academy team linked your account to your speaker page. Your courses are under Teaching.',
      bodyAr: 'ربط فريق الأكاديمية حسابك بصفحتك كمتحدث. تجد دوراتك في قسم التدريس.',
      link: '/teach',
    });
    return { outcome: 'linked', account: await this.account(existing.id) };
  }

  /**
   * The profile no longer belongs to the account (e.g. the wrong one was linked): the account
   * stops teaching the profile's courses, which keep showing the profile. Like deleting a profile,
   * an approved application goes back to "Under review".
   */
  async unlink(instructorId: string, actorId: string): Promise<void> {
    const profile = await this.prisma.instructor.findUnique({ where: { id: instructorId }, select: { userId: true } });
    if (!profile) throw new NotFoundException('Instructor not found');
    const userId = profile.userId;
    if (!userId) return;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.instructor.updateMany({ where: { id: instructorId, userId }, data: { userId: null } });
      if (!r.count) throw new ConflictException({ code: 'PROFILE_CHANGED', message: 'This speaker profile just changed: reload and try again' });
      await tx.courseStaff.updateMany({ where: { instructorId, userId }, data: { userId: null } });
      await tx.speakerApplication.updateMany({ where: { userId, status: 'APPROVED' }, data: { status: 'SUBMITTED', reviewedAt: null, reviewedById: null } });
      await this.audit.log({ actorId, action: 'instructor.account_unlinked', entityType: 'Instructor', entityId: instructorId, metadata: { userId } }, tx);
    });
  }

  private async link(instructorId: string, userId: string, actorId: string, how: { invited: boolean; from?: 'STUDENT' }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Only while the profile is still free (or held by a deleted account): a concurrent link wins.
      const linked = await tx.instructor.updateMany({
        where: { id: instructorId, OR: [{ userId: null }, { user: { deletedAt: { not: null } } }] },
        data: { userId },
      });
      if (linked.count !== 1) throw new ConflictException({ code: 'PROFILE_HAS_ACCOUNT', message: 'This speaker profile already has an account: unlink it first' });
      if (how.from) {
        const switched = await tx.user.updateMany({ where: { id: userId, role: how.from, deletedAt: null }, data: { role: 'SPEAKER' } });
        if (!switched.count) throw new ConflictException({ code: 'PROFILE_CHANGED', message: 'This account just changed: reload and try again' });
        await this.audit.log({ actorId, action: 'user.role_changed', entityType: 'User', entityId: userId, metadata: { from: how.from, to: 'SPEAKER' } }, tx);
      }
      // Courses already showing this profile: the account now teaches them in that role.
      await linkProfileStaffToAccount(tx, instructorId, userId);
      await this.audit.log({ actorId, action: 'instructor.account_linked', entityType: 'Instructor', entityId: instructorId, metadata: { userId, invited: how.invited } }, tx);
    });
  }

  private async account(id: string): Promise<SpeakerAccountDto> {
    return toSpeakerAccount(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: SPEAKER_ACCOUNT_SELECT }));
  }
}
