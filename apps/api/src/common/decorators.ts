import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminPermission, Role } from '@academy/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: Role;
  /** ADMIN accounts: what they may do, read from the database on every request. Empty otherwise. */
  adminPermissions?: AdminPermission[];
  /** How and when the current session authenticated (for re-auth checks). */
  amr: 'pwd' | 'google';
  authTime: Date;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
/** Route needs no authentication (a valid session is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ADMIN_CAN_KEY = 'adminCan';
/**
 * Which admin presets may use an admin route (any one is enough; SUPER always may). Required on
 * every route open to ADMIN: an admin route without it is SUPER-only (default deny), and a unit
 * test (admin-permissions.spec.ts) fails when one is missing. A method's tag replaces its class's.
 */
export const AdminCan = (...permissions: [AdminPermission, ...AdminPermission[]]) => SetMetadata(ADMIN_CAN_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
