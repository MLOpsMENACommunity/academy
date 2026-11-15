import { z } from 'zod';
import type { CertificateTag, CourseResults } from './assessments';
import type { CertificateKind } from './enums';

/**
 * Completion certificates: one per student per course, issued by the course team.
 * Pure rules shared by the API, the web app and the tests: the serial format, the
 * course's certificate rule and its eligibility check, and LinkedIn's "Add to profile" link.
 */

// ------------------------------------------------------------------ serials

/** Crockford base32: no I, L, O or U, so a serial read aloud or retyped can't be mistaken. */
export const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SERIAL_RANDOM_LENGTH = 8;
/** e.g. MMA-2026-7KQ4XM2P: the year it was issued, then 40 random bits. */
export const SERIAL_PATTERN = /^MMA-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/;

/** A course's certificate ID prefix: a letter, then up to 9 letters or digits (e.g. MLOPS, K8S). */
export const CERT_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
/**
 * Serials of courses with a prefix: {PREFIX}-{cohort, 2 digits}-{year}-{number, 5+ digits}, e.g.
 * MLOPS-01-2026-00209, the format of the certificates issued before the academy.
 */
export const COURSE_SERIAL_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d{2}-\d{4}-\d{5,}$/;

/** A serial as typed or pasted (lowercase, spaces) in its canonical form, or null if it can't be one. */
export function normalizeSerial(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SERIAL_PATTERN.test(s) || COURSE_SERIAL_PATTERN.test(s) ? s : null;
}

/** e.g. formatCourseSerial('MLOPS', 1, 2026, 209) → MLOPS-01-2026-00209. A missing cohort number is 01. */
export function formatCourseSerial(code: string, cohort: number | null, year: number, n: number): string {
  return `${code}-${String(cohort ?? 1).padStart(2, '0')}-${year}-${String(n).padStart(5, '0')}`;
}

/** Builds a serial from random bytes (at least SERIAL_RANDOM_LENGTH of them; the API passes crypto bytes). */
export function formatSerial(year: number, random: Uint8Array): string {
  if (random.length < SERIAL_RANDOM_LENGTH) throw new Error('Not enough random bytes');
  let body = '';
  // 256 is a multiple of 32, so `byte % 32` is uniform.
  for (let i = 0; i < SERIAL_RANDOM_LENGTH; i++) body += SERIAL_ALPHABET[random[i]! % 32];
  return `MMA-${year}-${body}`;
}

// ------------------------------------------------------------------ the course rule

export interface CertificateRule {
  /** Share of the course's sessions marked complete, 0–100; null: no requirement. */
  minSessionsPercent: number | null;
  /** Every published assessment marked mandatory for the certificate (countsForCertificate) must be passed. */
  requireAssessments: boolean;
  /**
   * Total score, 0–100: points earned ÷ points of every published assessment (work not submitted or
   * not yet graded counts as 0); null: no requirement.
   */
  minTotalPercent: number | null;
  /** Prefix of the course's certificate IDs (MLOPS → MLOPS-01-2026-00001); null: random MMA- serials. */
  codePrefix: string | null;
  /** Optional wording shown to students instead of the generated sentence. */
  textEn: string;
  textAr: string;
}

export const DEFAULT_CERTIFICATE_RULE: CertificateRule = { minSessionsPercent: null, requireAssessments: true, minTotalPercent: null, codePrefix: null, textEn: '', textAr: '' };

/** The course team wrote or configured a rule beyond the defaults. */
export const ruleIsSet = (r: Pick<CertificateRule, 'minSessionsPercent' | 'minTotalPercent' | 'textEn' | 'textAr'>): boolean =>
  r.minSessionsPercent !== null || r.minTotalPercent !== null || Boolean(r.textEn || r.textAr);

/** Whether students see the course's certificate (the learn page's card): it's included, a rule is set, or one was issued. */
export function certificateOffered(rule: CertificateRule, included: { certificate?: boolean } | null | undefined, issued = false): boolean {
  return Boolean(included?.certificate) || ruleIsSet(rule) || issued;
}

/**
 * What students are told about one assessment and the certificate: REQUIRED (mandatory) or
 * OPTIONAL, only when the course offers a certificate whose rule requires assessments; else null
 * (nothing shown). Only wording: eligibility is certificateEligibility.
 */
export function certificateTag(rule: CertificateRule, included: { certificate?: boolean } | null | undefined, countsForCertificate: boolean): CertificateTag | null {
  if (!rule.requireAssessments || !certificateOffered(rule, included)) return null;
  return countsForCertificate ? 'REQUIRED' : 'OPTIONAL';
}

export const certificateRuleSchema = z.object({
  minSessionsPercent: z.number().int().min(1).max(100).nullable(),
  requireAssessments: z.boolean(),
  /** Absent (older clients): no total-score requirement. */
  minTotalPercent: z.number().int().min(1).max(100).nullable().default(null),
  /** Absent or empty: random MMA- serials. Typed in any case. */
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || CERT_CODE_PATTERN.test(v), { message: 'A letter, then up to 9 letters or digits (e.g. MLOPS)' }),
  textEn: z.string().trim().max(500).default(''),
  textAr: z.string().trim().max(500).default(''),
});
export type CertificateRuleInput = z.infer<typeof certificateRuleSchema>;

export type CapstoneState = 'PASSED' | 'PENDING' | 'NOT_PASSED' | 'MISSING';

export interface EligibilityInput {
  sessions: { completed: number; total: number };
  results: Pick<CourseResults, 'assessments' | 'total' | 'certificate'>;
  /** Assessment ids that are course-level labs or assignments counting toward the certificate (the capstone). */
  capstoneIds?: string[];
  /**
   * Self-paced courses need at least one required assessment (watching alone never earns the
   * certificate), and each one passed with at least SELF_PACED_PASS_PERCENT.
   */
  selfPaced?: boolean;
}

export interface Eligibility {
  eligible: boolean;
  sessions: { completed: number; total: number; percent: number; required: number | null; ok: boolean };
  assessments: { required: number; passed: number; pending: number; ok: boolean; needed: boolean };
  /** Average over every published assessment (points earned ÷ points available). */
  averagePercent: number | null;
  /** The total-score requirement: the student's total (null with no published assessment) against the rule. */
  total: { percent: number | null; required: number | null; ok: boolean };
  /** The capstone's state, when the course has one; null otherwise. */
  capstone: CapstoneState | null;
}

/**
 * Self-paced courses: the score every required assessment needs for the Certificate of Attendance,
 * whatever lower pass mark the quiz itself has. Exactly 80% passes.
 */
export const SELF_PACED_PASS_PERCENT = 80;

const percentOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Whether a student meets the course's certificate rule, with each signal for the admin table and the student card. */
export function certificateEligibility(rule: Pick<CertificateRule, 'minSessionsPercent' | 'requireAssessments' | 'minTotalPercent'>, input: EligibilityInput): Eligibility {
  const { completed, total } = input.sessions;
  const percent = percentOf(completed, total);
  const sessionsOk = rule.minSessionsPercent === null || (total > 0 && percent >= rule.minSessionsPercent);
  const required = input.results.assessments.filter((a) => a.countsForCertificate);
  const pending = required.filter((a) => !a.passed && a.pending).length;
  // Self-paced: each required assessment also needs SELF_PACED_PASS_PERCENT (the quiz's own pass mark can be lower).
  const passed = input.selfPaced ? required.filter((a) => a.passed && a.percent !== null && a.percent + 1e-9 >= SELF_PACED_PASS_PERCENT).length : input.results.certificate.passed;
  const allPassed = input.selfPaced ? passed === required.length : input.results.certificate.allPassed;
  const assessmentsOk = (!rule.requireAssessments || allPassed) && !(input.selfPaced && required.length === 0);
  const totalPercent = input.results.total.possible ? input.results.total.percent : null;
  // Exactly the threshold passes; a course with no published assessment can't meet a total requirement.
  const totalOk = rule.minTotalPercent === null || (totalPercent !== null && totalPercent + 1e-9 >= rule.minTotalPercent);
  const capstones = required.filter((a) => (input.capstoneIds ?? []).includes(a.assessmentId));
  const capstone: CapstoneState | null = !capstones.length
    ? null
    : capstones.every((a) => a.passed)
      ? 'PASSED'
      : capstones.some((a) => !a.passed && a.pending)
        ? 'PENDING'
        : capstones.some((a) => a.attempts > 0)
          ? 'NOT_PASSED'
          : 'MISSING';
  return {
    eligible: sessionsOk && assessmentsOk && totalOk,
    sessions: { completed, total, percent, required: rule.minSessionsPercent, ok: sessionsOk },
    assessments: { required: input.results.certificate.required, passed, pending, ok: assessmentsOk, needed: rule.requireAssessments },
    averagePercent: totalPercent,
    total: { percent: totalPercent, required: rule.minTotalPercent, ok: totalOk },
    capstone,
  };
}

/** The rule as one sentence, when the course team didn't write their own. */
export function describeRule(rule: CertificateRule, locale: 'en' | 'ar'): string {
  const own = locale === 'ar' ? rule.textAr || rule.textEn : rule.textEn || rule.textAr;
  if (own) return own;
  const parts: string[] = [];
  if (rule.requireAssessments) parts.push(locale === 'ar' ? 'اجتياز كل التقييمات المطلوبة للشهادة' : 'pass every assessment required for the certificate');
  if (rule.minTotalPercent !== null)
    parts.push(locale === 'ar' ? `الحصول على ${rule.minTotalPercent}٪ على الأقل من مجموع درجات الدورة` : `score at least ${rule.minTotalPercent}% of the course's total points`);
  if (rule.minSessionsPercent !== null)
    parts.push(locale === 'ar' ? `إكمال ${rule.minSessionsPercent}٪ على الأقل من الجلسات` : `complete at least ${rule.minSessionsPercent}% of the sessions`);
  if (!parts.length) return locale === 'ar' ? 'يصدر فريق الدورة الشهادة عند إتمامها.' : 'The course team issues the certificate when you complete the course.';
  const joined = parts.join(locale === 'ar' ? ' و' : ' and ');
  return locale === 'ar' ? `للحصول على الشهادة: ${joined}.` : `To earn the certificate, ${joined}.`;
}

// ------------------------------------------------------------------ admin input

export const MAX_BULK_CERTIFICATES = 500;

export const issueCertificatesSchema = z.object({
  userIds: z.array(z.string().min(1).max(40)).min(1).max(MAX_BULK_CERTIFICATES),
  grade: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  /** Issue even to students who don't meet the rule (the admin confirmed). */
  force: z.boolean().default(false),
});
export type IssueCertificatesInput = z.infer<typeof issueCertificatesSchema>;

export const revokeCertificateSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>;

export const reissueCertificateSchema = z.object({
  /** Absent: keep the certificate's grade. Null or '': clear it. */
  grade: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

// ------------------------------------------------------------------ DTOs

export type CertificateStatus = 'VALID' | 'REVOKED';

export interface InstructorName {
  name: string;
  nameAr: string | null;
  /** Professional title, printed under the name on the certificate (snapshots since the template design). */
  title?: string | null;
}

export interface AdminCertificateSummary {
  id: string;
  serial: string;
  issuedAt: string;
  grade: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface CertificateRosterRow {
  userId: string;
  name: string | null;
  email: string;
  enrolledAt: string;
  eligibility: Eligibility;
  certificate: AdminCertificateSummary | null;
}

export interface CertificateRosterDto {
  rule: CertificateRule;
  rows: CertificateRosterRow[];
  counts: { enrolled: number; eligible: number; issued: number; revoked: number };
}

/** NO_NAME: the student's profile has no name to print. */
export type IssueOutcome = 'ISSUED' | 'ALREADY_ISSUED' | 'REVOKED' | 'NOT_ENROLLED' | 'NO_NAME';
export interface IssueResultDto {
  results: { userId: string; outcome: IssueOutcome; serial?: string }[];
  issued: number;
}

/** A student's own certificate (dashboard, learn page). */
export interface MyCertificateDto {
  id: string;
  serial: string;
  status: CertificateStatus;
  issuedAt: string;
  grade: string | null;
  /** Null for a certificate issued before the academy (no course page here). */
  courseSlug: string | null;
  courseTitleEn: string;
  courseTitleAr: string;
  nameOnCertificate: string;
  /** Whether a PDF can be downloaded (certificates issued before the academy have none here). */
  pdf: boolean;
}

/** The learn page's "How to earn the certificate" card. */
export interface LearnCertificateDto {
  /** Whether the course awards a certificate at all (shows the card). */
  offered: boolean;
  /** Self-paced: the certificate is issued automatically once the rule is met. */
  selfPaced: boolean;
  rule: CertificateRule;
  eligibility: Eligibility;
  certificate: MyCertificateDto | null;
}

/** The public verification page. Deleted accounts show nothing but the status. */
export type PublicCertificateDto =
  | { status: 'UNAVAILABLE'; serial: string }
  | {
      status: CertificateStatus;
      kind: CertificateKind;
      serial: string;
      name: string;
      nameAr: string | null;
      /** Null for a certificate issued before the academy (no course page here). */
      courseSlug: string | null;
      courseTitleEn: string;
      courseTitleAr: string;
      instructors: InstructorName[];
      issuedAt: string;
      grade: string | null;
      revokedAt: string | null;
      /** Whether the PDF can be downloaded (certificates issued before the academy have none here). */
      pdf: boolean;
    };

// ------------------------------------------------------------------ LinkedIn

export const CERTIFICATE_ORGANIZATION = 'MLOps MENA Community';
/**
 * The MLOps MENA Company Page on LinkedIn (the number in its admin URL). With the id, the
 * certificate on a profile shows the community's logo and links to the page; LinkedIn takes
 * either organizationId or organizationName, never both. Same id as mlopsmena.com uses.
 */
export const CERTIFICATE_LINKEDIN_ORG_ID = '130374975';

/** Year and month (1–12) of a date in Cairo time, the academy's calendar. */
function cairoYearMonth(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'numeric' }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month') };
}

/**
 * LinkedIn's "Add licence or certification" link (the Add to Profile generator,
 * addtoprofile.linkedin.com): https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME
 * &name=…&organizationId=…&issueYear=…&issueMonth=…&certUrl=…&certId=…  (issueMonth is 1–12,
 * in Cairo time like every other date the academy shows).
 */
export function linkedInAddUrl(c: { courseTitle: string; issuedAt: string | Date; verifyUrl: string; serial: string }): string {
  const { year, month } = cairoYearMonth(new Date(c.issuedAt));
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: c.courseTitle,
    organizationId: CERTIFICATE_LINKEDIN_ORG_ID,
    issueYear: String(year),
    issueMonth: String(month),
    certUrl: c.verifyUrl,
    certId: c.serial,
  });
  // URLSearchParams writes spaces as "+": LinkedIn's own generator uses %20.
  return `https://www.linkedin.com/profile/add?${params.toString().replace(/\+/g, '%20')}`;
}

/** The public verification page's path (without the site origin). */
export const certificatePath = (locale: 'en' | 'ar', serial: string) => `/${locale}/certificates/${serial}`;
