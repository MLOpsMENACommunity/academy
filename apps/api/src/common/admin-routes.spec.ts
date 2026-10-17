import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ADMIN_PERMISSIONS, type AdminPermission, type Role } from '@academy/shared';
import { ADMIN_CAN_KEY, IS_PUBLIC, ROLES_KEY } from './decorators';

/**
 * Every route open to ADMIN must say which admin presets may use it (@AdminCan). The guard
 * treats a missing tag as SUPER-only, so a forgotten tag fails closed; this test makes it fail
 * loudly too, and pins down the routes that must never open up to the wrong preset.
 */

interface Route {
  method: string;
  path: string;
  roles: Role[] | undefined;
  adminCan: AdminPermission[] | undefined;
  isPublic: boolean;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

function join2(a: string, b: string): string {
  return [a, b]
    .flatMap((x) => (x ?? '').split('/'))
    .filter(Boolean)
    .join('/');
}

function discover(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') continue;
      const cls = value as new (...args: never[]) => unknown;
      const base = Reflect.getMetadata(PATH_METADATA, cls) as string | string[] | undefined;
      if (base === undefined) continue;
      const prefix = Array.isArray(base) ? base[0]! : base;
      for (const key of Object.getOwnPropertyNames(cls.prototype)) {
        if (key === 'constructor') continue;
        const handler = (cls.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (sub === undefined || method === undefined) continue;
        const pick = <T>(k: string): T | undefined => (Reflect.getMetadata(k, handler) as T | undefined) ?? (Reflect.getMetadata(k, cls) as T | undefined);
        routes.push({
          method: RequestMethod[method],
          path: join2(prefix, Array.isArray(sub) ? sub[0]! : sub),
          roles: pick<Role[]>(ROLES_KEY),
          adminCan: pick<AdminPermission[]>(ADMIN_CAN_KEY),
          isPublic: Boolean(pick<boolean>(IS_PUBLIC)),
        });
      }
    }
  }
  return routes;
}

const routes = discover();
const find = (method: string, path: string): Route => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`No route ${method} ${path}`);
  return r;
};
/** Presets that may use a route (SUPER always may, so it is left out unless it is the only one). */
const presets = (method: string, path: string) => find(method, path).adminCan ?? [];

describe('admin routes', () => {
  it('finds the controllers', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.filter((r) => r.roles?.includes('ADMIN')).length).toBeGreaterThan(100);
  });

  it('every route open to ADMIN names its admin presets (@AdminCan)', () => {
    const missing = routes.filter((r) => r.roles?.includes('ADMIN') && !r.adminCan?.length).map((r) => `${r.method} /api/${r.path}`);
    expect(missing).toEqual([]);
  });

  it('@AdminCan only uses known presets', () => {
    const bad = routes.filter((r) => r.adminCan?.some((p) => !(ADMIN_PERMISSIONS as readonly string[]).includes(p)));
    expect(bad).toEqual([]);
  });

  it('every /api/admin/* route is admin-only and never public', () => {
    const open = routes
      .filter((r) => r.path === 'admin' || r.path.startsWith('admin/'))
      .filter((r) => r.isPublic || r.roles?.length !== 1 || r.roles[0] !== 'ADMIN')
      .map((r) => `${r.method} /api/${r.path}`);
    expect(open).toEqual([]);
  });

  it('keeps the team, settings and the audit log for super admins', () => {
    for (const [m, p] of [
      ['GET', 'admin/team'],
      ['POST', 'admin/team'],
      ['PUT', 'admin/team/:id'],
      ['POST', 'admin/team/:id/remove'],
      ['GET', 'admin/settings'],
      ['PUT', 'admin/settings'],
      ['GET', 'admin/audit'],
    ] as const) {
      expect(presets(m, p)).toEqual(['SUPER']);
    }
  });

  it('never lets the content preset reach personal data, payments, applications or settings', () => {
    const content = routes.filter((r) => r.roles?.includes('ADMIN') && r.adminCan?.includes('CONTENT')).map((r) => `${r.method} ${r.path}`);
    expect(content.sort()).toEqual(
      [
        'GET admin/media/library',
        'PATCH admin/media/courses/:id',
        'PATCH admin/media/courses/:id/sessions/:sessionId',
        'PATCH admin/media/events/:id',
        'PATCH admin/media/instructors/:id',
        'POST admin/media/upload',
        // Any admin may try the student application flow on their own account.
        'POST applications',
      ].sort(),
    );
  });

  it('keeps the full course, session and speaker editors away from the content preset', () => {
    expect(presets('PUT', 'admin/courses/:id')).toEqual(['ACADEMIC']);
    expect(presets('PUT', 'admin/courses/:id/sessions/:sessionId')).toEqual(['ACADEMIC']);
    expect(presets('PUT', 'admin/events/:id')).toEqual(['ACADEMIC']);
    expect(presets('PUT', 'admin/instructors/:id')).toEqual(['SPEAKERS']);
  });

  it('gives payments to finance, and students and applications to admissions', () => {
    for (const r of routes.filter((x) => x.path.startsWith('admin/payments'))) expect(r.adminCan).toEqual(['FINANCE']);
    for (const r of routes.filter((x) => /^admin\/(students|applications)/.test(x.path) && !x.path.includes('/points') && !x.path.includes('/badges'))) {
      expect(r.adminCan).toEqual(['ADMISSIONS']);
    }
  });

  it('keeps course staff and roles with the academic preset', () => {
    const staff = routes.filter((r) => r.path.startsWith('admin/courses/:id/staff'));
    expect(staff.length).toBe(7);
    for (const r of staff) expect(r.adminCan).toEqual(['ACADEMIC']);
  });

  it('serves uploaded images publicly, and only there', () => {
    const media = find('GET', 'media/:name');
    expect(media.isPublic).toBe(true);
    expect(media.roles).toBeUndefined();
  });
});
