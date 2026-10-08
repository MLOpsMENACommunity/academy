import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@academy/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
/** Route needs no authentication (a valid session is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
