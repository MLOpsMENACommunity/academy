import { z } from 'zod';
import { ADMIN_PERMISSIONS, LOCALES, ROLES } from './enums';

export const PASSWORD_MIN = 10;

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(128);

/**
 * What someone can sign up as. ADMIN is never one of them: admins are made by an admin
 * (or the seed), so a crafted request can't create one.
 */
export const SIGNUP_ROLES = ['STUDENT', 'SPEAKER'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];
export const signupRoleSchema = z.enum(SIGNUP_ROLES);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  locale: z.enum(LOCALES).default('en'),
  returnTo: z.string().max(512).optional(),
  /** "I'm a student" (default) or "I'm a speaker". */
  role: signupRoleSchema.default('STUDENT'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  locale: z.enum(LOCALES).default('en'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  /** The user types this word to confirm. */
  confirm: z.literal('DELETE'),
  password: z.string().max(128).optional(),
});

export const updateAccountSchema = z.object({ locale: z.enum(LOCALES) });

/** Shape of GET /api/auth/me. */
export interface MeResponse {
  id: string;
  email: string;
  role: (typeof ROLES)[number];
  /** ADMIN accounts: what they may do (see admin-permissions.ts). Empty for everyone else. */
  adminPermissions: (typeof ADMIN_PERMISSIONS)[number][];
  locale: (typeof LOCALES)[number];
  emailVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  name: string | null;
  /**
   * Has a student side to show (the dashboard, "My learning"): always for students; for a
   * speaker, once they have a course application or enrolment. Never for admins.
   */
  learning: boolean;
  profile: {
    completeness: number;
    coreComplete: boolean;
    /** The Telegram or Discord username is missing (learners from before they were asked): needed to apply. */
    needsCommunityHandles: boolean;
    updatedAt: string | null;
  };
}
