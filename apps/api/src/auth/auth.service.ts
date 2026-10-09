import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { User } from '@prisma/client';
import { safeReturnTo, type Locale, type LoginInput, type MeResponse, type RegisterInput } from '@academy/shared';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { randomToken, sha256 } from '../common/crypto';
import { EmailService } from '../email/email.service';
import { courseSlugFromPath, FunnelService } from '../funnel/funnel.service';
import { PrismaService } from '../prisma/prisma.service';
import type { GoogleIdentity } from './google.service';
import { FailureLimiter } from './failure-limiter';
import { TokensService } from './tokens.service';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  /** Per-account brute-force protection, on top of the per-IP throttle. */
  private readonly loginLimiter = new FailureLimiter(10, 15 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly email: EmailService,
    private readonly funnel: FunnelService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return hash(password);
  }

  async register(input: RegisterInput): Promise<User> {
    // Deliberate trade-off: telling people their email already has an account is
    // worth more to students than hiding it. Login and reset don't reveal it.
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await this.hashPassword(input.password),
        locale: input.locale,
        profile: { create: { preferredLanguage: input.locale } },
      },
    });
    const returnTo = input.returnTo ? safeReturnTo(input.returnTo) : null;
    await this.sendVerification(user, returnTo);
    const slug = courseSlugFromPath(returnTo);
    if (slug) await this.funnel.record({ slug }, 'REGISTERED', { userId: user.id });
    return user;
  }

  async login(input: LoginInput): Promise<User> {
    this.loginLimiter.check(input.email);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Same error for unknown email, wrong password and deleted accounts.
    const fail = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    if (!user || user.deletedAt) {
      this.loginLimiter.fail(input.email);
      throw fail;
    }
    // Google-only accounts get the same error; the login page hints at Google sign-in.
    if (!user.passwordHash || !(await verify(user.passwordHash, input.password))) {
      this.loginLimiter.fail(input.email);
      throw fail;
    }
    this.loginLimiter.reset(input.email);
    return this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  }

  async loginWithGoogle(g: GoogleIdentity, locale: Locale): Promise<{ user: User; isNew: boolean }> {
    // An unverified Google address proves nothing about who owns the inbox.
    if (!g.emailVerified) throw new UnauthorizedException('Google email is not verified');
    const byGoogle = await this.prisma.user.findUnique({ where: { googleId: g.sub } });
    if (byGoogle) {
      if (byGoogle.deletedAt) throw new UnauthorizedException('Account deleted');
      return { user: await this.touch(byGoogle.id), isNew: false };
    }
    const byEmail = await this.prisma.user.findUnique({ where: { email: g.email } });
    if (byEmail) {
      if (byEmail.deletedAt) throw new UnauthorizedException('Account deleted');
      const wasVerified = Boolean(byEmail.emailVerifiedAt);
      let staleCvKey: string | null = null;
      // Google has proven who owns this inbox. If the account was never verified,
      // whoever registered it may not be the owner (pre-registration takeover):
      // drop their password, sessions and outstanding links before linking.
      const user = await this.prisma.$transaction(async (tx) => {
        if (!wasVerified) {
          // Ends the pre-registrant's sessions, including issued access tokens.
          await this.tokens.revokeAllForUser(byEmail.id, tx);
          await tx.emailVerificationToken.deleteMany({ where: { userId: byEmail.id } });
          await tx.passwordResetToken.deleteMany({ where: { userId: byEmail.id } });
          // Their profile (phone, Google address, CV) is not the owner's: start fresh.
          const old = await tx.profile.findUnique({ where: { userId: byEmail.id }, select: { cvKey: true } });
          if (old?.cvKey) staleCvKey = old.cvKey;
          await tx.profile.deleteMany({ where: { userId: byEmail.id } });
          await tx.profile.create({
            data: { userId: byEmail.id, fullNameEn: g.name, googleEmail: g.email, preferredLanguage: locale },
          });
        }
        return tx.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: g.sub,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            lastLoginAt: new Date(),
            ...(wasVerified ? {} : { passwordHash: null, pendingEmail: null }),
          },
        });
      });
      if (!wasVerified) {
        await this.audit.log({ actorId: user.id, action: 'auth.google_claimed_unverified_account', entityType: 'User', entityId: user.id });
        if (staleCvKey) await this.storage.delete(staleCvKey).catch(() => undefined);
      }
      await this.prisma.profile.updateMany({
        where: { userId: user.id, googleEmail: null },
        data: { googleEmail: g.email },
      });
      return { user, isNew: false };
    }
    const user = await this.prisma.user.create({
      data: {
        email: g.email,
        googleId: g.sub,
        emailVerifiedAt: new Date(),
        locale,
        lastLoginAt: new Date(),
        profile: { create: { fullNameEn: g.name, googleEmail: g.email, preferredLanguage: locale } },
      },
    });
    return { user, isNew: true };
  }

  private touch(id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  // ------------------------------------------------------------------ email verification

  /** Always to the login email: verifyEmail refuses links sent to any other address. */
  private async sendVerification(user: User, returnTo: string | null): Promise<void> {
    const address = user.email;
    const token = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        email: address,
        tokenHash: sha256(token),
        returnTo,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    });
    const url = this.email.url(user.locale, `/verify-email?token=${token}`);
    await this.email.send(address, user.locale, { name: 'verifyEmail', url });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    // Rate-limit per user: at most one email per minute.
    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent) return;
    await this.sendVerification(user, null);
  }

  async verifyEmail(token: string, sessionUserId: string): Promise<{ returnTo: string | null; user: User }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.deletedAt) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'This link is invalid or has expired' });
    }
    if (record.userId !== sessionUserId) {
      throw new ForbiddenException({ code: 'WRONG_ACCOUNT', message: 'Sign in to the account this link was sent for' });
    }
    const { user } = record;
    // Only a link sent to the current login email verifies anything. Students can no
    // longer change their login email, so a link sent for a pending change before
    // that was removed must not change it now.
    if (record.email !== user.email) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'This link is no longer valid' });
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    await this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return { returnTo: record.returnTo, user: updated };
  }

  // ------------------------------------------------------------------ password reset

  async forgotPassword(email: string, locale: Locale): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return; // never reveal whether an account exists
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const lang = user.locale ?? locale;
    // Not awaited: response time must not reveal whether the account exists.
    void this.email.send(user.email, lang, {
      name: 'resetPassword',
      url: this.email.url(lang, `/reset-password?token=${token}`),
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.deletedAt) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'This link is invalid or has expired' });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Receiving the reset email proves control of the address.
        data: { passwordHash: await this.hashPassword(password), emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() },
      }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    await this.tokens.revokeAllForUser(record.userId);
    // The lockout message tells people to reset their password, so a reset unlocks.
    this.loginLimiter.reset(record.user.email);
  }

  // ------------------------------------------------------------------ me

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
    if (user.deletedAt) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale,
      emailVerified: Boolean(user.emailVerifiedAt),
      hasPassword: Boolean(user.passwordHash),
      hasGoogle: Boolean(user.googleId),
      name: user.profile?.fullNameEn ?? null,
      profile: {
        completeness: user.profile?.completeness ?? 0,
        coreComplete: Boolean(user.profile?.coreCompletedAt),
        updatedAt: user.profile?.updatedAt.toISOString() ?? null,
      },
    };
  }
}
