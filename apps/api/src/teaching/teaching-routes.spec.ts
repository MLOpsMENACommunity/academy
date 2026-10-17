import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { COURSE_PERMISSIONS } from '@academy/shared';
import { ROLES_KEY } from '../common/decorators';
import { ANY_STAFF, COURSE_CAN_KEY, CoursePermissionGuard } from '../course-access/course-permission.guard';
import { TeachManageController } from './teach-manage.controller';
import { TeachingController } from './teaching.controller';

/**
 * The Teaching routes are course-scoped and permission-tagged: each class carries
 * CoursePermissionGuard and no account-role restriction (a student can be a moderator); every
 * route but "my courses" is under :courseId and names the course permissions that open it
 * (@CourseCan). A new route that breaks this fails here (the guard also refuses an untagged one).
 */
function routesOf(cls: { prototype: object }) {
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((k) => k !== 'constructor')
    .map((k) => {
      const h = (cls.prototype as Record<string, object>)[k]!;
      return {
        key: k,
        path: Reflect.getMetadata(PATH_METADATA, h) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, h) as RequestMethod | undefined,
        roles: Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined,
        guards: Reflect.getMetadata(GUARDS_METADATA, h) as unknown[] | undefined,
        can: Reflect.getMetadata(COURSE_CAN_KEY, h) as string[] | undefined,
      };
    })
    .filter((r) => r.path !== undefined && r.method !== undefined);
}

const teaching = routesOf(TeachingController);
const manage = routesOf(TeachManageController);
const tag = (routes: ReturnType<typeof routesOf>, method: keyof typeof RequestMethod, path: string) =>
  routes.find((r) => r.method === RequestMethod[method] && r.path === path)?.can;

describe('Teaching routes', () => {
  it('serve /teach/courses (and the old /speaker/courses for the teaching ones), guarded, for any account role', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TeachingController)).toEqual(['teach/courses', 'speaker/courses']);
    expect(Reflect.getMetadata(PATH_METADATA, TeachManageController)).toBe('teach/courses');
    for (const cls of [TeachingController, TeachManageController]) {
      expect(Reflect.getMetadata(ROLES_KEY, cls)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, cls)).toContain(CoursePermissionGuard);
    }
    for (const r of [...teaching, ...manage]) {
      expect(r.roles).toBeUndefined();
      expect(r.guards).toBeUndefined();
    }
  });

  it('puts every route but the course list under :courseId, with known permissions', () => {
    expect(teaching.length).toBeGreaterThan(20);
    expect(manage.length).toBeGreaterThan(20);
    for (const r of [...teaching, ...manage]) {
      if (r.key === 'courses') {
        expect(r.path).toBe('/');
        expect(r.can).toBeUndefined();
        continue;
      }
      expect(r.path).toMatch(/^:courseId(\/|$)/);
      expect(r.can?.length).toBeGreaterThan(0);
      for (const p of r.can!) expect([...COURSE_PERMISSIONS, ANY_STAFF]).toContain(p);
    }
  });

  it('opens only the course overview to any staff member', () => {
    const any = [...teaching, ...manage].filter((r) => r.can?.includes(ANY_STAFF)).map((r) => r.path);
    expect(any).toEqual([':courseId']);
  });

  it('maps each area to its permission', () => {
    expect(tag(teaching, 'POST', ':courseId/assessments')).toEqual(['MANAGE_ASSESSMENTS']);
    expect(tag(teaching, 'POST', ':courseId/assessments/import')).toEqual(['MANAGE_ASSESSMENTS']);
    expect(tag(teaching, 'GET', ':courseId/assessments')).toEqual(['MANAGE_ASSESSMENTS', 'GRADE']);
    expect(tag(teaching, 'PUT', ':courseId/submissions/:id/grade')).toEqual(['GRADE']);
    expect(tag(teaching, 'GET', ':courseId/gradebook.csv')).toEqual(['GRADE']);
    expect(tag(teaching, 'PUT', ':courseId/sessions/:sessionId/materials')).toEqual(['MANAGE_MATERIALS']);
    expect(tag(teaching, 'POST', ':courseId/sessions/:sessionId/attendance')).toEqual(['UPLOAD_ATTENDANCE']);
    expect(tag(teaching, 'POST', ':courseId/points')).toEqual(['MANAGE_POINTS']);
    expect(tag(teaching, 'POST', ':courseId/announcements')).toEqual(['ANNOUNCE']);
    expect(tag(manage, 'GET', ':courseId/roster')).toEqual(['VIEW_ROSTER']);
    expect(tag(manage, 'PUT', ':courseId/details')).toEqual(['EDIT_COURSE']);
    expect(tag(manage, 'PUT', ':courseId/sessions/:sessionId')).toEqual(['MANAGE_SESSIONS']);
    expect(tag(manage, 'POST', ':courseId/applications/:id/transition')).toEqual(['MANAGE_APPLICATIONS']);
    expect(tag(manage, 'POST', ':courseId/invites')).toEqual(['ENROL']);
    expect(tag(manage, 'DELETE', ':courseId/waitlist/:entryId')).toEqual(['ENROL']);
    expect(tag(manage, 'POST', ':courseId/certificates/:certificateId/revoke')).toEqual(['ISSUE_CERTIFICATES']);
  });
});
