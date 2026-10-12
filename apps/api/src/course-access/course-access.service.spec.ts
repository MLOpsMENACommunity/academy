import type { PrismaService } from '../prisma/prisma.service';
import { CourseAccessService } from './course-access.service';

describe('CourseAccessService.canTeach', () => {
  const count = jest.fn();
  const svc = new CourseAccessService({ course: { count } } as unknown as PrismaService);
  beforeEach(() => count.mockReset());

  it('lets SUPER and ACADEMIC admins teach any course, and no other admin', async () => {
    expect(await svc.canTeach({ id: 'a', role: 'ADMIN', adminPermissions: ['SUPER'] }, 'c1')).toBe(true);
    expect(await svc.canTeach({ id: 'a', role: 'ADMIN', adminPermissions: ['ACADEMIC'] }, 'c1')).toBe(true);
    for (const p of ['CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const) {
      expect(await svc.canTeach({ id: 'a', role: 'ADMIN', adminPermissions: [p] }, 'c1')).toBe(false);
    }
    expect(count).not.toHaveBeenCalled();
  });

  it('lets a speaker teach only an assigned, non-archived course', async () => {
    count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await svc.canTeach({ id: 'u1', role: 'SPEAKER' }, 'c1')).toBe(true);
    expect(await svc.canTeach({ id: 'u1', role: 'SPEAKER' }, 'c2')).toBe(false);
    expect(count).toHaveBeenCalledWith({
      where: { id: 'c1', status: { not: 'ARCHIVED' }, instructors: { some: { instructor: { userId: 'u1' } } } },
    });
  });

  it('never lets students or anonymous users teach', async () => {
    expect(await svc.canTeach({ id: 's', role: 'STUDENT' }, 'c1')).toBe(false);
    expect(await svc.canTeach(null, 'c1')).toBe(false);
    expect(await svc.canTeach({ id: 'u1', role: 'SPEAKER' }, '')).toBe(false);
    expect(count).not.toHaveBeenCalled();
    await expect(svc.assertTeaches({ id: 's', role: 'STUDENT' }, 'c1')).rejects.toMatchObject({ status: 403 });
  });
});
