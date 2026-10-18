import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { AdminPermission, Role } from '@academy/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from './auth.guard';
import { AdminCan, Public, Roles } from './decorators';
import { SignedInCache } from './signed-in-cache';

class Routes {
  @Roles('ADMIN')
  untagged() {}

  @Roles('ADMIN')
  @AdminCan('ACADEMIC')
  academic() {}

  @Roles('ADMIN')
  @AdminCan('CONTENT', 'ACADEMIC')
  media() {}

  @Roles('STUDENT', 'ADMIN')
  @AdminCan('FINANCE')
  mixed() {}

  any() {}

  @Public()
  open() {}
}

@Roles('ADMIN')
@AdminCan('ADMISSIONS')
class Tagged {
  inherits() {}

  @AdminCan('FINANCE')
  overrides() {}
}

function guardFor(user: { role: Role; adminPermissions: AdminPermission[]; tokenVersion?: number; deletedAt?: Date | null } | null) {
  const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', tv: 0, amr: 'pwd', at: 1 }) } as unknown as JwtService;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user ? { tokenVersion: 0, deletedAt: null, ...user } : null) },
  } as unknown as PrismaService;
  return { guard: new AuthGuard(jwt, new Reflector(), prisma, new SignedInCache({ SIGNED_IN_CACHE_TTL_S: 0 })), prisma };
}

function ctx(cls: object, method: string, cookie = 'token'): { context: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { cookies: cookie ? { access_token: cookie } : {} };
  const proto = (cls as { prototype: Record<string, unknown> }).prototype;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => proto[method],
    getClass: () => cls,
  } as unknown as ExecutionContext;
  return { context, req };
}

const run = async (user: Parameters<typeof guardFor>[0], cls: object, method: string) => {
  const { guard } = guardFor(user);
  const { context, req } = ctx(cls, method);
  const ok = await guard.canActivate(context).catch((e: unknown) => e);
  return { ok, req };
};

describe('AuthGuard admin permissions', () => {
  it('lets a super admin through everywhere, including untagged admin routes', async () => {
    for (const m of ['untagged', 'academic', 'media', 'mixed', 'any']) {
      expect((await run({ role: 'ADMIN', adminPermissions: ['SUPER'] }, Routes, m)).ok).toBe(true);
    }
  });

  it('treats an admin route without @AdminCan as super-only (default deny)', async () => {
    const { ok } = await run({ role: 'ADMIN', adminPermissions: ['ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] }, Routes, 'untagged');
    expect(ok).toBeInstanceOf(ForbiddenException);
  });

  it('needs one of the listed presets', async () => {
    expect((await run({ role: 'ADMIN', adminPermissions: ['ACADEMIC'] }, Routes, 'academic')).ok).toBe(true);
    expect((await run({ role: 'ADMIN', adminPermissions: ['CONTENT'] }, Routes, 'academic')).ok).toBeInstanceOf(ForbiddenException);
    expect((await run({ role: 'ADMIN', adminPermissions: ['CONTENT'] }, Routes, 'media')).ok).toBe(true);
    expect((await run({ role: 'ADMIN', adminPermissions: ['FINANCE'] }, Routes, 'media')).ok).toBeInstanceOf(ForbiddenException);
  });

  it('denies an admin with no presets on every admin route', async () => {
    for (const m of ['untagged', 'academic', 'media', 'mixed']) {
      expect((await run({ role: 'ADMIN', adminPermissions: [] }, Routes, m)).ok).toBeInstanceOf(ForbiddenException);
    }
  });

  it('uses the method tag over the class tag', async () => {
    expect((await run({ role: 'ADMIN', adminPermissions: ['ADMISSIONS'] }, Tagged, 'inherits')).ok).toBe(true);
    expect((await run({ role: 'ADMIN', adminPermissions: ['ADMISSIONS'] }, Tagged, 'overrides')).ok).toBeInstanceOf(ForbiddenException);
    expect((await run({ role: 'ADMIN', adminPermissions: ['FINANCE'] }, Tagged, 'overrides')).ok).toBe(true);
  });

  it('does not apply admin presets to other roles or to routes not limited to admins', async () => {
    expect((await run({ role: 'STUDENT', adminPermissions: [] }, Routes, 'mixed')).ok).toBe(true);
    expect((await run({ role: 'STUDENT', adminPermissions: [] }, Routes, 'academic')).ok).toBeInstanceOf(ForbiddenException);
    expect((await run({ role: 'ADMIN', adminPermissions: ['CONTENT'] }, Routes, 'any')).ok).toBe(true);
    expect((await run({ role: 'ADMIN', adminPermissions: [] }, Routes, 'open')).ok).toBe(true);
  });

  it('ignores stray presets on a non-admin account', async () => {
    const { ok, req } = await run({ role: 'STUDENT', adminPermissions: ['SUPER'] }, Routes, 'any');
    expect(ok).toBe(true);
    expect((req.user as { adminPermissions: AdminPermission[] }).adminPermissions).toEqual([]);
  });

  it('reads presets from the database on every request (no stale token claims)', async () => {
    const { guard, prisma } = guardFor({ role: 'ADMIN', adminPermissions: ['ACADEMIC'] });
    expect(await guard.canActivate(ctx(Routes, 'academic').context)).toBe(true);
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'ADMIN', adminPermissions: ['CONTENT'], tokenVersion: 0, deletedAt: null });
    await expect(guard.canActivate(ctx(Routes, 'academic').context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ adminPermissions: true }) }));
  });
});

describe('AuthGuard with the signed-in cache', () => {
  function cachedGuard() {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', tv: 0, amr: 'pwd', at: 1 }) } as unknown as JwtService;
    const findUnique = jest.fn().mockResolvedValue({ role: 'STUDENT', adminPermissions: [], tokenVersion: 0, deletedAt: null });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    return { guard: new AuthGuard(jwt, new Reflector(), prisma, new SignedInCache({ SIGNED_IN_CACHE_TTL_S: 15 })), findUnique };
  }
  const call = (guard: AuthGuard, method: string) => {
    const { context, req } = ctx(Routes, 'any');
    req.method = method;
    return guard.canActivate(context);
  };

  it('reuses the account check on reads', async () => {
    const { guard, findUnique } = cachedGuard();
    await call(guard, 'GET');
    await call(guard, 'GET');
    await call(guard, 'HEAD');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('always asks the database on writes', async () => {
    const { guard, findUnique } = cachedGuard();
    await call(guard, 'GET');
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) await call(guard, m);
    expect(findUnique).toHaveBeenCalledTimes(5);
  });

  it('asks again when the token is newer than the cached account', async () => {
    const { guard, findUnique } = cachedGuard();
    findUnique.mockResolvedValueOnce({ role: 'STUDENT', adminPermissions: [], tokenVersion: -1, deletedAt: null });
    expect(await call(guard, 'GET')).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
