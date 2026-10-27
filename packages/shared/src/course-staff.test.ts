import { describe, expect, it } from 'vitest';
import { addCourseStaffSchema, BUILTIN_ROLE_DEFAULTS, COURSE_PERMISSION_GROUPS, courseRoleInputSchema, teachTabsFor, TEACH_TAB_PERMISSIONS } from './course-staff';
import { COURSE_PERMISSIONS } from './enums';

describe('course staff', () => {
  it('groups every permission exactly once', () => {
    const grouped = COURSE_PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect([...grouped].sort()).toEqual([...COURSE_PERMISSIONS].sort());
  });

  it('gives the Main instructor every permission, and every permission but the not-yet-used ones opens a Teaching tab', () => {
    expect(BUILTIN_ROLE_DEFAULTS.MAIN.permissions).toEqual(COURSE_PERMISSIONS);
    expect(BUILTIN_ROLE_DEFAULTS.CO.permissions).toContain('VIEW_FEEDBACK');
    expect(BUILTIN_ROLE_DEFAULTS.MODERATOR.permissions).toContain('VIEW_FEEDBACK');
    for (const b of ['CO', 'MODERATOR'] as const) expect(BUILTIN_ROLE_DEFAULTS[b].permissions).not.toContain('MANAGE_RULES');
    const opened: string[] = Object.values(TEACH_TAB_PERMISSIONS).flat();
    for (const p of COURSE_PERMISSIONS.filter((x) => x !== 'VIEW_FEEDBACK')) expect(opened).toContain(p);
  });

  it('shows the tabs a role’s permissions open, in order', () => {
    expect(teachTabsFor([])).toEqual([]);
    expect(teachTabsFor(['ANNOUNCE'])).toEqual(['announcements']);
    expect(teachTabsFor(['VIEW_ROSTER', 'GRADE'])).toEqual(['gradebook', 'roster']);
  });

  it('stores permissions once each, in the canonical order, and needs a name', () => {
    expect(courseRoleInputSchema.parse({ name: ' TA ', permissions: ['VIEW_ROSTER', 'GRADE', 'GRADE'], visibility: 'SHOWN' })).toEqual({
      name: 'TA',
      nameAr: null,
      permissions: ['GRADE', 'VIEW_ROSTER'],
      visibility: 'SHOWN',
    });
    expect(courseRoleInputSchema.safeParse({ name: 'x', permissions: [], visibility: 'SHOWN' }).success).toBe(false);
    expect(courseRoleInputSchema.safeParse({ name: 'Mod', permissions: ['ROOT'], visibility: 'SHOWN' }).success).toBe(false);
  });

  it('adds a person by email or by speaker profile, not both', () => {
    expect(addCourseStaffSchema.safeParse({ roleId: 'r', email: 'A@Example.com' }).success).toBe(true);
    expect(addCourseStaffSchema.safeParse({ roleId: 'r', instructorId: 'i' }).success).toBe(true);
    expect(addCourseStaffSchema.safeParse({ roleId: 'r' }).success).toBe(false);
    expect(addCourseStaffSchema.safeParse({ roleId: 'r', email: 'a@example.com', instructorId: 'i' }).success).toBe(false);
  });
});
