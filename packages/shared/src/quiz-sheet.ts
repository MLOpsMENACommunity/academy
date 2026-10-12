import { MAX_QUESTIONS, quizQuestionInputSchema, type QuizQuestionInput } from './assessments';
import type { QuizQuestionKind } from './enums';

/**
 * Quiz upload: a spreadsheet (.xlsx or .csv, read in the browser) with one question
 * per row becomes quiz questions. Pure, so the web app and the tests share it; the
 * server still validates what is saved with the same schema.
 *
 * Columns (a header row is required; any order, any case):
 *   type         single | multiple | true_false (optional: guessed from `correct`)
 *   question     the question text
 *   option1…6    the choices (leave unused ones empty; true/false needs none)
 *   correct      option numbers or letters: 2, "1,3", B, "A,C"; true/false: true or false
 *   weight       optional, a whole number 1–100 (default 1)
 *   explanation  optional, shown with the answers
 */

export const QUIZ_SHEET_MAX_OPTIONS = 6;
/** Questions per upload (the same as per quiz). */
export const QUIZ_SHEET_MAX_QUESTIONS = MAX_QUESTIONS;

export const QUIZ_SHEET_COLUMNS = [
  'type',
  'question',
  ...Array.from({ length: QUIZ_SHEET_MAX_OPTIONS }, (_, i) => `option${i + 1}`),
  'correct',
  'weight',
  'explanation',
] as const;

/** The template: the header and one example of each type. */
export const QUIZ_SHEET_EXAMPLE: string[][] = [
  [...QUIZ_SHEET_COLUMNS],
  ['single', 'Which tool tracks ML experiments?', 'Nginx', 'MLflow', 'Excel', '', '', '', '2', '1', 'MLflow logs parameters, metrics and artifacts for each run.'],
  ['multiple', 'Which of these are feature stores?', 'Feast', 'Grafana', 'Tecton', '', '', '', '1,3', '2', ''],
  ['true_false', 'Kubernetes schedules containers onto nodes.', '', '', '', '', '', '', 'true', '1', ''],
];

export type QuizSheetErrorCode =
  | 'EMPTY'
  | 'MISSING_COLUMN'
  | 'TOO_MANY_QUESTIONS'
  | 'UNKNOWN_TYPE'
  | 'NO_QUESTION'
  | 'TOO_FEW_OPTIONS'
  | 'NO_CORRECT'
  | 'BAD_CORRECT'
  | 'CORRECT_NOT_AN_OPTION'
  | 'ONE_CORRECT'
  | 'BAD_TRUE_FALSE'
  | 'BAD_WEIGHT'
  | 'TOO_LONG'
  | 'INVALID';

export interface QuizSheetError {
  /** The spreadsheet row (1 = the first row, usually the header). */
  row: number;
  code: QuizSheetErrorCode;
  /** Details for the message: a column name, the value that was read, a limit. */
  params?: Record<string, string | number>;
  /** English, for logs and tests; the web app shows its own translated text. */
  message: string;
}

export interface QuizSheetResult {
  questions: QuizQuestionInput[];
  errors: QuizSheetError[];
  /** Data rows read (not counting the header or empty rows). */
  rowCount: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-/().#:]+/g, '');

const OPTION_LETTERS = 'abcdef';

/** Header name → column key. Option columns accept numbers or letters ("option 1", "Option A", "choice b"). */
function columnKey(header: string): string | null {
  const h = norm(header);
  if (['type', 'kind', 'questiontype'].includes(h)) return 'type';
  if (['question', 'prompt', 'questiontext', 'text'].includes(h)) return 'question';
  if (['correct', 'answer', 'answers', 'correctanswer', 'correctanswers', 'correctoption', 'correctoptions', 'key'].includes(h)) return 'correct';
  if (['weight', 'points', 'marks', 'score'].includes(h)) return 'weight';
  if (['explanation', 'explain', 'why', 'rationale', 'feedback'].includes(h)) return 'explanation';
  const m = /^(?:option|opt|choice)([1-9]|[a-f])$/.exec(h);
  if (m) {
    const n = /\d/.test(m[1]!) ? Number(m[1]) : OPTION_LETTERS.indexOf(m[1]!) + 1;
    return n >= 1 && n <= QUIZ_SHEET_MAX_OPTIONS ? `option${n}` : null;
  }
  return null;
}

const TYPES: Record<string, QuizQuestionKind> = {
  single: 'SINGLE',
  singlechoice: 'SINGLE',
  mcq: 'SINGLE',
  radio: 'SINGLE',
  one: 'SINGLE',
  multiple: 'MULTIPLE',
  multi: 'MULTIPLE',
  multiplechoice: 'MULTIPLE',
  multiselect: 'MULTIPLE',
  checkbox: 'MULTIPLE',
  checkboxes: 'MULTIPLE',
  many: 'MULTIPLE',
  truefalse: 'TRUE_FALSE',
  tf: 'TRUE_FALSE',
  boolean: 'TRUE_FALSE',
  bool: 'TRUE_FALSE',
  trueorfalse: 'TRUE_FALSE',
};

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', '1', 'صح', 'صحيح', 'نعم']);
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', '0', '2', 'خطأ', 'خطا', 'لا']);

/** A cell as text: a leading apostrophe that guards a formula character (="…", +…) is dropped. */
function cell(row: string[], i: number | undefined): string {
  if (i === undefined) return '';
  const v = (row[i] ?? '').trim();
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

/** "2", "1,3", "1;3", "1 and 3", "B", "a, c" → option numbers (1-based); null when something isn't one. */
function parseCorrect(value: string): number[] | null {
  const tokens = value
    .toLowerCase()
    .split(/\s*(?:,|;|\||\/|&|\band\b|\s)\s*/)
    .map((t) => t.replace(/^option\s*/, '').replace(/[.)]$/, ''))
    .filter(Boolean);
  if (!tokens.length) return null;
  const out: number[] = [];
  for (const t of tokens) {
    let n: number;
    if (/^\d+(?:\.0+)?$/.test(t)) n = Number(t);
    else if (/^[a-z]$/.test(t)) n = t.charCodeAt(0) - 96;
    else return null;
    if (!Number.isInteger(n) || n < 1 || n > QUIZ_SHEET_MAX_OPTIONS) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function err(row: number, code: QuizSheetErrorCode, message: string, params?: Record<string, string | number>): QuizSheetError {
  return params ? { row, code, message, params } : { row, code, message };
}

/**
 * Spreadsheet rows (as text) → quiz questions, with an error per bad row (its row
 * number in the sheet). Empty rows are skipped. Nothing is half-imported: callers
 * should only use `questions` when `errors` is empty.
 */
export function parseQuizSheet(rows: string[][]): QuizSheetResult {
  const errors: QuizSheetError[] = [];
  const questions: QuizQuestionInput[] = [];
  const blank = (r: string[] | undefined) => !r || r.every((c) => (c ?? '').trim() === '');
  const headerIndex = rows.findIndex((r) => !blank(r));
  if (headerIndex < 0) return { questions, errors: [err(1, 'EMPTY', 'The file is empty')], rowCount: 0 };

  const col: Record<string, number> = {};
  rows[headerIndex]!.forEach((h, i) => {
    const key = columnKey(h ?? '');
    if (key && col[key] === undefined) col[key] = i;
  });
  const headerRow = headerIndex + 1;
  const optionCols = Array.from({ length: QUIZ_SHEET_MAX_OPTIONS }, (_, i) => col[`option${i + 1}`]);
  for (const required of ['question', 'correct'] as const) {
    if (col[required] === undefined) errors.push(err(headerRow, 'MISSING_COLUMN', `The header row has no "${required}" column`, { column: required }));
  }
  if (errors.length) return { questions, errors, rowCount: 0 };

  let rowCount = 0;
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (blank(row)) continue;
    rowCount++;
    const line = r + 1;
    if (rowCount > QUIZ_SHEET_MAX_QUESTIONS) {
      errors.push(err(line, 'TOO_MANY_QUESTIONS', `At most ${QUIZ_SHEET_MAX_QUESTIONS} questions per upload`, { max: QUIZ_SHEET_MAX_QUESTIONS }));
      break;
    }

    const prompt = cell(row, col.question);
    const correctRaw = cell(row, col.correct);
    const typeRaw = cell(row, col.type);
    const options = optionCols.map((i, n) => ({ n: n + 1, label: cell(row, i) })).filter((o) => o.label !== '');

    let kind: QuizQuestionKind | undefined;
    if (typeRaw) {
      kind = TYPES[norm(typeRaw)];
      if (!kind) {
        errors.push(err(line, 'UNKNOWN_TYPE', `Unknown type "${typeRaw}": use single, multiple or true_false`, { value: typeRaw }));
        continue;
      }
    }
    if (!prompt) {
      errors.push(err(line, 'NO_QUESTION', 'The question is empty'));
      continue;
    }
    if (!correctRaw) {
      errors.push(err(line, 'NO_CORRECT', 'Say which answer is correct in the "correct" column'));
      continue;
    }
    // No type: true/false when the answer is true/false and there are no options;
    // multiple when several options are correct; otherwise single.
    const tf = norm(correctRaw);
    if (!kind) {
      const asNumbers = parseCorrect(correctRaw);
      if (options.length === 0 && (TRUE_WORDS.has(tf) || FALSE_WORDS.has(tf))) kind = 'TRUE_FALSE';
      else kind = asNumbers && asNumbers.length > 1 ? 'MULTIPLE' : 'SINGLE';
    }

    let draft: { kind: QuizQuestionKind; promptEn: string; weight: unknown; explanationEn: string | null; options: { labelEn: string; correct: boolean }[] };
    const weightRaw = cell(row, col.weight);
    const weight = weightRaw === '' ? 1 : /^\d+(?:\.0+)?$/.test(weightRaw) ? Number(weightRaw) : NaN;
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      errors.push(err(line, 'BAD_WEIGHT', `The weight "${weightRaw}" must be a whole number from 1 to 100`, { value: weightRaw }));
      continue;
    }
    const explanation = cell(row, col.explanation) || null;

    if (kind === 'TRUE_FALSE') {
      const isTrue = TRUE_WORDS.has(tf);
      if (!isTrue && !FALSE_WORDS.has(tf)) {
        errors.push(err(line, 'BAD_TRUE_FALSE', `A true/false answer must be true or false, not "${correctRaw}"`, { value: correctRaw }));
        continue;
      }
      draft = { kind, promptEn: prompt, weight, explanationEn: explanation, options: [{ labelEn: 'True', correct: isTrue }, { labelEn: 'False', correct: !isTrue }] };
    } else {
      if (options.length < 2) {
        errors.push(err(line, 'TOO_FEW_OPTIONS', 'Give at least two options', { min: 2 }));
        continue;
      }
      const picked = parseCorrect(correctRaw);
      if (!picked) {
        errors.push(err(line, 'BAD_CORRECT', `"${correctRaw}" is not an option number or letter (e.g. 2, "1,3", B)`, { value: correctRaw }));
        continue;
      }
      const missing = picked.find((n) => !options.some((o) => o.n === n));
      if (missing !== undefined) {
        errors.push(err(line, 'CORRECT_NOT_AN_OPTION', `The correct answer points to option ${missing}, which is empty`, { n: missing }));
        continue;
      }
      if (kind === 'SINGLE' && picked.length !== 1) {
        errors.push(err(line, 'ONE_CORRECT', 'A single-choice question has exactly one correct answer (use type "multiple" for more)'));
        continue;
      }
      draft = { kind, promptEn: prompt, weight, explanationEn: explanation, options: options.map((o) => ({ labelEn: o.label, correct: picked.includes(o.n) })) };
    }

    const parsed = quizQuestionInputSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const field = String(issue.path[0] ?? '');
      if (issue.code === 'too_big') {
        const column = field === 'promptEn' ? 'question' : field === 'explanationEn' ? 'explanation' : 'option';
        errors.push(err(line, 'TOO_LONG', `The ${column} is too long`, { column, max: Number(issue.maximum) }));
      } else {
        errors.push(err(line, 'INVALID', issue.message));
      }
      continue;
    }
    questions.push(parsed.data);
  }
  if (rowCount === 0 && !errors.length) errors.push(err(headerRow + 1, 'EMPTY', 'There are no questions under the header row'));
  return { questions, errors, rowCount };
}

/** Spreadsheet cells (text, numbers, booleans, dates, empty) → text, for parseQuizSheet. */
export function sheetCellsToText(rows: unknown[][]): string[][] {
  return rows.map((r) =>
    r.map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
      return String(v);
    }),
  );
}
