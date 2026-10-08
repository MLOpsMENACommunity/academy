import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../common/crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Two tabs refreshing at once: the loser sees a just-revoked token. Not treated as theft. */
const CONCURRENT_REFRESH_GRACE_MS = 15_000;

export type RotateResult =
  | { ok: true; user: User; refreshToken: string }
  | { ok: false; reason: 'invalid' | 'reused' | 'concurrent' };

/**
 * Access tokens: short-lived JWTs. Refresh tokens: opaque random strings stored
 * hashed, rotated on every use. Reusing an already-rotated token revokes the
 * whole login family (stolen-token detection).
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  signAccess(user: Pick<User, 'id' | 'role'>): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, role: user.role });
  }

  async issueRefresh(userId: string, userAgent?: string, family: string = randomUUID()): Promise<string> {
    const token = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        family,
        tokenHash: sha256(token),
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
      // An old token came back after it was replaced: assume it was stolen.
      await this.revokeFamily(existing.family);
      return { ok: false, reason: 'reused' };
    }

    // Atomic claim: only one request can rotate a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, reason: 'concurrent' };

    const refreshToken = await this.issueRefresh(existing.userId, userAgent, existing.family);
    return { ok: true, user: existing.user, refreshToken };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { family, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
