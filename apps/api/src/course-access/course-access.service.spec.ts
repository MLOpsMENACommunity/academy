import type { CoursePermission } from '@academy/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { CourseAccessService } from './course-access.service';

describe('CourseAccessService', () => {
  const findUnique = jest.fn();
  const svc = new CourseAccessService({ course: { findUnique } } as unknown as PrismaService);
  beforeEach(() => findUnique.mockReset());

  const course = (status: string, permissions: CoursePermission[] | null) => ({
    status,
    staff: permissions ? [{ role: { id: 'r1', name: 'Teaching assistant', nameAr: null, permissions } }] : [],
  });

  it('lets SUPER and ACADEMIC admins do everything in any existing course, archived too, and no other admin preset', async () => {
    findUnique.mockResolvedValue(course('ARCHIVED', null));
    expect(await svc.can({ id: 'a', role: 'ADMIN', adminPermissions: ['SUPER'] }, 'c1', 'ISSUE_CERTIFICATES')).toBe(true);
    expect(await svc.can({ id: 'a', role: 'ADMIN', adminPermissions: ['ACADEMIC'] }, 'c1', 'GRADE')).toBe(true);
    for (const p of ['CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const) {
      expect(await svc.can({ id: 'a', role: 'ADMIN', adminPermissions: [p] }, 'c1', 'GRADE')).toBe(false);
    }
    findUnique.mockResolvedValue(null);
    expect(await svc.can({ id: 'a', role: 'ADMIN', adminPermissions: ['SUPER'] }, 'nope', 'GRADE')).toBe(false);
  });

  it('gives staff exactly their role’s permissions, in any account role', async () => {
    findUnique.mockResolvedValue(course('OPEN', ['ANNOUNCE']));
    const student = { id: 's1', role: 'STUDENT' as const };
    expect(await svc.can(student, 'c1', 'ANNOUNCE')).toBe(true);
    expect(await svc.can(student, 'c1', 'GRADE')).toBe(false);
    expect(await svc.can(student, 'c1', ['GRADE', 'ANNOUNCE'])).toBe(true);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }));
    expect(findUnique.mock.calls[0][0].select.staff.where).toEqual({ userId: 's1' });
  });

  it('refuses people off the staff, unknown courses and archived courses', async () => {
    const speaker = { id: 'u1', role: 'SPEAKER' as const };
    findUnique.mockResolvedValueOnce(course('OPEN', null));
    expect(await svc.membership(speaker, 'c1')).toBeNull();
    findUnique.mockResolvedValueOnce(null);
    expect(await svc.membership(speaker, 'c2')).toBeNull();
    findUnique.mockResolvedValueOnce(course('ARCHIVED', ['GRADE']));
    expect(await svc.membership(speaker, 'c3')).toBeNull();
  });

  it('never asks the database for anonymous users or an empty course id', async () => {
    expect(await svc.can(null, 'c1', 'GRADE')).toBe(false);
    expect(await svc.can({ id: 'u1', role: 'SPEAKER' }, '', 'GRADE')).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 403 NOT_YOUR_COURSE off the staff and 403 COURSE_PERMISSION without the permission', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(svc.assertCan({ id: 's', role: 'STUDENT' }, 'c1', ['GRADE'])).rejects.toMatchObject({ status: 403, response: { code: 'NOT_YOUR_COURSE' } });
    findUnique.mockResolvedValueOnce(course('OPEN', ['ANNOUNCE']));
    await expect(svc.assertCan({ id: 's', role: 'STUDENT' }, 'c1', ['GRADE'])).rejects.toMatchObject({ status: 403, response: { code: 'COURSE_PERMISSION' } });
    findUnique.mockResolvedValueOnce(course('OPEN', ['ANNOUNCE']));
    await expect(svc.assertCan({ id: 's', role: 'STUDENT' }, 'c1')).resolves.toMatchObject({ permissions: ['ANNOUNCE'], roleName: 'Teaching assistant', admin: false });
  });

  it('lets whoever writes or grades assessments preview them', async () => {
    findUnique.mockResolvedValueOnce(course('OPEN', ['GRADE']));
    expect(await svc.canTeach({ id: 'u', role: 'STUDENT' }, 'c1')).toBe(true);
    findUnique.mockResolvedValueOnce(course('OPEN', ['ANNOUNCE', 'VIEW_ROSTER']));
    expect(await svc.canTeach({ id: 'u', role: 'STUDENT' }, 'c1')).toBe(false);
  });

  it('lets only SUPER and ADMISSIONS admins enrol by email on a paid course, or send skipPayment', async () => {
    const main = { id: 'm', role: 'STUDENT' as const };
    for (const p of ['SUPER', 'ADMISSIONS'] as const) {
      await expect(svc.assertMayEnrolByEmail({ id: 'a', role: 'ADMIN', adminPermissions: [p] }, 'c1', true)).resolves.toBeUndefined();
    }
    await expect(svc.assertMayEnrolByEmail({ id: 'a', role: 'ADMIN', adminPermissions: ['ACADEMIC'] }, 'c1', true)).rejects.toMatchObject({ status: 403, response: { code: 'PAYMENT_WAIVER_ADMIN_ONLY' } });
    await expect(svc.assertMayEnrolByEmail(main, 'c1', true)).rejects.toMatchObject({ response: { code: 'PAYMENT_WAIVER_ADMIN_ONLY' } });
    findUnique.mockResolvedValueOnce({ type: 'PAID' });
    await expect(svc.assertMayEnrolByEmail(main, 'c1', false)).rejects.toMatchObject({ response: { code: 'PAYMENT_WAIVER_ADMIN_ONLY' } });
    findUnique.mockResolvedValueOnce({ type: 'FREE' });
    await expect(svc.assertMayEnrolByEmail(main, 'c2', false)).resolves.toBeUndefined();
  });
});
