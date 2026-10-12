import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasAdminPermission, type AdminPermission, type Role } from '@academy/shared';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { AccessPayload } from '../auth/tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_CAN_KEY, IS_PUBLIC, ROLES_KEY, type AuthedRequest } from './decorators';

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * The access token's signature is not enough: its token version must match the
 * user's current one (bumped on password change, account claim, deletion
 * and token theft), so revoked sessions stop working immediately. Role and admin
 * permissions come from the database, not the token, so a change applies on the next request.
 *
 * Admin routes: an ADMIN also needs one of the route's @AdminCan presets (or SUPER). A route
 * open to ADMIN without @AdminCan is SUPER-only.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token === 'string' && token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessPayload>(token);
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { role: true, adminPermissions: true, tokenVersion: true, deletedAt: true },
        });
        if (user && !user.deletedAt && user.tokenVersion === payload.tv) {
          req.user = {
            id: payload.sub,
            role: user.role,
            adminPermissions: user.role === 'ADMIN' ? user.adminPermissions : [],
            amr: payload.amr === 'google' ? 'google' : 'pwd',
            authTime: new Date((payload.at ?? 0) * 1000),
          };
        }
      } catch {
        // Expired or invalid: public routes continue anonymously.
      }
    }

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException();
    if (req.user.role === 'ADMIN' && roles?.includes('ADMIN')) {
      const allowed = this.reflector.getAllAndOverride<AdminPermission[] | undefined>(ADMIN_CAN_KEY, targets) ?? [];
      if (!hasAdminPermission(req.user, allowed)) {
        throw new ForbiddenException({ code: 'ADMIN_PERMISSION', message: "Your admin account doesn't have access to this" });
      }
    }
    return true;
  }
}
