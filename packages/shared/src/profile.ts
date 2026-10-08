import { z } from 'zod';
import {
  AREAS,
  CLOUD_PLATFORMS,
  COMPANY_SIZES,
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

/** Optional URL; empty string means "cleared". Only http(s) is accepted. */
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), {
    message: 'Enter a full URL starting with https://',
  });

/** E.164-ish: + then 8–15 digits. Spaces and dashes are stripped first. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ''))
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

/** Required before applying to any course. */
export const coreSectionSchema = z.object({
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
export type CoreSection = z.infer<typeof coreSectionSchema>;

export const professionalSectionSchema = z.object({
  company: optionalText(120),
  industry: z.enum(INDUSTRIES).nullish(),
  companySize: z.enum(COMPANY_SIZES).nullish(),
  mlExperienceYears: z.enum(EXPERIENCE_RANGES).nullish(),
  seniority: z.enum(SENIORITIES).nullish(),
  secondaryAreas: unique(z.enum(AREAS), AREAS.length),
});
export type ProfessionalSection = z.infer<typeof professionalSectionSchema>;

const currentYear = new Date().getFullYear();
export const educationSectionSchema = z.object({
  educationLevel: z.enum(EDUCATION_LEVELS).nullish(),
  fieldOfStudy: optionalText(120),
  university: optionalText(160),
  graduationYear: z.coerce
    .number()
    .int()
    .min(1960)
    .max(currentYear + 8)
    .nullish()
    .or(z.literal('').transform(() => null)),
  currentlyStudying: z.boolean().nullish(),
});
export type EducationSection = z.infer<typeof educationSectionSchema>;

export const skillLevelSchema = z.number().int().min(1).max(5);
export const skillsSectionSchema = z.object({
  /** Missing skill = not rated. */
  skills: z.record(z.enum(SKILLS), skillLevelSchema).default({}),
  cloudPlatforms: unique(z.enum(CLOUD_PLATFORMS), CLOUD_PLATFORMS.length),
  productionTools: unique(text(40).min(1), 30),
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

export const linksSectionSchema = z.object({
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  websiteUrl: optionalUrl,
  kaggleUrl: optionalUrl,
  huggingfaceUrl: optionalUrl,
});
export type LinksSection = z.infer<typeof linksSectionSchema>;

export const communitySectionSchema = z.object({
  referralSource: z.enum(REFERRAL_SOURCES).nullish(),
  communityMember: z.boolean().nullish(),
  openToOpportunities: z.boolean().default(false),
  shareWithPartners: z.boolean().default(false),
  marketingEmails: z.boolean().default(false),
});
export type CommunitySection = z.infer<typeof communitySectionSchema>;

export const PROFILE_SECTIONS = [
  'core',
  'professional',
  'education',
  'skills',
  'goals',
  'links',
  'community',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const profileSectionSchemas = {
  core: coreSectionSchema,
  professional: professionalSectionSchema,
  education: educationSectionSchema,
  skills: skillsSectionSchema,
  goals: goalsSectionSchema,
  links: linksSectionSchema,
  community: communitySectionSchema,
} as const satisfies Record<ProfileSection, z.ZodTypeAny>;

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
  companySize: string | null;
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
] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

/** Optional fields that count toward completeness, grouped by section. */
const OPTIONAL_FIELDS: { field: keyof ProfileDto; section: ProfileSection }[] = [
  { field: 'company', section: 'professional' },
  { field: 'industry', section: 'professional' },
  { field: 'mlExperienceYears', section: 'professional' },
  { field: 'seniority', section: 'professional' },
  { field: 'secondaryAreas', section: 'professional' },
  { field: 'educationLevel', section: 'education' },
  { field: 'fieldOfStudy', section: 'education' },
  { field: 'skills', section: 'skills' },
  { field: 'cloudPlatforms', section: 'skills' },
  { field: 'productionTools', section: 'skills' },
  { field: 'learningGoals', section: 'goals' },
  { field: 'interestedTopics', section: 'goals' },
  { field: 'weeklyHours', section: 'goals' },
  { field: 'preferredTimes', section: 'goals' },
  { field: 'preferredFormat', section: 'goals' },
  { field: 'linkedinUrl', section: 'links' },
  { field: 'githubUrl', section: 'links' },
  { field: 'referralSource', section: 'community' },
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
