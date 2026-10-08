import { ConflictException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { User } from '@prisma/client';
import { safeReturnTo, type Locale, type LoginInput, type MeResponse, type RegisterInput } from '@academy/shared';
import { randomToken, sha256 } from '../common/crypto';
import { EmailService } from '../email/email.service';
import { courseSlugFromPath, FunnelService } from '../funnel/funnel.service';
import { PrismaService } from '../prisma/prisma.service';
import type { GoogleIdentity } from './google.service';
import { TokensService } from './tokens.service';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly email: EmailService,
    private readonly funnel: FunnelService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return hash(password);
  }

  async register(input: RegisterInput): Promise<User> {
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
    await this.sendVerification(user, user.email, returnTo);
    const slug = courseSlugFromPath(returnTo);
    if (slug) await this.funnel.record({ slug }, 'REGISTERED', { userId: user.id });
    return user;
  }

  async login(input: LoginInput): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Same error for unknown email, wrong password and deleted accounts.
    const fail = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    if (!user || user.deletedAt) throw fail;
    if (!user.passwordHash) {
      throw new UnauthorizedException({ code: 'USE_GOOGLE', message: 'This account signs in with Google' });
    }
    if (!(await verify(user.passwordHash, input.password))) throw fail;
    return this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  }

  async loginWithGoogle(g: GoogleIdentity, locale: Locale): Promise<{ user: User; isNew: boolean }> {
    const byGoogle = await this.prisma.user.findUnique({ where: { googleId: g.sub } });
    if (byGoogle) {
      if (byGoogle.deletedAt) throw new UnauthorizedException('Account deleted');
      return { user: await this.touch(byGoogle.id), isNew: false };
    }
    const byEmail = await this.prisma.user.findUnique({ where: { email: g.email } });
    if (byEmail) {
      if (byEmail.deletedAt) throw new UnauthorizedException('Account deleted');
      // Only link when Google has verified the address; otherwise someone could claim an account.
      if (!g.emailVerified) throw new UnauthorizedException('Google email is not verified');
      const user = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: g.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(), lastLoginAt: new Date() },
      });
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
        emailVerifiedAt: g.emailVerified ? new Date() : null,
        locale,
        lastLoginAt: new Date(),
        profile: { create: { fullNameEn: g.name, googleEmail: g.email, preferredLanguage: locale } },
      },
    });
    if (!g.emailVerified) await this.sendVerification(user, user.email, null);
    return { user, isNew: true };
  }

  private touch(id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  // ------------------------------------------------------------------ email verification

  async sendVerification(user: User, address: string, returnTo: string | null): Promise<void> {
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
    const isChange = address !== user.email;
    const url = this.email.url(user.locale, `/verify-email?token=${token}`);
    await this.email.send(address, user.locale, { name: isChange ? 'confirmNewEmail' : 'verifyEmail', url });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt && !user.pendingEmail) return;
    // Rate-limit per user: at most one email per minute.
    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent) return;
    await this.sendVerification(user, user.pendingEmail ?? user.email, null);
  }

  async verifyEmail(token: string): Promise<{ returnTo: string | null; user: User }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.deletedAt) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'This link is invalid or has expired' });
    }
    const { user } = record;
    let updated: User;
    if (record.email === user.pendingEmail) {
      const taken = await this.prisma.user.findUnique({ where: { email: record.email } });
      if (taken && taken.id !== user.id) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'This email is already in use' });
      }
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { email: record.email, pendingEmail: null, emailVerifiedAt: new Date() },
      });
    } else if (record.email === user.email) {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      });
    } else {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'This link is no longer valid' });
    }
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
    await this.email.send(user.email, lang, {
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
  }

  // ------------------------------------------------------------------ me

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
    if (user.deletedAt) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      pendingEmail: user.pendingEmail,
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
