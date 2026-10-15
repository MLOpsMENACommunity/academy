import { z } from 'zod';
import {
  AREAS,
  CLOUD_PLATFORMS,
  EDUCATION_LEVELS,
  EMPLOYMENT_STATUSES,
  EXPERIENCE_RANGES,
  INDUSTRIES,
  LEARNING_FORMATS,
  LEARNING_GOALS,
  LOCALES,
  REFERRAL_SOURCES,
  SENIORITIES,
  SESSION_TIMES,
  SKILLS,
  TOPICS,
  WEEKLY_HOURS,
  type Skill,
} from './enums';
import { ALL_COUNTRIES } from './countries';
import { withCrossChecks } from './cross-checks';
import { isValidTimezone } from './time';

// ------------------------------------------------------------------ helpers

const text = (max = 200) => z.string().trim().max(max);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Required profile link on one site, e.g. linkedin.com or github.com. */
const requiredProfileUrl = (host: string) =>
  z
    .string({ required_error: 'Required' })
    .trim()
    .min(1, 'Required')
    .max(300)
    .refine((v) => /^https:\/\/[^\s]+\.[^\s]+/i.test(v), { message: 'Enter a full URL starting with https://' })
    .refine((v) => {
      // https, no credentials, the right site, and a profile path (not just the home page).
      try {
        const u = new URL(v);
        const h = u.hostname.toLowerCase();
        return (
          u.protocol === 'https:' && !u.username && !u.password && !v.includes('\\') &&
          (h === host || h.endsWith(`.${host}`)) && u.pathname.replace(/\/+$/, '').length > 1
        );
      } catch {
        return false;
      }
    }, { message: `Enter your ${host} profile link` })
    .transform((v) => new URL(v).href);

/** Arabic-Indic and Persian digits, as typed on Arabic keyboards, to ASCII. */
function asciiDigits(v: string): string {
  return v.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/**
 * Local mobile formats we accept when the student's country is known, and the
 * country code that replaces the leading trunk 0 (01001234567 → +201001234567).
 */
const LOCAL_MOBILE: Record<string, { local: RegExp; code: string }> = {
  EG: { local: /^01[0125]\d{8}$/, code: '20' },
  SA: { local: /^05\d{8}$/, code: '966' },
  AE: { local: /^05\d{8}$/, code: '971' },
};

/**
 * Normalises a phone number towards E.164: strips spaces, dashes, dots and
 * brackets, turns a 00 prefix into +, and, for Egypt, Saudi Arabia and the UAE,
 * turns a local mobile number (or one with the trunk 0 kept after the country
 * code, e.g. +2001001234567) into international format. Anything else is
 * returned cleaned but otherwise unchanged, for the schema to judge.
 */
export function normalizePhone(raw: string, country?: string | null): string {
  let v = asciiDigits(raw.trim()).replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  const rule = country ? LOCAL_MOBILE[country] : undefined;
  if (rule) {
    if (rule.local.test(v)) return `+${rule.code}${v.slice(1)}`;
    const trunk = `+${rule.code}0`;
    if (v.startsWith(trunk) && rule.local.test(v.slice(trunk.length - 1))) return `+${rule.code}${v.slice(trunk.length)}`;
  }
  return v;
}

/** E.164-ish: + then 8–15 digits. Spaces and dashes are stripped first. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => normalizePhone(v))
  .refine((v) => /^\+[1-9]\d{7,14}$/.test(v), {
    message: 'Use international format with country code, e.g. +201001234567',
  });

const unique = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .default([])
    .transform((arr) => Array.from(new Set(arr)));

// ------------------------------------------------------------------ sections

/** A local number (e.g. 01001234567 in Egypt) is accepted and stored in international format. */
function normalizeCorePhone(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  return typeof o.phone === 'string' ? { ...o, phone: normalizePhone(o.phone, typeof o.country === 'string' ? o.country : null) } : o;
}

const coreFields = z.object({
  fullNameEn: text(120).min(2, 'Enter your full name'),
  fullNameAr: optionalText(120),
  phone: phoneSchema,
  country: z.enum(ALL_COUNTRIES, { errorMap: () => ({ message: 'Choose your country' }) }),
  city: text(80).min(1, 'Enter your city'),
  timezone: z.string().refine(isValidTimezone, { message: 'Choose a valid timezone' }),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
  jobTitle: text(120).min(1, 'Enter your current job title (or "Student")'),
  experienceYears: z.enum(EXPERIENCE_RANGES),
  primaryArea: z.enum(AREAS),
  googleEmail: z.string().trim().toLowerCase().email('Enter a valid Google account email').max(254),
  preferredLanguage: z.enum(LOCALES),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms and Privacy Policy' }),
  }),
});
/** Required before applying to any course. */
export const coreSectionSchema = z.preprocess(normalizeCorePhone, coreFields);
export type CoreSection = z.infer<typeof coreSectionSchema>;

/** Required (no skip): admins screen and filter applicants on these. Industry is optional. */
export const professionalSectionSchema = z.object({
  company: optionalText(120),
  industry: z.enum(INDUSTRIES).nullish(),
  mlExperienceYears: z.enum(EXPERIENCE_RANGES),
  seniority: z.enum(SENIORITIES),
  secondaryAreas: unique(z.enum(AREAS), AREAS.length),
});
export type ProfessionalSection = z.infer<typeof professionalSectionSchema>;

/**
 * Required (no skip): only the highest degree is asked. Field of study, university,
 * graduation year and "currently studying" are no longer asked; their saved values
 * stay in the database (and admin views) and saving this step leaves them as they are.
 */
export const educationSectionSchema = z.object({
  educationLevel: z.enum(EDUCATION_LEVELS),
});
export type EducationSection = z.infer<typeof educationSectionSchema>;

/** Longest tool name the tag input accepts (shown to the student, never cut silently). */
export const PRODUCTION_TOOL_MAX_LENGTH = 40;

export const skillLevelSchema = z.number().int().min(1).max(5);
export const skillsSectionSchema = z.object({
  /** Missing skill = not rated. */
  skills: z.record(z.enum(SKILLS), skillLevelSchema).default({}),
  cloudPlatforms: unique(z.enum(CLOUD_PLATFORMS), CLOUD_PLATFORMS.length),
  productionTools: unique(text(PRODUCTION_TOOL_MAX_LENGTH).min(1), 30),
});
export type SkillsSection = z.infer<typeof skillsSectionSchema>;

export const goalsSectionSchema = z.object({
  learningGoals: unique(z.enum(LEARNING_GOALS), LEARNING_GOALS.length),
  interestedTopics: unique(z.enum(TOPICS), TOPICS.length),
  weeklyHours: z.enum(WEEKLY_HOURS).nullish(),
  preferredTimes: unique(z.enum(SESSION_TIMES), SESSION_TIMES.length),
  preferredFormat: z.enum(LEARNING_FORMATS).nullish(),
});
export type GoalsSection = z.infer<typeof goalsSectionSchema>;

/**
 * Required: LinkedIn and GitHub only. Website, Kaggle, Hugging Face and the CV upload are
 * no longer asked; saved values are kept (admins still see them) and left untouched here.
 */
export const linksSectionSchema = z.object({
  linkedinUrl: requiredProfileUrl('linkedin.com'),
  githubUrl: requiredProfileUrl('github.com'),
});
export type LinksSection = z.infer<typeof linksSectionSchema>;

// ------------------------------------------------------------------ community chat usernames

export const TELEGRAM_USERNAME_MESSAGE = 'Enter your Telegram username: 5–32 letters, digits or _';
export const DISCORD_USERNAME_MESSAGE = 'Enter your Discord username: 2–32 lowercase letters, digits, _ or .';

/**
 * A Telegram username as people type it ("@layla_ml" or "layla_ml"), stored without the @:
 * 5–32 letters, digits and underscores. Null when it isn't one.
 */
export function normalizeTelegramUsername(value: string): string | null {
  const v = value.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{5,32}$/.test(v) ? v : null;
}

/**
 * A Discord username: the current kind (2–32 lowercase letters, digits, "_" and ".", never two
 * dots in a row; typed capitals are lowered, as Discord does) or a legacy "name#1234". A leading
 * @ is dropped. Null when it isn't one.
 */
export function normalizeDiscordUsername(value: string): string | null {
  const v = value.trim().replace(/^@/, '');
  const legacy = /^([^@#:`]{2,32})#(\d{4})$/.exec(v);
  if (legacy) return legacy[1]!.trim().length >= 2 ? `${legacy[1]!.trim()}#${legacy[2]}` : null;
  const lower = v.toLowerCase();
  return /^[a-z0-9_.]{2,32}$/.test(lower) && !lower.includes('..') ? lower : null;
}

const handleSchema = (normalize: (v: string) => string | null, message: string) =>
  z
    .string({ required_error: 'Required', invalid_type_error: 'Required' })
    .trim()
    .min(1, 'Required')
    .max(40)
    .refine((v) => normalize(v) !== null, { message })
    .transform((v) => normalize(v)!);

export const telegramUsernameSchema = handleSchema(normalizeTelegramUsername, TELEGRAM_USERNAME_MESSAGE);
export const discordUsernameSchema = handleSchema(normalizeDiscordUsername, DISCORD_USERNAME_MESSAGE);

/**
 * Admins correct or clear them (empty clears); left out, the saved value stays (a client that
 * doesn't know these fields never clears them). Students from before they were asked have none.
 */
const optionalHandle = (normalize: (v: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .refine((v) => v == null || normalize(v) !== null, { message })
    .transform((v) => (v == null ? v : normalize(v)!));

/** The Telegram and Discord usernames, asked in the community step and needed to apply. */
export const COMMUNITY_HANDLE_FIELDS = ['telegramUsername', 'discordUsername'] as const;

/**
 * Whether the student still has to add their Telegram or Discord username. Students who joined
 * before these were asked keep everything they have; they only need them for their next application.
 */
export function missingCommunityHandles(p: Partial<Pick<ProfileDto, 'telegramUsername' | 'discordUsername'>> | null | undefined): boolean {
  return !p?.telegramUsername || !p?.discordUsername;
}

/**
 * Required: every question needs an explicit answer. Yes/No, never pre-ticked (consent stays a free choice).
 * "Open to job opportunities" and "Share my profile with hiring partners" are no longer asked:
 * their saved answers stay in the database (admins still see them) and saving this step
 * leaves them as they are (unknown keys are dropped by the schema).
 */
export const communitySectionSchema = z.object({
  referralSource: z.enum(REFERRAL_SOURCES),
  communityMember: z.boolean(),
  marketingEmails: z.boolean(),
  telegramUsername: telegramUsernameSchema,
  discordUsername: discordUsernameSchema,
});
export type CommunitySection = z.infer<typeof communitySectionSchema>;

/** Required steps first, then the optional ones (onboarding relies on this order). */
export const PROFILE_SECTIONS = [
  'core',
  'professional',
  'education',
  'links',
  'community',
  'skills',
  'goals',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Steps every student must complete (no "skip") before applying. */
export const REQUIRED_SECTIONS = ['core', 'professional', 'education', 'links', 'community'] as const satisfies readonly ProfileSection[];
export const isRequiredSection = (s: ProfileSection): boolean => (REQUIRED_SECTIONS as readonly string[]).includes(s);

export const profileSectionSchemas = {
  core: coreSectionSchema,
  professional: professionalSectionSchema,
  education: educationSectionSchema,
  skills: skillsSectionSchema,
  goals: goalsSectionSchema,
  links: linksSectionSchema,
  community: communitySectionSchema,
} as const satisfies Record<ProfileSection, z.ZodTypeAny>;

// ------------------------------------------------------------------ cross-section checks

export const ML_EXPERIENCE_MESSAGE = "ML/AI experience can't be more than your total professional experience";

/** True when both are known and the ML/AI range is above the total range (e.g. 5–10 years of ML in 1–3 years overall). */
export function mlExperienceExceedsTotal(total: string | null | undefined, ml: string | null | undefined): boolean {
  const t = EXPERIENCE_RANGES.indexOf(total as (typeof EXPERIENCE_RANGES)[number]);
  const m = EXPERIENCE_RANGES.indexOf(ml as (typeof EXPERIENCE_RANGES)[number]);
  return t >= 0 && m >= 0 && m > t;
}

/** The profile fields the cross-section checks read. */
export type SavedProfileFacts = Partial<Pick<ProfileDto, 'experienceYears' | 'mlExperienceYears' | 'primaryArea'>> | null | undefined;

/**
 * A section's schema plus the checks that need another section's saved answer:
 * ML/AI experience can't exceed total experience (whichever side is being
 * saved), and the primary area is never also a secondary area. Used by the
 * form and by the API, so both reject the same input.
 */
export function sectionSchemaFor(section: ProfileSection, saved: SavedProfileFacts): z.ZodTypeAny {
  if (section === 'professional') {
    return withCrossChecks(professionalSectionSchema, (raw, addIssue) => {
      if (mlExperienceExceedsTotal(saved?.experienceYears, raw.mlExperienceYears as string)) {
        addIssue(['mlExperienceYears'], ML_EXPERIENCE_MESSAGE);
      }
    }).transform((d) => ({ ...d, secondaryAreas: d.secondaryAreas.filter((a) => a !== saved?.primaryArea) }));
  }
  if (section === 'core') return coreWithChecks(coreSectionSchema, saved);
  return profileSectionSchemas[section];
}

function coreWithChecks(schema: z.ZodTypeAny, saved: SavedProfileFacts): z.ZodTypeAny {
  return withCrossChecks(schema, (raw, addIssue) => {
    if (mlExperienceExceedsTotal(raw.experienceYears as string, saved?.mlExperienceYears)) {
      addIssue(['experienceYears'], ML_EXPERIENCE_MESSAGE);
    }
  });
}

// ------------------------------------------------------------------ admin edits

/**
 * What an admin edits on Admin → Students → {student}: the student's own steps, with the same
 * validation, plus "other" (answers the profile no longer asks, kept for admins). Required
 * fields stay required; optional ones can be cleared.
 */
export const ADMIN_PROFILE_SECTIONS = [...PROFILE_SECTIONS, 'other'] as const;
export type AdminProfileSection = (typeof ADMIN_PROFILE_SECTIONS)[number];

/** The core step without "I accept the Terms": only the student can accept them. */
export const adminCoreSectionSchema = z.preprocess(normalizeCorePhone, coreFields.omit({ acceptTerms: true }));

const optionalLink = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), { message: 'Enter a full URL starting with https://' });

/**
 * Answers the profile no longer asks. Admins can correct or clear them. The two hiring
 * answers can only be turned off by an admin (a student's consent is never given for them;
 * the API checks this against the saved value).
 */
export const adminOtherSectionSchema = z.object({
  websiteUrl: optionalLink,
  kaggleUrl: optionalLink,
  huggingfaceUrl: optionalLink,
  fieldOfStudy: optionalText(120),
  university: optionalText(160),
  graduationYear: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1950).max(2100).nullable()),
  openToOpportunities: z.boolean(),
  shareWithPartners: z.boolean(),
});
export type AdminOtherSection = z.infer<typeof adminOtherSectionSchema>;

/** The schema an admin save of `section` is checked against (same cross-checks as the student's). */
/** The community step for an admin: the chat usernames can be corrected or cleared, not required. */
export const adminCommunitySectionSchema = communitySectionSchema.extend({
  telegramUsername: optionalHandle(normalizeTelegramUsername, TELEGRAM_USERNAME_MESSAGE),
  discordUsername: optionalHandle(normalizeDiscordUsername, DISCORD_USERNAME_MESSAGE),
});

export function adminSectionSchemaFor(section: AdminProfileSection, saved: SavedProfileFacts): z.ZodTypeAny {
  if (section === 'other') return adminOtherSectionSchema;
  if (section === 'community') return adminCommunitySectionSchema;
  if (section === 'core') return coreWithChecks(adminCoreSectionSchema, saved);
  return sectionSchemaFor(section, saved);
}

/** Consents only the student can give: an admin may turn them off, never on. */
export const STUDENT_ONLY_CONSENTS = ['marketingEmails', 'openToOpportunities', 'shareWithPartners'] as const;

// ------------------------------------------------------------------ DTO + completeness

/** Profile as returned by the API (and stored in Application.profileSnapshot). */
export interface ProfileDto {
  fullNameEn: string | null;
  fullNameAr: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  timezone: string | null;
  employmentStatus: string | null;
  jobTitle: string | null;
  experienceYears: string | null;
  primaryArea: string | null;
  googleEmail: string | null;
  preferredLanguage: string | null;
  acceptedTermsAt: string | null;
  company: string | null;
  industry: string | null;
  mlExperienceYears: string | null;
  seniority: string | null;
  secondaryAreas: string[];
  educationLevel: string | null;
  fieldOfStudy: string | null;
  university: string | null;
  graduationYear: number | null;
  currentlyStudying: boolean | null;
  skills: Partial<Record<Skill, number>>;
  cloudPlatforms: string[];
  productionTools: string[];
  learningGoals: string[];
  interestedTopics: string[];
  weeklyHours: string | null;
  preferredTimes: string[];
  preferredFormat: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  websiteUrl: string | null;
  kaggleUrl: string | null;
  huggingfaceUrl: string | null;
  hasCv: boolean;
  cvUploadedAt: string | null;
  referralSource: string | null;
  communityMember: boolean | null;
  openToOpportunities: boolean;
  shareWithPartners: boolean;
  marketingEmails: boolean;
  /** Without the @. Null for students who joined before it was asked. */
  telegramUsername: string | null;
  /** New-style (lowercase) or legacy name#1234. Null for students who joined before it was asked. */
  discordUsername: string | null;
  /** When the community step was last answered; null = its Yes/No questions are still unanswered. */
  communityAnsweredAt: string | null;
  completeness: number;
  coreComplete: boolean;
  updatedAt: string | null;
}

export const CORE_FIELDS = [
  'fullNameEn',
  'phone',
  'country',
  'city',
  'timezone',
  'employmentStatus',
  'jobTitle',
  'experienceYears',
  'primaryArea',
  'googleEmail',
  'preferredLanguage',
  'acceptedTermsAt',
  // Professional background
  'mlExperienceYears',
  'seniority',
  // Education
  'educationLevel',
  // Links
  'linkedinUrl',
  'githubUrl',
  // Community
  'referralSource',
  'communityAnsweredAt',
] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

/** Which onboarding step each required field belongs to. */
export const CORE_FIELD_SECTION: Record<CoreField, (typeof REQUIRED_SECTIONS)[number]> = {
  fullNameEn: 'core',
  phone: 'core',
  country: 'core',
  city: 'core',
  timezone: 'core',
  employmentStatus: 'core',
  jobTitle: 'core',
  experienceYears: 'core',
  primaryArea: 'core',
  googleEmail: 'core',
  preferredLanguage: 'core',
  acceptedTermsAt: 'core',
  mlExperienceYears: 'professional',
  seniority: 'professional',
  educationLevel: 'education',
  linkedinUrl: 'links',
  githubUrl: 'links',
  referralSource: 'community',
  communityAnsweredAt: 'community',
};

/**
 * Optional fields that count toward completeness, grouped by section. Only fields the
 * student can still fill in: fields no longer asked (website, graduation year, …) don't count.
 */
const OPTIONAL_FIELDS: { field: keyof ProfileDto; section: ProfileSection }[] = [
  { field: 'company', section: 'professional' },
  { field: 'industry', section: 'professional' },
  { field: 'secondaryAreas', section: 'professional' },
  { field: 'skills', section: 'skills' },
  { field: 'cloudPlatforms', section: 'skills' },
  { field: 'productionTools', section: 'skills' },
  { field: 'learningGoals', section: 'goals' },
  { field: 'interestedTopics', section: 'goals' },
  { field: 'weeklyHours', section: 'goals' },
  { field: 'preferredTimes', section: 'goals' },
  { field: 'preferredFormat', section: 'goals' },
];

function filled(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

export interface Completeness {
  /** 0–100. Core fields are worth 60%, optional fields 40%. */
  percent: number;
  coreComplete: boolean;
  missingCore: CoreField[];
  /** Sections with at least one empty optional field, to nudge the student. */
  incompleteSections: ProfileSection[];
}

export function computeCompleteness(p: Partial<ProfileDto>): Completeness {
  const missingCore = CORE_FIELDS.filter((f) => !filled(p[f]));
  const coreDone = CORE_FIELDS.length - missingCore.length;
  const optionalDone = OPTIONAL_FIELDS.filter(({ field }) => filled(p[field])).length;
  const percent = Math.round(
    (coreDone / CORE_FIELDS.length) * 60 + (optionalDone / OPTIONAL_FIELDS.length) * 40,
  );
  const incompleteSections = Array.from(
    new Set(OPTIONAL_FIELDS.filter(({ field }) => !filled(p[field])).map(({ section }) => section)),
  );
  return { percent, coreComplete: missingCore.length === 0, missingCore, incompleteSections };
}

/** Students are nudged to review their profile after this many days. */
export const PROFILE_REVIEW_DAYS = 182;
