import { z } from 'zod';
import { emailSchema } from './auth';
import {
  COURSE_PERMISSIONS,
  STAFF_VISIBILITIES,
  type BuiltinCourseRole,
  type CoursePermission,
  type Role,
  type StaffVisibility,
} from './enums';

/**
 * Course staff: the people who run one course, each in one of that course's roles.
 *
 *  - Roles are per course (CourseRole). Every course starts with three built-in roles that can
 *    be renamed and re-permissioned: Main instructor (all permissions, can't be deleted),
 *    Co-instructor and Moderator. Admins add any other role ("Teaching assistant", …).
 *  - A role's permissions are checkboxes (CoursePermission). SUPER and ACADEMIC admins can do
 *    everything in every course; anyone else needs a CourseStaff row in that course whose role
 *    has the permission. Any account can be staff (a speaker, an admin, a student).
 *  - A role is SHOWN (its people are on the public course page: name, title and photo from their
 *    public speaker profile, else the account name) or ANONYMOUS (never shown publicly).
 *  - A staff row with a public speaker profile and no account is display-only: it shows on the
 *    course page and can do nothing.
 *
 * The API is the gate (CourseAccessService.can on every /teach request, read from the database);
 * the web app only hides the tabs a person can't use.
 */

// ------------------------------------------------------------------ permissions

/** The checkboxes, grouped as the roles editor shows them. */
export const COURSE_PERMISSION_GROUPS = [
  { key: 'teaching', permissions: ['MANAGE_ASSESSMENTS', 'GRADE'] },
  { key: 'material', permissions: ['MANAGE_MATERIALS'] },
  { key: 'students', permissions: ['VIEW_ROSTER', 'UPLOAD_ATTENDANCE', 'MANAGE_POINTS'] },
  { key: 'communication', permissions: ['ANNOUNCE'] },
  { key: 'management', permissions: ['EDIT_COURSE', 'MANAGE_SESSIONS', 'MANAGE_APPLICATIONS', 'ENROL', 'ISSUE_CERTIFICATES'] },
] as const satisfies readonly { key: string; permissions: readonly CoursePermission[] }[];
export type CoursePermissionGroup = (typeof COURSE_PERMISSION_GROUPS)[number]['key'];

/** The three roles each course starts with: their first names, permissions and visibility. */
export const BUILTIN_ROLE_DEFAULTS: Record<
  BuiltinCourseRole,
  { name: string; nameAr: string; permissions: readonly CoursePermission[]; visibility: StaffVisibility; order: number }
> = {
  MAIN: { name: 'Main instructor', nameAr: 'المدرّب الرئيسي', permissions: COURSE_PERMISSIONS, visibility: 'SHOWN', order: 0 },
  CO: {
    name: 'Co-instructor',
    nameAr: 'مدرّب مشارك',
    // What an assigned speaker could do before course roles existed, plus the roster.
    permissions: ['MANAGE_ASSESSMENTS', 'GRADE', 'MANAGE_MATERIALS', 'VIEW_ROSTER', 'UPLOAD_ATTENDANCE', 'MANAGE_POINTS', 'ANNOUNCE'],
    visibility: 'SHOWN',
    order: 1,
  },
  MODERATOR: {
    name: 'Moderator',
    nameAr: 'مشرف',
    permissions: ['VIEW_ROSTER', 'UPLOAD_ATTENDANCE', 'MANAGE_POINTS', 'ANNOUNCE'],
    // Often a past student: kept off the public page unless the team decides otherwise.
    visibility: 'ANONYMOUS',
    order: 2,
  },
};

/** Each permission once, in the canonical order. */
export const coursePermissionsSchema = z
  .array(z.enum(COURSE_PERMISSIONS))
  .max(COURSE_PERMISSIONS.length)
  .transform((list) => COURSE_PERMISSIONS.filter((p) => list.includes(p)));

// ------------------------------------------------------------------ admin: roles and staff

export const courseRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  nameAr: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  permissions: coursePermissionsSchema,
  visibility: z.enum(STAFF_VISIBILITIES),
  order: z.coerce.number().int().min(0).max(999).optional(),
});
export type CourseRoleInput = z.infer<typeof courseRoleInputSchema>;

/** Add a person: an existing account by email, or a public speaker profile (with or without an account). */
export const addCourseStaffSchema = z
  .object({
    roleId: z.string().trim().min(1).max(40),
    email: emailSchema.optional(),
    instructorId: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => Boolean(v.email) !== Boolean(v.instructorId), { message: 'Give an email or a speaker profile', path: ['email'] });
export type AddCourseStaffInput = z.infer<typeof addCourseStaffSchema>;

export const updateCourseStaffSchema = z.object({
  roleId: z.string().trim().min(1).max(40),
  order: z.coerce.number().int().min(0).max(999).optional(),
});
export type UpdateCourseStaffInput = z.infer<typeof updateCourseStaffSchema>;

export interface CourseRoleDto {
  id: string;
  name: string;
  nameAr: string | null;
  permissions: CoursePermission[];
  visibility: StaffVisibility;
  builtin: BuiltinCourseRole | null;
  order: number;
  /** People in this role. */
  members: number;
}

export interface CourseStaffMemberDto {
  id: string;
  roleId: string;
  order: number;
  /** The account (null for a display-only speaker profile). */
  user: { id: string; email: string; name: string | null; role: Role; deleted: boolean } | null;
  /** The public speaker profile shown on the course page, if any. */
  instructor: { id: string; name: string; slug: string | null; photoUrl: string | null } | null;
  /** Shown on the course page (the role is SHOWN). */
  shown: boolean;
  /** Display-only: a profile without an account can't do anything. */
  displayOnly: boolean;
}

export interface CourseStaffDto {
  roles: CourseRoleDto[];
  staff: CourseStaffMemberDto[];
  /** Nobody is in the Main instructor role (every course is expected to have one). */
  noMainInstructor: boolean;
  /** More than one person in the Main instructor role. */
  multipleMainInstructors: boolean;
}

// ------------------------------------------------------------------ public course page

export interface PublicStaffPersonDto {
  /** The staff row (stable React key; not an account id). */
  id: string;
  name: string;
  nameAr: string | null;
  titleEn: string | null;
  titleAr: string | null;
  bioEn: string | null;
  bioAr: string | null;
  photoUrl: string | null;
  /** Public speaker page /speakers/{slug}, when they have one. */
  slug: string | null;
  linkedinUrl: string | null;
}

/** SHOWN roles only, Main instructor first, then by role order. Never an email. */
export interface PublicStaffGroupDto {
  roleId: string;
  name: string;
  nameAr: string | null;
  builtin: BuiltinCourseRole | null;
  people: PublicStaffPersonDto[];
}

// ------------------------------------------------------------------ the Teaching area (/teach)

/** Tabs of /teach/courses/{id}, and the permissions that show each (any one is enough). */
export const TEACH_TAB_PERMISSIONS = {
  assessments: ['MANAGE_ASSESSMENTS'],
  gradebook: ['GRADE'],
  materials: ['MANAGE_MATERIALS'],
  attendance: ['UPLOAD_ATTENDANCE'],
  points: ['MANAGE_POINTS'],
  roster: ['VIEW_ROSTER'],
  announcements: ['ANNOUNCE'],
  details: ['EDIT_COURSE'],
  sessions: ['MANAGE_SESSIONS'],
  applications: ['MANAGE_APPLICATIONS'],
  enrolment: ['ENROL'],
  certificates: ['ISSUE_CERTIFICATES'],
} as const satisfies Record<string, readonly CoursePermission[]>;
export type TeachTab = keyof typeof TEACH_TAB_PERMISSIONS;
export const TEACH_TABS = Object.keys(TEACH_TAB_PERMISSIONS) as TeachTab[];

/** The tabs someone with these permissions sees, in order. */
export function teachTabsFor(permissions: readonly CoursePermission[]): TeachTab[] {
  return TEACH_TABS.filter((t) => TEACH_TAB_PERMISSIONS[t].some((p) => permissions.includes(p)));
}

/** One enrolled student as staff with VIEW_ROSTER see them. */
export interface TeachRosterStudentDto {
  userId: string;
  name: string | null;
  nameAr: string | null;
  email: string;
  /** Community usernames, once profiles have them (null until then). */
  telegram: string | null;
  discord: string | null;
  enrolledAt: string;
}

/** Teaching → {course} → Announcements: who would get it, what was sent, the limits. */
export interface TeachAnnouncementsDto {
  audience: number;
  sentToday: number;
  limits: { perTargetPerDay: number; perDay: number; sentTodayByMe: number };
  sent: {
    id: string;
    at: string;
    subjectEn: string;
    subjectAr: string;
    from: string | null;
    recipients: number;
    sent: number;
    pending: number;
    failed: number;
  }[];
}
