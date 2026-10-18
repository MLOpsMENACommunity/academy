import { z } from 'zod';
import { assessmentInputSchema, MAX_QUESTIONS, type AssessmentInput } from './assessments';
import type { AssessmentStatus, RevealPolicy } from './enums';
import { normalizeSheetWord as norm, parseQuizSheet, QUIZ_SHEET_COLUMNS, type QuizSheetError, type QuizSheetErrorCode } from './quiz-sheet';
import { zonedTimeToUtc } from './speakers';

/**
 * Quiz import: one spreadsheet (.xlsx or .csv, read in the browser) becomes several quizzes,
 * each on a session of the course, with all their questions. Pure, so the web app and the
 * tests share it; the server validates what is saved again (quizImportSchema).
 *
 * The question columns are the quiz upload's (see quiz-sheet.ts), plus:
 *   quiz            the quiz title: rows with the same title (any case) are one quiz
 *   session         the session number (its position in the course), or "course" / empty
 * and optional settings, read from each quiz's first row (later rows may leave them empty):
 *   pass_percent    0–100 (default 70)
 *   due             "2026-11-20 18:00" or "2026-11-20T18:00" (Cairo time), a date alone (23:59 Cairo),
 *                   or an ISO date-time with a zone ("2026-11-20T16:00:00Z")
 *   attempts        0–20, 0 or "unlimited" for no limit (default 1)
 *   time_limit_min  1–600 minutes, empty for none
 *   reveal          never | after_submit | after_due (default after_submit)
 *   mandatory       yes / no: counts toward the certificate (default no)
 *   status          draft | published (default draft)
 *   max_points      1–1000 (default 100)
 *   instructions    shown above the questions
 */

/** Quizzes per import. */
export const QUIZ_BOOK_MAX_QUIZZES = 30;
/** Questions per import, across all its quizzes. */
export const QUIZ_BOOK_MAX_QUESTIONS = 1000;

const SETTING_COLUMNS = ['pass_percent', 'due', 'attempts', 'time_limit_min', 'reveal', 'mandatory', 'status', 'max_points', 'instructions'] as const;
type SettingColumn = (typeof SETTING_COLUMNS)[number];

export const QUIZ_BOOK_COLUMNS = ['quiz', 'session', ...QUIZ_SHEET_COLUMNS, ...SETTING_COLUMNS] as const;

/**
 * The template: two quizzes (sessions 1 and 2), every question type, different weights.
 * Settings are on each quiz's first row only.
 */
export const QUIZ_BOOK_EXAMPLE: string[][] = (() => {
  const row = (o: Partial<Record<(typeof QUIZ_BOOK_COLUMNS)[number], string>>): string[] => QUIZ_BOOK_COLUMNS.map((c) => o[c] ?? '');
  return [
    [...QUIZ_BOOK_COLUMNS],
    row({
      quiz: 'Session 1 check-in',
      session: '1',
      type: 'single',
      question: 'Which tool tracks ML experiments?',
      option1: 'Nginx',
      option2: 'MLflow',
      option3: 'Excel',
      correct: '2',
      weight: '1',
      explanation: 'MLflow logs parameters, metrics and artifacts for each run.',
      pass_percent: '70',
      due: '2027-03-01 20:00',
      attempts: '2',
      time_limit_min: '15',
      reveal: 'after_submit',
      mandatory: 'yes',
      status: 'draft',
      max_points: '10',
      instructions: 'Answer every question. You have two attempts; the best one counts.',
    }),
    row({ quiz: 'Session 1 check-in', session: '1', type: 'multiple', question: 'Which of these are feature stores?', option1: 'Feast', option2: 'Grafana', option3: 'Tecton', correct: '1,3', weight: '2', explanation: 'Feast and Tecton serve features; Grafana draws dashboards.' }),
    row({ quiz: 'Session 1 check-in', session: '1', type: 'true_false', question: 'A model registry stores versioned models.', correct: 'true', weight: '1' }),
    row({
      quiz: 'Session 2 review',
      session: '2',
      type: 'single',
      question: 'Which Kubernetes object runs a batch task to completion?',
      option1: 'Deployment',
      option2: 'Job',
      option3: 'Service',
      correct: 'B',
      weight: '2',
      pass_percent: '60',
      attempts: '1',
      reveal: 'never',
      mandatory: 'no',
      status: 'draft',
    }),
    row({ quiz: 'Session 2 review', session: '2', type: 'multiple', question: 'Which are common ways to serve a model?', option1: 'A REST API', option2: 'Batch scoring', option3: 'A printed report', correct: 'A,B', weight: '3' }),
    row({ quiz: 'Session 2 review', session: '2', type: 'true_false', question: 'Data drift means the input data changes over time.', correct: 'true', weight: '1', explanation: 'Drift is a change in the data the model sees after training.' }),
  ];
})();

export type QuizBookErrorCode =
  | QuizSheetErrorCode
  | 'NO_QUIZ_TITLE'
  | 'BAD_TITLE'
  | 'BAD_SESSION'
  | 'SESSION_MISMATCH'
  | 'BAD_PASS_PERCENT'
  | 'BAD_DUE'
  | 'BAD_ATTEMPTS'
  | 'BAD_TIME_LIMIT'
  | 'BAD_REVEAL'
  | 'BAD_MANDATORY'
  | 'BAD_STATUS'
  | 'BAD_MAX_POINTS'
  | 'REVEAL_NEEDS_DUE'
  | 'PRACTICE_CERTIFICATE'
  | 'TOO_MANY_QUIZZES'
  | 'QUIZ_TOO_MANY_QUESTIONS';

export interface QuizBookError extends Omit<QuizSheetError, 'code'> {
  code: QuizBookErrorCode;
  /** The quiz the row belongs to, when known. */
  quiz?: string;
}

/** One quiz of the file, ready to send (quizImportSchema) once the file has no errors. */
export interface QuizBookQuiz {
  /** Session number (its position in the course), or null for a course-level quiz. */
  session: number | null;
  /** The sheet row of its first question. */
  row: number;
  /** The assessment, with no session id yet (the server maps the number to the session). */
  assessment: AssessmentInput;
}

export interface QuizBookResult {
  quizzes: QuizBookQuiz[];
  errors: QuizBookError[];
  /** Data rows read (not counting the header or empty rows). */
  rowCount: number;
  questionCount: number;
}

// ------------------------------------------------------------------ columns and values

/** Header → one of the import's own columns (the question columns are read by parseQuizSheet). */
function bookColumn(header: string): 'quiz' | 'session' | SettingColumn | null {
  const h = norm(header);
  if (['quiz', 'quiztitle', 'quizname', 'title', 'assessment', 'assessmenttitle', 'test', 'exam'].includes(h)) return 'quiz';
  if (['session', 'sessionnumber', 'sessionno', 'sessionnum', 'sessionorder', 'lesson', 'lessonnumber'].includes(h)) return 'session';
  if (['passpercent', 'pass', 'pass%', 'passmark', 'passingpercent', 'passingscore', 'passscore', 'passpercentage'].includes(h)) return 'pass_percent';
  if (['due', 'dueat', 'duedate', 'duetime', 'dueon', 'deadline'].includes(h)) return 'due';
  if (['attempts', 'attemptsallowed', 'maxattempts', 'tries'].includes(h)) return 'attempts';
  if (['timelimitmin', 'timelimit', 'timelimitminutes', 'minutes', 'duration', 'durationmin', 'durationminutes'].includes(h)) return 'time_limit_min';
  if (['reveal', 'revealanswers', 'showanswers', 'answersshown'].includes(h)) return 'reveal';
  if (['mandatory', 'required', 'countsforcertificate', 'certificate', 'forcertificate'].includes(h)) return 'mandatory';
  if (['status', 'publish', 'published', 'state'].includes(h)) return 'status';
  if (['maxpoints', 'totalpoints', 'outof', 'maxscore'].includes(h)) return 'max_points';
  if (['instructions', 'description', 'intro'].includes(h)) return 'instructions';
  return null;
}

const COURSE_LEVEL = new Set(['', 'course', 'courselevel', 'none', 'all', 'whole', 'wholecourse', '-', '0']);
const UNLIMITED = new Set(['unlimited', 'any', 'nolimit', 'infinite', '∞']);
const YES = new Set(['yes', 'y', 'true', 't', '1', 'mandatory', 'required', 'نعم', 'إجباري', 'اجباري']);
const NO = new Set(['no', 'n', 'false', 'f', '0', 'optional', 'لا', 'اختياري']);
const REVEALS: Record<string, RevealPolicy> = {
  never: 'NEVER',
  no: 'NEVER',
  hidden: 'NEVER',
  aftersubmit: 'AFTER_SUBMIT',
  aftersubmission: 'AFTER_SUBMIT',
  submit: 'AFTER_SUBMIT',
  submitted: 'AFTER_SUBMIT',
  afterlastattempt: 'AFTER_SUBMIT',
  afterdue: 'AFTER_DUE',
  afterduedate: 'AFTER_DUE',
  afterdeadline: 'AFTER_DUE',
  due: 'AFTER_DUE',
};
const STATUSES: Record<string, AssessmentStatus> = {
  draft: 'DRAFT',
  hidden: 'DRAFT',
  no: 'DRAFT',
  published: 'PUBLISHED',
  publish: 'PUBLISHED',
  live: 'PUBLISHED',
  yes: 'PUBLISHED',
};

const wholeNumber = (v: string): number | null => (/^\d+(?:\.0+)?$/.test(v) ? Number(v) : null);

/** "2", "Session 2", "S2", "#2" → 2; course-level words → null; anything else → undefined. */
export function parseSessionCell(value: string): number | null | undefined {
  if (COURSE_LEVEL.has(norm(value))) return null;
  const m = /^(?:session|s|lesson)?(\d+)(?:\.0+)?$/.exec(value.trim().toLowerCase().replace(/[\s_#:]+/g, ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 999 ? n : undefined;
}

/** "70", "70%", 0.7 (an Excel percentage cell) → 70; null when it isn't 0–100. */
function parsePercent(value: string): number | null {
  const v = value.replace(/\s/g, '');
  const pct = v.endsWith('%');
  const n = Number(pct ? v.slice(0, -1) : v);
  if (v === '' || v === '%' || !Number.isFinite(n)) return null;
  const p = !pct && n > 0 && n < 1 ? Math.round(n * 10000) / 100 : n;
  return Number.isInteger(p) && p >= 0 && p <= 100 ? p : null;
}

/**
 * A due date as an ISO instant. Without a zone it is Cairo time: "2026-11-20 18:00",
 * "2026-11-20T18:00", "2026/11/20 18:00", or a date alone (23:59). Null when unreadable.
 */
export function parseDueCell(value: string): string | null {
  const v = value.trim();
  const local = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(v);
  let at: Date;
  if (local) {
    const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => (local[i] === undefined ? undefined : Number(local[i])));
    const hour = h ?? 23;
    const minute = mi ?? 59;
    if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || hour > 23 || minute > 59) return null;
    // A day that doesn't exist (31 April) would roll over: refuse it instead.
    if (new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDate() !== d) return null;
    at = zonedTimeToUtc(y!, mo!, d!, hour, minute);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) {
    at = new Date(v);
  } else {
    return null;
  }
  const year = at.getUTCFullYear();
  return Number.isNaN(at.getTime()) || year < 2000 || year > 2100 ? null : at.toISOString();
}

// ------------------------------------------------------------------ the parser

function cell(row: string[] | undefined, i: number | undefined): string {
  if (!row || i === undefined) return '';
  const v = (row[i] ?? '').trim();
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

function err(row: number, code: QuizBookErrorCode, message: string, params?: Record<string, string | number>, quiz?: string): QuizBookError {
  return { row, code, message, ...(params ? { params } : {}), ...(quiz !== undefined ? { quiz } : {}) };
}

/**
 * Spreadsheet rows (as text) → quizzes, grouped by the `quiz` column, with an error per bad
 * row (its row number in the sheet). Each group's questions are read by parseQuizSheet, so
 * the question columns work exactly as in the single-quiz upload. Callers should only send
 * `quizzes` when `errors` is empty.
 */
export function parseQuizBook(rows: string[][]): QuizBookResult {
  const errors: QuizBookError[] = [];
  const quizzes: QuizBookQuiz[] = [];
  const blank = (r: string[] | undefined) => !r || r.every((c) => (c ?? '').trim() === '');
  const headerIndex = rows.findIndex((r) => !blank(r));
  const none = (e: QuizBookError[]): QuizBookResult => ({ quizzes, errors: e, rowCount: 0, questionCount: 0 });
  if (headerIndex < 0) return none([err(1, 'EMPTY', 'The file is empty')]);

  const header = rows[headerIndex]!;
  const col: Partial<Record<'quiz' | 'session' | SettingColumn, number>> = {};
  header.forEach((h, i) => {
    const key = bookColumn(h ?? '');
    if (key && col[key] === undefined) col[key] = i;
  });
  // The question columns: parseQuizSheet reads the same header.
  const probe = parseQuizSheet([header]);
  const headerRow = headerIndex + 1;
  const missing = [
    ...(col.quiz === undefined ? [err(headerRow, 'MISSING_COLUMN', 'The header row has no "quiz" column', { column: 'quiz' })] : []),
    ...probe.errors.filter((e) => e.code === 'MISSING_COLUMN'),
  ];
  if (missing.length) return none(missing);

  // Group the rows by quiz title (trimmed, any case), in the order they first appear.
  const groups = new Map<string, { title: string; rows: number[] }>();
  let rowCount = 0;
  for (let r = headerIndex + 1; r < rows.length; r++) {
    if (blank(rows[r])) continue;
    rowCount++;
    const title = cell(rows[r], col.quiz).replace(/\s+/g, ' ');
    if (!title) {
      errors.push(err(r + 1, 'NO_QUIZ_TITLE', 'The "quiz" column is empty: name the quiz this question belongs to'));
      continue;
    }
    const key = title.toLowerCase();
    const g = groups.get(key) ?? { title, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  if (rowCount === 0) return none([err(headerRow + 1, 'EMPTY', 'There are no questions under the header row')]);
  if (groups.size > QUIZ_BOOK_MAX_QUIZZES) {
    return { quizzes, errors: [err(headerRow, 'TOO_MANY_QUIZZES', `At most ${QUIZ_BOOK_MAX_QUIZZES} quizzes per file`, { max: QUIZ_BOOK_MAX_QUIZZES, count: groups.size })], rowCount, questionCount: 0 };
  }
  if (rowCount > QUIZ_BOOK_MAX_QUESTIONS) {
    return { quizzes, errors: [err(headerRow, 'TOO_MANY_QUESTIONS', `At most ${QUIZ_BOOK_MAX_QUESTIONS} questions per file`, { max: QUIZ_BOOK_MAX_QUESTIONS, count: rowCount })], rowCount, questionCount: 0 };
  }

  let questionCount = 0;
  for (const { title, rows: members } of groups.values()) {
    const first = members[0]!;
    const firstRow = rows[first];
    const line = first + 1;
    const quizErrors: QuizBookError[] = [];
    const add = (row: number, code: QuizBookErrorCode, message: string, params?: Record<string, string | number>) => quizErrors.push(err(row, code, message, params, title));

    if (members.length > MAX_QUESTIONS) {
      add(members[MAX_QUESTIONS]! + 1, 'QUIZ_TOO_MANY_QUESTIONS', `A quiz has at most ${MAX_QUESTIONS} questions`, { max: MAX_QUESTIONS, count: members.length });
      errors.push(...quizErrors);
      continue;
    }
    if (title.length < 2 || title.length > 200) add(line, 'BAD_TITLE', 'A quiz title is 2 to 200 characters', { min: 2, max: 200 });

    // The session: from the first row; a later row may repeat it or leave it empty.
    const sessionRaw = cell(firstRow, col.session);
    const session = parseSessionCell(sessionRaw);
    if (session === undefined) add(line, 'BAD_SESSION', `"${sessionRaw}" is not a session number: use 1, 2, 3… or "course"`, { value: sessionRaw });
    for (const r of members.slice(1)) {
      const v = cell(rows[r], col.session);
      if (v !== '' && session !== undefined && parseSessionCell(v) !== session) {
        add(r + 1, 'SESSION_MISMATCH', `This row says session "${v}", but the quiz's first row says "${sessionRaw || 'course'}"`, { value: v, first: sessionRaw || 'course' });
      }
    }

    // Settings: the first row's.
    const setting = (c: SettingColumn) => cell(firstRow, col[c]);
    const draft: Record<string, unknown> = { type: 'QUIZ', titleEn: title, status: 'DRAFT' };
    const pass = setting('pass_percent');
    if (pass) {
      const p = parsePercent(pass);
      if (p === null) add(line, 'BAD_PASS_PERCENT', `The pass percent "${pass}" must be a whole number from 0 to 100`, { value: pass });
      else draft.passPercent = p;
    }
    const due = setting('due');
    if (due) {
      const d = parseDueCell(due);
      if (!d) add(line, 'BAD_DUE', `"${due}" is not a date: use 2026-11-20 18:00 (Cairo time)`, { value: due });
      else draft.dueAt = d;
    }
    const attempts = setting('attempts');
    if (attempts) {
      const n = UNLIMITED.has(norm(attempts)) ? 0 : wholeNumber(attempts);
      if (n === null || n > 20) add(line, 'BAD_ATTEMPTS', `Attempts "${attempts}" must be 0 (unlimited) to 20`, { value: attempts });
      else draft.attemptsAllowed = n;
    }
    const limit = setting('time_limit_min');
    if (limit && !['none', 'no', '0', '-'].includes(norm(limit))) {
      const n = wholeNumber(limit.replace(/\s*(?:min|mins|minutes)$/i, ''));
      if (n === null || n < 1 || n > 600) add(line, 'BAD_TIME_LIMIT', `The time limit "${limit}" must be 1 to 600 minutes`, { value: limit });
      else draft.timeLimitMin = n;
    }
    const reveal = setting('reveal');
    if (reveal) {
      const r = REVEALS[norm(reveal)];
      if (!r) add(line, 'BAD_REVEAL', `Unknown reveal "${reveal}": use never, after_submit or after_due`, { value: reveal });
      else draft.revealAnswers = r;
    }
    // Answers go out at the due date: late attempts can't be taken with the key out.
    draft.allowLate = draft.revealAnswers !== 'AFTER_DUE';
    const mandatory = setting('mandatory');
    if (mandatory) {
      const m = norm(mandatory);
      if (YES.has(m)) draft.countsForCertificate = true;
      else if (NO.has(m)) draft.countsForCertificate = false;
      else add(line, 'BAD_MANDATORY', `Mandatory "${mandatory}" must be yes or no`, { value: mandatory });
    }
    const status = setting('status');
    if (status) {
      const s = STATUSES[norm(status)];
      if (!s) add(line, 'BAD_STATUS', `Unknown status "${status}": use draft or published`, { value: status });
      else draft.status = s;
    }
    const max = setting('max_points');
    if (max) {
      const n = wholeNumber(max);
      if (n === null || n < 1 || n > 1000) add(line, 'BAD_MAX_POINTS', `Max points "${max}" must be a whole number from 1 to 1000`, { value: max });
      else draft.maxPoints = n;
    }
    const instructions = setting('instructions');
    if (instructions) draft.instructionsEn = instructions;

    // The questions: only this quiz's rows, kept at their own row numbers.
    const keep = new Set(members);
    const sheet = parseQuizSheet(rows.map((r, i) => (i === headerIndex || keep.has(i) ? r : [])));
    quizErrors.push(...sheet.errors.map((e) => ({ ...e, quiz: title })));
    questionCount += sheet.questions.length;

    if (!quizErrors.length) {
      const parsed = assessmentInputSchema.safeParse({ ...draft, questions: sheet.questions });
      if (parsed.success) {
        quizzes.push({ session: session ?? null, row: line, assessment: parsed.data });
      } else {
        for (const issue of parsed.error.issues) {
          if (issue.message.startsWith('Set a due date')) add(line, 'REVEAL_NEEDS_DUE', 'Answers shown after the due date need a due date', {});
          else if (issue.message.startsWith('A practice quiz')) add(line, 'PRACTICE_CERTIFICATE', 'Unlimited attempts with answers after each one is practice: it cannot be mandatory', {});
          else add(line, 'INVALID', `${issue.path.join('.')}: ${issue.message}`);
        }
      }
    }
    errors.push(...quizErrors);
  }
  errors.sort((a, b) => a.row - b.row);
  // The quizzes without problems are returned too, for the preview; send them only when `errors` is empty.
  return { quizzes, errors, rowCount, questionCount };
}

// ------------------------------------------------------------------ the request

/** POST …/assessments/import: the parsed quizzes, all saved or none. */
export const quizImportSchema = z
  .object({
    /** A quiz whose title (any case) is already used by a quiz of the same session is skipped, unless this is true: then it is replaced. */
    replaceExisting: z.boolean().default(false),
    quizzes: z
      .array(
        z.object({
          session: z.number().int().min(1).max(999).nullable(),
          assessment: assessmentInputSchema.refine((a) => a.type === 'QUIZ', { message: 'Only quizzes can be imported', path: ['type'] }),
        }),
      )
      .min(1)
      .max(QUIZ_BOOK_MAX_QUIZZES),
  })
  .superRefine((v, ctx) => {
    const total = v.quizzes.reduce((n, q) => n + q.assessment.questions.length, 0);
    if (total > QUIZ_BOOK_MAX_QUESTIONS) ctx.addIssue({ code: 'custom', path: ['quizzes'], message: `At most ${QUIZ_BOOK_MAX_QUESTIONS} questions per import` });
    const seen = new Set<string>();
    v.quizzes.forEach((q, i) => {
      if (q.assessment.questions.length === 0) ctx.addIssue({ code: 'custom', path: ['quizzes', i, 'assessment', 'questions'], message: 'A quiz needs at least one question' });
      const key = `${q.session ?? 'course'}|${q.assessment.titleEn.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['quizzes', i, 'assessment', 'titleEn'], message: 'The same title twice for one session' });
      seen.add(key);
    });
  });
export type QuizImportInput = z.infer<typeof quizImportSchema>;

export interface QuizImportItem {
  id: string | null;
  title: string;
  session: number | null;
  questions: number;
}

export interface QuizImportResult {
  created: QuizImportItem[];
  replaced: QuizImportItem[];
  /** Same title already in that session, and replaceExisting was off. */
  skipped: QuizImportItem[];
}
