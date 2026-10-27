import { z } from 'zod';
import type { CoursePermission } from './enums';

/**
 * Course automation rules: "when this happens, do that", switched on per course. Each rule is a
 * fixed type from this catalog with a few settings; the API's hourly job evaluates the ones that
 * are on. Rules only message students, alert the course team, award points, issue certificates
 * (when chosen) or flag students for attention. No rule ever rejects, withdraws, removes or
 * deletes a student, or releases a seat.
 */

export const AUTOMATION_GROUPS = ['attendance', 'assessments', 'certificates', 'feedback', 'admissions', 'operations', 'community'] as const;
export type AutomationGroup = (typeof AUTOMATION_GROUPS)[number];

/** A setting of a rule: a whole number, a 1-5 rating with tenths, a choice, or a link. */
export type AutomationParam =
  | { key: string; kind: 'int'; unit: 'sessions' | 'days' | 'hours' | 'points' | 'percent' | 'times' | 'ratings'; min: number; max: number; default: number }
  | { key: string; kind: 'rating'; min: number; max: number; default: number }
  | { key: string; kind: 'choice'; options: readonly string[]; default: string }
  | { key: string; kind: 'url'; default: string };

/** Who a rule acts for: the student gets a message, the team gets an alert. */
export type AutomationAudience = 'student' | 'staff' | 'both';

export interface AutomationRuleDef {
  type: string;
  group: AutomationGroup;
  audience: AutomationAudience;
  params: readonly AutomationParam[];
  /** Student messages take an optional note from the course team, in each language. */
  note: boolean;
  /** Course-staff permission whose holders get the team alerts (falls back to admins with `adminPresets`). */
  staffPermission?: CoursePermission;
  adminPresets?: readonly ('ACADEMIC' | 'ADMISSIONS' | 'FINANCE')[];
  /** Part of "Turn on the recommended set". */
  recommended: boolean;
}

const int = (key: string, unit: Extract<AutomationParam, { kind: 'int' }>['unit'], min: number, max: number, def: number): AutomationParam => ({
  key,
  kind: 'int',
  unit,
  min,
  max,
  default: def,
});

export const AUTOMATION_RULES = [
  // ---- attendance and engagement
  {
    type: 'MISSED_IN_A_ROW',
    group: 'attendance',
    audience: 'both',
    params: [int('sessions', 'sessions', 2, 5, 2)],
    note: true,
    staffPermission: 'VIEW_ROSTER',
    adminPresets: ['ACADEMIC'],
    recommended: true,
  },
  {
    type: 'AT_RISK_EARLY',
    group: 'attendance',
    audience: 'staff',
    params: [int('sessions', 'sessions', 1, 4, 2)],
    note: false,
    staffPermission: 'VIEW_ROSTER',
    adminPresets: ['ACADEMIC'],
    recommended: false,
  },
  { type: 'INACTIVE', group: 'attendance', audience: 'student', params: [int('days', 'days', 3, 30, 7)], note: true, recommended: false },
  {
    type: 'FULL_ATTENDANCE_MIDWAY',
    group: 'attendance',
    audience: 'student',
    params: [int('points', 'points', 1, 100, 10)],
    note: true,
    recommended: false,
  },
  { type: 'OFTEN_LATE', group: 'attendance', audience: 'student', params: [int('times', 'times', 2, 10, 3)], note: true, recommended: false },
  // ---- assessments
  { type: 'DUE_SOON', group: 'assessments', audience: 'student', params: [int('hours', 'hours', 6, 168, 48)], note: true, recommended: false },
  {
    type: 'DEADLINE_MISSED',
    group: 'assessments',
    audience: 'both',
    params: [],
    note: true,
    staffPermission: 'GRADE',
    adminPresets: ['ACADEMIC'],
    recommended: true,
  },
  { type: 'QUIZ_FAILED', group: 'assessments', audience: 'student', params: [], note: true, recommended: false },
  {
    type: 'HIGH_SCORE',
    group: 'assessments',
    audience: 'student',
    params: [int('percent', 'percent', 50, 100, 90), int('points', 'points', 1, 100, 5)],
    note: true,
    recommended: false,
  },
  { type: 'MANDATORY_PASSED', group: 'assessments', audience: 'student', params: [], note: true, recommended: false },
  {
    type: 'UNGRADED',
    group: 'assessments',
    audience: 'staff',
    params: [int('days', 'days', 1, 14, 3)],
    note: false,
    staffPermission: 'GRADE',
    adminPresets: ['ACADEMIC'],
    recommended: true,
  },
  // ---- certificates
  {
    type: 'CERT_ELIGIBLE',
    group: 'certificates',
    audience: 'staff',
    params: [{ key: 'mode', kind: 'choice', options: ['review', 'issue'], default: 'review' }],
    note: false,
    staffPermission: 'ISSUE_CERTIFICATES',
    adminPresets: ['ACADEMIC'],
    recommended: false,
  },
  { type: 'CERT_ALMOST', group: 'certificates', audience: 'student', params: [int('days', 'days', 1, 30, 7)], note: true, recommended: false },
  // ---- feedback
  {
    type: 'LOW_RATING',
    group: 'feedback',
    audience: 'staff',
    params: [int('rating', 'ratings', 1, 3, 2)],
    note: false,
    staffPermission: 'VIEW_FEEDBACK',
    adminPresets: ['ACADEMIC'],
    recommended: true,
  },
  {
    type: 'AVERAGE_DROP',
    group: 'feedback',
    audience: 'staff',
    params: [{ key: 'average', kind: 'rating', min: 1, max: 5, default: 3.5 }, int('minRatings', 'ratings', 3, 50, 5)],
    note: false,
    staffPermission: 'VIEW_FEEDBACK',
    adminPresets: ['ACADEMIC'],
    recommended: false,
  },
  { type: 'FEEDBACK_NUDGE', group: 'feedback', audience: 'student', params: [int('hours', 'hours', 24, 120, 48)], note: false, recommended: false },
  // ---- admissions, seats and payments
  {
    type: 'PAYMENT_REMINDER',
    group: 'admissions',
    audience: 'both',
    params: [int('firstDays', 'days', 1, 14, 3), int('secondDays', 'days', 2, 30, 7)],
    note: true,
    staffPermission: 'MANAGE_APPLICATIONS',
    adminPresets: ['ADMISSIONS'],
    recommended: true,
  },
  {
    type: 'SEAT_OPEN_WAITLIST',
    group: 'admissions',
    audience: 'staff',
    params: [],
    note: false,
    staffPermission: 'MANAGE_APPLICATIONS',
    adminPresets: ['ADMISSIONS'],
    recommended: false,
  },
  {
    type: 'APPLICATION_IDLE',
    group: 'admissions',
    audience: 'staff',
    params: [int('days', 'days', 1, 30, 5)],
    note: false,
    staffPermission: 'MANAGE_APPLICATIONS',
    adminPresets: ['ADMISSIONS'],
    recommended: false,
  },
  {
    type: 'CAPACITY',
    group: 'admissions',
    audience: 'staff',
    params: [int('percent', 'percent', 50, 99, 80)],
    note: false,
    staffPermission: 'MANAGE_APPLICATIONS',
    adminPresets: ['ADMISSIONS'],
    recommended: false,
  },
  { type: 'PROOF_WAITING', group: 'admissions', audience: 'staff', params: [int('hours', 'hours', 12, 168, 48)], note: false, adminPresets: ['FINANCE'], recommended: false },
  // ---- course operations
  { type: 'WELCOME', group: 'operations', audience: 'student', params: [int('days', 'days', 1, 14, 3)], note: true, recommended: true },
  {
    type: 'NO_LIVE_LINK',
    group: 'operations',
    audience: 'staff',
    params: [int('hours', 'hours', 1, 48, 2)],
    note: false,
    staffPermission: 'MANAGE_SESSIONS',
    adminPresets: ['ACADEMIC'],
    recommended: true,
  },
  {
    type: 'NO_MATERIALS',
    group: 'operations',
    audience: 'staff',
    params: [int('hours', 'hours', 2, 72, 24)],
    note: false,
    staffPermission: 'MANAGE_MATERIALS',
    adminPresets: ['ACADEMIC'],
    recommended: false,
  },
  {
    type: 'NO_RECORDING',
    group: 'operations',
    audience: 'staff',
    params: [int('hours', 'hours', 6, 168, 24)],
    note: false,
    staffPermission: 'MANAGE_MATERIALS',
    adminPresets: ['ACADEMIC'],
    recommended: false,
  },
  { type: 'MIDCOURSE_CHECKIN', group: 'operations', audience: 'student', params: [], note: true, recommended: false },
  { type: 'WRAP_UP', group: 'operations', audience: 'student', params: [], note: true, recommended: false },
  // ---- community
  {
    type: 'COMMUNITY_LINKS',
    group: 'community',
    audience: 'student',
    params: [
      { key: 'telegramUrl', kind: 'url', default: '' },
      { key: 'discordUrl', kind: 'url', default: '' },
    ],
    note: true,
    recommended: false,
  },
  { type: 'TELEGRAM_MISSING', group: 'community', audience: 'student', params: [int('days', 'days', 0, 14, 1)], note: false, recommended: false },
  { type: 'WEEKLY_SUMMARY', group: 'community', audience: 'student', params: [], note: false, recommended: false },
] as const satisfies readonly AutomationRuleDef[];

export type AutomationRuleType = (typeof AUTOMATION_RULES)[number]['type'];
export const AUTOMATION_RULE_TYPES = AUTOMATION_RULES.map((r) => r.type) as AutomationRuleType[];

export function automationRule(type: string): AutomationRuleDef | undefined {
  return (AUTOMATION_RULES as readonly AutomationRuleDef[]).find((r) => r.type === type);
}

export type AutomationParams = Record<string, number | string>;

/** The rule's settings with every missing or invalid value replaced by its default. */
export function automationParams(def: AutomationRuleDef, stored: unknown): AutomationParams {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out: AutomationParams = {};
  for (const p of def.params) {
    const v = raw[p.key];
    if (p.kind === 'int') out[p.key] = typeof v === 'number' && Number.isInteger(v) && v >= p.min && v <= p.max ? v : p.default;
    else if (p.kind === 'rating') out[p.key] = typeof v === 'number' && v >= p.min && v <= p.max ? Math.round(v * 10) / 10 : p.default;
    else if (p.kind === 'choice') out[p.key] = typeof v === 'string' && p.options.includes(v) ? v : p.default;
    else out[p.key] = typeof v === 'string' ? v : p.default;
  }
  return out;
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Use a full https:// link');

/** Saving one rule: on/off, its settings (checked against the catalog) and the optional note. */
export function automationRuleSchema(def: AutomationRuleDef) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of def.params) {
    if (p.kind === 'int') shape[p.key] = z.coerce.number().int().min(p.min).max(p.max);
    else if (p.kind === 'rating') shape[p.key] = z.coerce.number().min(p.min).max(p.max);
    else if (p.kind === 'choice') shape[p.key] = z.enum(p.options as [string, ...string[]]);
    else shape[p.key] = httpsUrl;
  }
  return z
    .object({
      enabled: z.boolean(),
      params: z.object(shape).strict().default({}),
      noteEn: z.string().trim().max(500).default(''),
      noteAr: z.string().trim().max(500).default(''),
    })
    .superRefine((v, ctx) => {
      if (def.type === 'PAYMENT_REMINDER' && Number(v.params.secondDays) <= Number(v.params.firstDays)) {
        ctx.addIssue({ code: 'custom', path: ['params', 'secondDays'], message: 'The second reminder must come after the first' });
      }
    });
}
export type AutomationRuleInput = z.infer<ReturnType<typeof automationRuleSchema>>;

export const automationPauseSchema = z.object({ paused: z.boolean() });

export interface AutomationRuleDto {
  type: AutomationRuleType;
  group: AutomationGroup;
  audience: AutomationAudience;
  enabled: boolean;
  params: AutomationParams;
  noteEn: string;
  noteAr: string;
  recommended: boolean;
  /** Times it acted, ever and in the last 7 days. */
  fired: number;
  firedThisWeek: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AutomationOverviewDto {
  paused: boolean;
  /** Rules run only while the course is Open, Closed or Completed (within 30 days of its end). */
  courseActive: boolean;
  rules: AutomationRuleDto[];
  /** Students the at-risk rules flagged in the last 14 days. */
  atRisk: { userId: string; name: string | null; email: string; reason: AutomationRuleType; at: string }[];
}

export interface AutomationPreviewDto {
  /** Who it would act for if it ran now (already-handled cases excluded). */
  count: number;
  /** Up to 20 of them, by name; team alerts list what the alert is about. */
  sample: string[];
}

export interface AutomationLogEntryDto {
  id: string;
  type: AutomationRuleType;
  /** A student's name, or what a team alert was about. */
  subject: string;
  actions: string[];
  at: string;
}
