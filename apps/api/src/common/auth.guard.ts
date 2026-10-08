import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@academy/shared';
import { ACCESS_COOKIE } from '../auth/cookies';
import { IS_PUBLIC, ROLES_KEY, type AuthedRequest } from './decorators';

interface AccessPayload {
  sub: string;
  role: Role;
}

/**
 * Global guard: every route requires a valid access token unless marked
 * @Public(). @Roles(...) additionally restricts by role.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token === 'string' && token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessPayload>(token);
        req.user = { id: payload.sub, role: payload.role };
      } catch {
        // Expired or invalid: public routes continue anonymously.
      }
    }

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException();
    return true;
  }
}
