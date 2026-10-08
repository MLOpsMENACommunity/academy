import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../common/crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Two tabs refreshing at once: the loser sees a just-rotated token. Not treated as theft. */
const CONCURRENT_REFRESH_GRACE_MS = 15_000;

/** How a login authenticated; carried through refresh so re-auth checks are per session. */
export interface SessionInfo {
  amr: 'pwd' | 'google';
  authTime: Date;
}

export interface AccessPayload {
  sub: string;
  role: User['role'];
  /** User.tokenVersion at issue time. */
  tv: number;
  /** Auth time (epoch seconds) and method of the login this token descends from. */
  at: number;
  amr: SessionInfo['amr'];
}

export type RotateResult =
  | { ok: true; user: User; refreshToken: string; session: SessionInfo }
  | { ok: false; reason: 'invalid' | 'reused' | 'concurrent' };

/**
 * Access tokens: short-lived JWTs carrying the user's token version, so bumping
 * the version invalidates them immediately (checked by AuthGuard). Refresh
 * tokens: opaque random strings stored hashed, rotated on every use; reusing a
 * rotated token revokes the whole family and all sessions.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  signAccess(
    user: Pick<User, 'id' | 'role' | 'tokenVersion'>,
    session: SessionInfo = { amr: 'pwd', authTime: new Date() },
  ): Promise<string> {
    const payload: AccessPayload = {
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
      at: Math.floor(session.authTime.getTime() / 1000),
      amr: session.amr,
    };
    return this.jwt.signAsync(payload);
  }

  async issueRefresh(
    userId: string,
    userAgent: string | undefined,
    session: SessionInfo,
    family: string = randomUUID(),
  ): Promise<string> {
    const token = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        family,
        tokenHash: sha256(token),
        authMethod: session.amr,
        authTime: session.authTime,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: userAgent?.slice(0, 200),
      },
    });
    return token;
  }

  async rotate(token: string, userAgent?: string): Promise<RotateResult> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!existing || existing.expiresAt < new Date() || existing.revokedAt || existing.user.deletedAt) {
      return { ok: false, reason: 'invalid' };
    }
    if (existing.rotatedAt) {
      if (Date.now() - existing.rotatedAt.getTime() < CONCURRENT_REFRESH_GRACE_MS) {
        return { ok: false, reason: 'concurrent' };
      }
      // An old token came back after it was replaced: assume it was stolen and end every session.
      // Logged (no PII) so real theft can be told apart from flaky-network noise.
      this.logger.warn(`Refresh token reuse detected; revoked all sessions for family ${existing.family.slice(0, 8)}`);
      await this.revokeAllForUser(existing.userId);
      return { ok: false, reason: 'reused' };
    }

    // Atomic claim: only one request can rotate a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, reason: 'concurrent' };

    const session: SessionInfo = {
      amr: existing.authMethod === 'google' ? 'google' : 'pwd',
      authTime: existing.authTime,
    };
    const refreshToken = await this.issueRefresh(existing.userId, userAgent, session, existing.family);
    return { ok: true, user: existing.user, refreshToken, session };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Ends every session immediately: revokes refresh tokens and bumps the token
   * version so already-issued access tokens stop working on the next request.
   */
  async revokeAllForUser(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }
}
