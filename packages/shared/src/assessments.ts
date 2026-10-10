import { z } from 'zod';
import {
  ASSESSMENT_STATUSES,
  ASSESSMENT_TYPES,
  QUIZ_QUESTION_KINDS,
  REVEAL_POLICIES,
  SCORING_POLICIES,
  SUBMISSION_KINDS,
  type AssessmentStatus,
  type AssessmentType,
  type QuizQuestionKind,
  type RepoCheck,
  type RevealPolicy,
  type ScoringPolicy,
  type SubmissionKind,
} from './enums';

/**
 * Assessments: quizzes (auto-graded on the server), labs and assignments
 * (graded by the course team). The rules here are pure so the API, the web
 * app and the tests all use the same ones.
 */

// ------------------------------------------------------------------ limits

export const MAX_QUESTIONS = 100;
export const MAX_OPTIONS = 10;
/** Seconds a quiz answer may arrive after the time limit (network, clock drift). */
export const QUIZ_GRACE_SECONDS = 30;

// ------------------------------------------------------------------ URLs

/**
 * `https://github.com/<owner>/<repo>` (www., a trailing slash, `.git` and deeper
 * paths such as /tree/main are tolerated) → `{ owner, repo }`; anything else → null.
 */
export function parseGithubRepoUrl(value: string): { owner: string; repo: string } | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const [owner, rawRepo] = u.pathname.split('/').filter(Boolean);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, '');
  // GitHub's own rules: owners are alphanumeric with single inner dashes (≤39); repos [\w.-] (≤100).
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(owner)) return null;
  if (!/^[\w.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** The canonical form of a GitHub repository link. */
export function githubRepoUrl(r: { owner: string; repo: string }): string {
  return `https://github.com/${r.owner}/${r.repo}`;
}

/** A Google Drive or Docs link (https). Sharing can't be checked without the owner's sign-in. */
export function isDriveUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'drive.google.com' || u.hostname === 'docs.google.com');
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ scoring

export interface GradableOption {
  id: string;
  correct: boolean;
}
export interface GradableQuestion {
  id: string;
  kind: QuizQuestionKind;
  weight: number;
  options: GradableOption[];
}
/** { [questionId]: optionId[] } */
export type QuizAnswers = Record<string, string[]>;

export interface QuizGrade {
  /** Points out of `maxPoints`, rounded to 2 decimals. */
  score: number;
  earnedWeight: number;
  totalWeight: number;
  /** Per question: was it answered exactly right. */
  correct: Record<string, boolean>;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * score = (sum of the weights of correctly answered questions ÷ total weight) × maxPoints.
 * A question is right only when the chosen options are exactly the correct ones, so a
 * multiple-choice question is all-or-nothing. Unknown option ids never count.
 */
export function gradeQuiz(questions: GradableQuestion[], answers: QuizAnswers, maxPoints: number): QuizGrade {
  let earned = 0;
  let total = 0;
  const correct: Record<string, boolean> = {};
  for (const q of questions) {
    total += q.weight;
    const chosen = new Set(answers[q.id] ?? []);
    const right = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
    const ok = right.size > 0 && chosen.size === right.size && [...chosen].every((id) => right.has(id));
    correct[q.id] = ok;
    if (ok) earned += q.weight;
  }
  return { score: total > 0 ? round2((earned / total) * maxPoints) : 0, earnedWeight: earned, totalWeight: total, correct };
}

export function percentOf(score: number | null, max: number): number | null {
  if (score === null || max <= 0) return null;
  return Math.round((score / max) * 1000) / 10;
}

export function hasPassed(score: number | null, max: number, passPercent: number): boolean {
  const p = percentOf(score, max);
  return p !== null && p + 1e-9 >= passPercent;
}

export interface ScoredAttempt {
  attempt: number;
  submittedAt: Date | string | null;
  score: number | null;
}

/** The attempt that counts: the highest graded score (BEST) or the latest graded attempt (LAST). */
export function countedAttempt<T extends ScoredAttempt>(attempts: T[], policy: ScoringPolicy): T | null {
  const graded = attempts.filter((a) => a.submittedAt !== null && a.score !== null);
  if (!graded.length) return null;
  if (policy === 'LAST') return graded.reduce((a, b) => (b.attempt > a.attempt ? b : a));
  return graded.reduce((a, b) => (b.score! > a.score! || (b.score === a.score && b.attempt < a.attempt) ? b : a));
}

// ------------------------------------------------------------------ attempts, due dates, reveal

/** Attempts left; null = unlimited (attemptsAllowed 0). Started attempts count. */
export function attemptsLeft(attemptsAllowed: number, used: number): number | null {
  return attemptsAllowed === 0 ? null : Math.max(0, attemptsAllowed - used);
}

export function isLate(dueAt: Date | string | null | undefined, at: Date): boolean {
  return Boolean(dueAt) && at.getTime() > new Date(dueAt!).getTime();
}

/**
 * May this student see the answer key (correct options and explanations)?
 * - NEVER: no.
 * - AFTER_SUBMIT: once they submitted every allowed attempt (with unlimited
 *   attempts, after each one: a practice quiz).
 * - AFTER_DUE: once they submitted and the due date has passed.
 * Never while an attempt is open.
 */
export function answersRevealed(a: {
  revealAnswers: RevealPolicy;
  attemptsAllowed: number;
  dueAt: Date | string | null;
  submitted: number;
  inProgress: boolean;
  now?: Date;
}): boolean {
  if (a.submitted < 1 || a.inProgress) return false;
  const now = a.now ?? new Date();
  switch (a.revealAnswers) {
    case 'NEVER':
      return false;
    case 'AFTER_SUBMIT':
      return a.attemptsAllowed === 0 || a.submitted >= a.attemptsAllowed;
    case 'AFTER_DUE':
      return Boolean(a.dueAt) && now.getTime() > new Date(a.dueAt!).getTime();
  }
}

/** Why a student can't start (or submit) now; null = they can. */
export type ClosedReason = 'NOT_PUBLISHED' | 'PAST_DUE' | 'NO_ATTEMPTS' | 'ANSWERS_REVEALED' | 'GRADED';

export function quizClosedReason(a: {
  status: AssessmentStatus;
  dueAt: Date | string | null;
  allowLate: boolean;
  attemptsAllowed: number;
  revealAnswers: RevealPolicy;
  /** Attempts started, including one in progress. */
  started: number;
  submitted: number;
  now?: Date;
}): ClosedReason | null {
  const now = a.now ?? new Date();
  if (a.status !== 'PUBLISHED') return 'NOT_PUBLISHED';
  if (!a.allowLate && isLate(a.dueAt, now)) return 'PAST_DUE';
  if (attemptsLeft(a.attemptsAllowed, a.started) === 0) return 'NO_ATTEMPTS';
  // Practice quizzes (unlimited attempts, answers after each one) stay open.
  if (a.revealAnswers === 'AFTER_DUE' && answersRevealed({ ...a, inProgress: false, now })) return 'ANSWERS_REVEALED';
  return null;
}

/**
 * Labs and assignments: students can resubmit until the due date or until graded.
 * After the due date, only a first (late) submission is accepted, when late work is allowed.
 */
export function workClosedReason(a: {
  status: AssessmentStatus;
  dueAt: Date | string | null;
  allowLate: boolean;
  hasSubmission: boolean;
  graded: boolean;
  now?: Date;
}): ClosedReason | null {
  const now = a.now ?? new Date();
  if (a.status !== 'PUBLISHED') return 'NOT_PUBLISHED';
  if (a.graded) return 'GRADED';
  if (isLate(a.dueAt, now) && (!a.allowLate || a.hasSubmission)) return 'PAST_DUE';
  return null;
}

/** Deterministic shuffle (the same order every time for the same seed, e.g. an attempt id). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ------------------------------------------------------------------ results (shared with certificates and points)

export interface ResultAssessment {
  id: string;
  type: AssessmentType;
  titleEn: string;
  titleAr: string;
  maxPoints: number;
  passPercent: number;
  countsForCertificate: boolean;
  scoring: ScoringPolicy;
}
export interface ResultSubmission extends ScoredAttempt {
  late: boolean;
}

export interface AssessmentResult {
  assessmentId: string;
  type: AssessmentType;
  titleEn: string;
  titleAr: string;
  countsForCertificate: boolean;
  maxPoints: number;
  passPercent: number;
  /** Submitted attempts (labs and assignments: 0 or 1). */
  attempts: number;
  /** Highest graded score, if any. */
  best: number | null;
  /** Latest graded score, if any. */
  last: number | null;
  /** The score that counts under the assessment's scoring rule (BEST or LAST). */
  score: number | null;
  percent: number | null;
  passed: boolean;
  /** Submitted but not graded yet. */
  pending: boolean;
  /** The counted (or only) submission arrived after the due date. */
  late: boolean;
}

export interface CourseResults {
  userId: string;
  courseId: string;
  /** Published assessments, in course order. */
  assessments: AssessmentResult[];
  /** Points earned over the points available across published assessments. */
  total: { earned: number; possible: number; percent: number };
  /** Assessments marked "counts toward certificate". */
  certificate: { required: number; passed: number; allPassed: boolean };
}

export function assessmentResult(a: ResultAssessment, submissions: ResultSubmission[]): AssessmentResult {
  const submitted = submissions.filter((s) => s.submittedAt !== null);
  const graded = submitted.filter((s) => s.score !== null);
  const best = graded.length ? Math.max(...graded.map((s) => s.score!)) : null;
  const lastGraded = graded.length ? graded.reduce((x, y) => (y.attempt > x.attempt ? y : x)) : null;
  const counted = countedAttempt(submitted, a.scoring);
  const score = counted?.score ?? null;
  const latest = submitted.length ? submitted.reduce((x, y) => (y.attempt > x.attempt ? y : x)) : null;
  return {
    assessmentId: a.id,
    type: a.type,
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    countsForCertificate: a.countsForCertificate,
    maxPoints: a.maxPoints,
    passPercent: a.passPercent,
    attempts: submitted.length,
    best,
    last: lastGraded?.score ?? null,
    score,
    percent: percentOf(score, a.maxPoints),
    passed: hasPassed(score, a.maxPoints, a.passPercent),
    pending: submitted.some((s) => s.score === null),
    late: (counted ?? latest)?.late ?? false,
  };
}

export function summarizeResults(userId: string, courseId: string, results: AssessmentResult[]): CourseResults {
  const earned = round2(results.reduce((n, r) => n + (r.score ?? 0), 0));
  const possible = results.reduce((n, r) => n + r.maxPoints, 0);
  const required = results.filter((r) => r.countsForCertificate);
  const passed = required.filter((r) => r.passed).length;
  return {
    userId,
    courseId,
    assessments: results,
    total: { earned, possible, percent: possible ? Math.round((earned / possible) * 1000) / 10 : 0 },
    certificate: { required: required.length, passed, allPassed: passed === required.length },
  };
}

// ------------------------------------------------------------------ admin input

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const quizOptionInputSchema = z.object({
  id: z.string().max(40).optional(),
  labelEn: text(500).min(1),
  labelAr: text(500).min(1),
  correct: z.boolean(),
});
export type QuizOptionInput = z.infer<typeof quizOptionInputSchema>;

export const quizQuestionInputSchema = z
  .object({
    id: z.string().max(40).optional(),
    kind: z.enum(QUIZ_QUESTION_KINDS),
    promptEn: text(2000).min(1),
    promptAr: text(2000).min(1),
    weight: z.coerce.number().int().min(1).max(100),
    explanationEn: optionalText(2000),
    explanationAr: optionalText(2000),
    options: z.array(quizOptionInputSchema).min(2).max(MAX_OPTIONS),
  })
  .superRefine((q, ctx) => {
    const right = q.options.filter((o) => o.correct).length;
    if (q.kind === 'TRUE_FALSE' && q.options.length !== 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'A true/false question has exactly two options' });
    }
    if (q.kind === 'MULTIPLE' ? right < 1 : right !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: q.kind === 'MULTIPLE' ? 'Mark at least one correct option' : 'Mark exactly one correct option',
      });
    }
  });
export type QuizQuestionInput = z.infer<typeof quizQuestionInputSchema>;

export const assessmentInputSchema = z
  .object({
    type: z.enum(ASSESSMENT_TYPES),
    status: z.enum(ASSESSMENT_STATUSES).default('DRAFT'),
    sessionId: z
      .string()
      .max(40)
      .nullish()
      .transform((v) => v || null),
    order: z.coerce.number().int().min(0).max(999).default(0),
    titleEn: text(200).min(2),
    titleAr: text(200).min(2),
    instructionsEn: text(20_000).default(''),
    instructionsAr: text(20_000).default(''),
    dueAt: z.coerce.date().nullish().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
    allowLate: z.boolean().default(true),
    maxPoints: z.coerce.number().int().min(1).max(1000).default(100),
    passPercent: z.coerce.number().int().min(0).max(100).default(70),
    countsForCertificate: z.boolean().default(false),
    submissionKind: z.enum(SUBMISSION_KINDS).nullish().transform((v) => v ?? null),
    attemptsAllowed: z.coerce.number().int().min(0).max(20).default(1),
    scoring: z.enum(SCORING_POLICIES).default('BEST'),
    revealAnswers: z.enum(REVEAL_POLICIES).default('AFTER_SUBMIT'),
    timeLimitMin: z.coerce.number().int().min(1).max(600).nullish().transform((v) => v ?? null),
    shuffle: z.boolean().default(false),
    questions: z.array(quizQuestionInputSchema).max(MAX_QUESTIONS).default([]),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'QUIZ') {
      if (a.status === 'PUBLISHED' && a.questions.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Add at least one question before publishing' });
      }
      if (a.revealAnswers === 'AFTER_DUE' && !a.dueAt) {
        ctx.addIssue({ code: 'custom', path: ['dueAt'], message: 'Set a due date to reveal answers after it' });
      }
    } else if (!a.submissionKind) {
      ctx.addIssue({ code: 'custom', path: ['submissionKind'], message: 'Choose how students submit' });
    }
  });
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export type AssessmentInputRaw = z.input<typeof assessmentInputSchema>;

export const gradeInputSchema = z.object({
  score: z.coerce.number().min(0).max(1000),
  feedback: optionalText(5000),
  rubricNotes: optionalText(5000),
});
export type GradeInput = z.infer<typeof gradeInputSchema>;

export const SUBMISSION_FILTERS = ['all', 'submitted', 'graded', 'late', 'missing'] as const;
export type SubmissionFilter = (typeof SUBMISSION_FILTERS)[number];
export const submissionFilterSchema = z.object({ filter: z.enum(SUBMISSION_FILTERS).default('all') });

// ------------------------------------------------------------------ student input

export const quizAnswersSchema = z.object({
  answers: z.record(z.string().max(40), z.array(z.string().max(40)).max(MAX_OPTIONS)).refine((a) => Object.keys(a).length <= MAX_QUESTIONS, 'Too many answers'),
});

/** Link submissions. The server re-checks the URL against the assessment's submission kind. */
export const workSubmissionSchema = z.object({
  url: z.string().trim().max(500).regex(/^https:\/\//i, 'Use an https:// link'),
  /** "My repository is public" / "Sharing is set to 'Anyone with the link can view'". */
  attested: z.boolean().default(false),
  note: optionalText(2000),
});
export type WorkSubmissionInput = z.infer<typeof workSubmissionSchema>;

// ------------------------------------------------------------------ DTOs (student)

export type AssessmentState = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'MISSED';

export interface AssessmentSummaryDto {
  id: string;
  sessionId: string | null;
  type: AssessmentType;
  titleEn: string;
  titleAr: string;
  order: number;
  dueAt: string | null;
  allowLate: boolean;
  maxPoints: number;
  passPercent: number;
  countsForCertificate: boolean;
  submissionKind: SubmissionKind | null;
  attemptsAllowed: number;
  timeLimitMin: number | null;
  questionCount: number;
  state: AssessmentState;
  /** The counted score once graded. */
  score: number | null;
  percent: number | null;
  passed: boolean;
  late: boolean;
  attemptsUsed: number;
  /** Open, not yet submitted and not past a hard due date: counts toward the "due" badge. */
  due: boolean;
}

export interface MySubmissionDto {
  id: string;
  attempt: number;
  startedAt: string;
  submittedAt: string | null;
  late: boolean;
  score: number | null;
  maxScore: number;
  gradedAt: string | null;
  feedback: string | null;
  rubricNotes: string | null;
  url: string | null;
  fileName: string | null;
  hasFile: boolean;
  note: string | null;
  repoCheck: RepoCheck | null;
}

export interface QuizQuestionDto {
  id: string;
  kind: QuizQuestionKind;
  promptEn: string;
  promptAr: string;
  weight: number;
  options: { id: string; labelEn: string; labelAr: string }[];
}

/** An open quiz attempt. Never contains the answer key. */
export interface QuizAttemptDto {
  submissionId: string;
  attempt: number;
  startedAt: string;
  /** When the time limit ends (ISO), or null. */
  deadline: string | null;
  questions: QuizQuestionDto[];
}

export interface QuizReviewDto {
  attempt: number;
  questions: (Omit<QuizQuestionDto, 'options'> & {
    explanationEn: string | null;
    explanationAr: string | null;
    correct: boolean;
    options: { id: string; labelEn: string; labelAr: string; correct: boolean; chosen: boolean }[];
  })[];
}

export interface AssessmentDetailDto extends AssessmentSummaryDto {
  instructionsEn: string;
  instructionsAr: string;
  scoring: ScoringPolicy;
  revealAnswers: RevealPolicy;
  shuffle: boolean;
  attemptsLeft: number | null;
  /** Why the student can't start or submit now; null = open. */
  closed: ClosedReason | null;
  inProgress: QuizAttemptDto | null;
  submissions: MySubmissionDto[];
  /** Only once the reveal rule allows it. */
  review: QuizReviewDto | null;
}

export interface QuizResultDto {
  submissionId: string;
  attempt: number;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  late: boolean;
  attemptsLeft: number | null;
  review: QuizReviewDto | null;
}

// ------------------------------------------------------------------ DTOs (admin)

export interface AdminAssessmentRow {
  id: string;
  sessionId: string | null;
  type: AssessmentType;
  status: AssessmentStatus;
  order: number;
  titleEn: string;
  titleAr: string;
  dueAt: string | null;
  maxPoints: number;
  countsForCertificate: boolean;
  submissionKind: SubmissionKind | null;
  questionCount: number;
  /** Students with a submitted attempt / waiting to be graded. */
  submitted: number;
  toGrade: number;
}

export interface AdminAssessmentDto extends Omit<AssessmentInput, 'dueAt'> {
  id: string;
  courseId: string;
  dueAt: string | null;
  questions: (QuizQuestionInput & { id: string; options: (QuizOptionInput & { id: string })[] })[];
  submissionCount: number;
}

export interface GradebookRow {
  userId: string;
  name: string | null;
  email: string;
  state: 'MISSING' | 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED';
  /** The counted submission (or the latest one). */
  submissionId: string | null;
  attempts: number;
  submittedAt: string | null;
  late: boolean;
  score: number | null;
  maxScore: number;
  repoCheck: RepoCheck | null;
  url: string | null;
  hasFile: boolean;
}

export interface AdminSubmissionDto {
  id: string;
  assessmentId: string;
  type: AssessmentType;
  submissionKind: SubmissionKind | null;
  student: { id: string; name: string | null; email: string };
  attempt: number;
  attempts: { id: string; attempt: number; submittedAt: string | null; score: number | null; late: boolean }[];
  startedAt: string;
  submittedAt: string | null;
  late: boolean;
  url: string | null;
  fileName: string | null;
  hasFile: boolean;
  note: string | null;
  attested: boolean;
  repoCheck: RepoCheck | null;
  score: number | null;
  maxScore: number;
  gradedAt: string | null;
  gradedBy: string | null;
  feedback: string | null;
  rubricNotes: string | null;
  /** Quizzes: each question with the student's choice and the key. */
  review: QuizReviewDto | null;
}
