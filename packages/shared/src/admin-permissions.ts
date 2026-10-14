import { z } from 'zod';
import { emailSchema } from './auth';
import { ADMIN_PERMISSIONS, LOCALES, type AdminPermission, type Role } from './enums';

/**
 * Admin permission presets. An ADMIN account has one or more; SUPER can do everything.
 *
 *   SUPER       everything, including the team (admins and their presets), settings and the audit log
 *   ACADEMIC    courses and their sessions, live sessions, assessments and grading, points and
 *               badges, certificates, course announcements, feedback
 *   CONTENT     images, recordings and video links (course covers, session covers, speaker
 *               photos) through Admin → Media only: no student personal data
 *   ADMISSIONS  applications, students, enrolments, invites, waiting lists
 *   SPEAKERS    speaker profiles, speaker applications, slots and bookings, assigning speakers to courses
 *   FINANCE     payments
 *
 * The API is the gate (@AdminCan on every admin route, checked against the database on every
 * request); the web app only hides what an admin can't use.
 */

/** Anything with a role and (for admins) permissions: the signed-in user, a /auth/me response. */
export interface PermissionHolder {
  role: Role;
  adminPermissions?: readonly AdminPermission[] | null;
}

/** True for an ADMIN with SUPER or any of `allowed`. An empty `allowed` means SUPER only. */
export function hasAdminPermission(user: PermissionHolder | null | undefined, allowed: readonly AdminPermission[]): boolean {
  if (!user || user.role !== 'ADMIN') return false;
  const mine = user.adminPermissions ?? [];
  return mine.includes('SUPER') || allowed.some((p) => mine.includes(p));
}

/** Sections of the admin panel, in nav order, and who sees each. */
export const ADMIN_NAV_ITEMS = [
  { key: 'dashboard', permissions: ['ADMISSIONS', 'ACADEMIC', 'FINANCE'] },
  { key: 'payments', permissions: ['FINANCE'] },
  { key: 'applications', permissions: ['ADMISSIONS'] },
  { key: 'students', permissions: ['ADMISSIONS'] },
  { key: 'points', permissions: ['ACADEMIC'] },
  { key: 'courses', permissions: ['ACADEMIC', 'ADMISSIONS'] },
  { key: 'sessions', permissions: ['ACADEMIC'] },
  { key: 'speakers', permissions: ['SPEAKERS'] },
  { key: 'media', permissions: ['CONTENT'] },
  { key: 'team', permissions: ['SUPER'] },
  { key: 'settings', permissions: ['SUPER'] },
  { key: 'audit', permissions: ['SUPER'] },
] as const satisfies readonly { key: string; permissions: readonly AdminPermission[] }[];
export type AdminNavKey = (typeof ADMIN_NAV_ITEMS)[number]['key'];

/** The admin sections this user can open, in nav order. */
export function adminNavFor(user: PermissionHolder | null | undefined): AdminNavKey[] {
  return ADMIN_NAV_ITEMS.filter((i) => hasAdminPermission(user, i.permissions)).map((i) => i.key);
}

/** The nav section a path under /{locale}/admin belongs to ('' or '/' is the dashboard). */
export function adminSectionOf(subpath: string): AdminNavKey | null {
  const first = subpath.replace(/^\/+/, '').split(/[/?#]/)[0] ?? '';
  if (!first) return 'dashboard';
  return (ADMIN_NAV_ITEMS.find((i) => i.key === first)?.key as AdminNavKey | undefined) ?? null;
}

/** Tabs of Admin → Courses → {course}, and who sees each (the API checks the same). */
export const COURSE_TAB_PERMISSIONS = {
  details: ['ACADEMIC'],
  questions: ['ACADEMIC'],
  applications: ['ADMISSIONS'],
  sessions: ['ACADEMIC'],
  attendance: ['ACADEMIC'],
  assessments: ['ACADEMIC'],
  leaderboard: ['ACADEMIC'],
  enrolled: ['ADMISSIONS', 'ACADEMIC'],
  invites: ['ADMISSIONS'],
  certificates: ['ACADEMIC'],
  announcements: ['ACADEMIC'],
  waitlist: ['ADMISSIONS'],
  feedback: ['ACADEMIC'],
} as const satisfies Record<string, readonly AdminPermission[]>;

// ------------------------------------------------------------------ Admin → Team

/** One or more presets, each once, in the canonical order. */
export const adminPermissionsSchema = z
  .array(z.enum(ADMIN_PERMISSIONS))
  .min(1, 'Choose at least one')
  .max(ADMIN_PERMISSIONS.length)
  .transform((list) => ADMIN_PERMISSIONS.filter((p) => list.includes(p)));

/**
 * "Add admin": an address that already has an account is promoted; a new one gets an account
 * and an email with a link to choose their own password (the same as "Add student").
 */
export const addAdminSchema = z.object({
  email: emailSchema,
  permissions: adminPermissionsSchema,
  /** Language of the welcome email for a new account. */
  locale: z.enum(LOCALES).default('en'),
  /** Optional, for a new account: prefills the profile's English name. */
  fullNameEn: z.string().trim().max(120).nullish().transform((v) => (v ? v : null)),
});
export type AddAdminInput = z.infer<typeof addAdminSchema>;

export const updateAdminSchema = z.object({ permissions: adminPermissionsSchema });
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;

export interface AdminTeamMemberDto {
  id: string;
  email: string;
  name: string | null;
  permissions: AdminPermission[];
  /** Has never signed in (e.g. invited, password not chosen yet). */
  pending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AddAdminResultDto {
  member: AdminTeamMemberDto;
  /** 'promoted': an existing account became an admin; 'invited': a new account was created and emailed. */
  outcome: 'promoted' | 'invited';
}
