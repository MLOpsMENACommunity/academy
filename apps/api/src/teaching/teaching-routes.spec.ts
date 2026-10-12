import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators';
import { TeachesCourseGuard } from './teaches-course.guard';
import { TeachingController } from './teaching.controller';

/**
 * The speaker teaching routes are speaker-only and course-scoped: the class carries
 * @Roles('SPEAKER') and TeachesCourseGuard, and every route but "my courses" is under
 * :courseId, so the guard always has a course to check. A new route that breaks this fails here.
 */
describe('TeachingController routes', () => {
  const routes = Object.getOwnPropertyNames(TeachingController.prototype)
    .filter((k) => k !== 'constructor')
    .map((k) => {
      const h = (TeachingController.prototype as unknown as Record<string, object>)[k]!;
      return {
        key: k,
        path: Reflect.getMetadata(PATH_METADATA, h) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, h) as RequestMethod | undefined,
        roles: Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined,
        guards: Reflect.getMetadata(GUARDS_METADATA, h) as unknown[] | undefined,
      };
    })
    .filter((r) => r.path !== undefined && r.method !== undefined);

  it('is speaker-only and guarded by TeachesCourseGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TeachingController)).toBe('speaker/courses');
    expect(Reflect.getMetadata(ROLES_KEY, TeachingController)).toEqual(['SPEAKER']);
    expect(Reflect.getMetadata(GUARDS_METADATA, TeachingController)).toContain(TeachesCourseGuard);
    // No method widens the roles or replaces the guards.
    for (const r of routes) {
      expect(r.roles).toBeUndefined();
      expect(r.guards).toBeUndefined();
    }
  });

  it('puts every route but the course list under :courseId', () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      if (r.key === 'courses') expect(r.path).toBe('/');
      else expect(r.path).toMatch(/^:courseId(\/|$)/);
    }
  });
});
