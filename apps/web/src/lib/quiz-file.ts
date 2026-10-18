import {
  parseCsv,
  parseQuizBook,
  parseQuizSheet,
  QUIZ_BOOK_EXAMPLE,
  QUIZ_SHEET_EXAMPLE,
  sheetCellsToText,
  toCsv,
  writeXlsx,
  type QuizBookResult,
  type QuizSheetResult,
} from '@academy/shared';

/** Quiz upload files are read in the browser; nothing is sent until the admin saves the quiz. */
export const QUIZ_FILE_MAX_BYTES = 5_000_000;

export type QuizFileKind = 'xlsx' | 'csv';

export function quizFileKind(name: string): QuizFileKind | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'xlsx' ? 'xlsx' : ext === 'csv' || ext === 'txt' ? 'csv' : null;
}

export class QuizFileError extends Error {
  constructor(readonly code: 'TOO_BIG' | 'BAD_FILE') {
    super(code);
  }
}

/**
 * An .xlsx (first sheet) or .csv file → questions and row errors. The Excel reader is
 * loaded only now, so it never weighs on the rest of the site.
 */
export async function readQuizFile(file: Blob & { name: string }): Promise<QuizSheetResult> {
  return parseQuizSheet(await readRows(file));
}

/**
 * The quiz import (many quizzes, one per `quiz` title): an .xlsx (first sheet) or .csv file →
 * quizzes and row errors. Date cells are read as Cairo wall-clock times (the `due` column).
 */
export async function readQuizBookFile(file: Blob & { name: string }): Promise<QuizBookResult> {
  return parseQuizBook(await readRows(file, 'wallClock'));
}

async function readRows(file: Blob & { name: string }, dates: 'iso' | 'wallClock' = 'iso'): Promise<string[][]> {
  if (file.size > QUIZ_FILE_MAX_BYTES) throw new QuizFileError('TOO_BIG');
  const kind = quizFileKind(file.name);
  if (!kind) throw new QuizFileError('BAD_FILE');
  try {
    if (kind === 'xlsx') {
      const { readSheet } = await import('read-excel-file/browser');
      return sheetCellsToText(await readSheet(file), { dates });
    }
    return parseCsv(await file.text(), { keepEmpty: true });
  } catch {
    throw new QuizFileError('BAD_FILE');
  }
}

function templateBlob(rows: string[][], kind: QuizFileKind, sheet: string): Blob {
  if (kind === 'xlsx') {
    return new Blob([writeXlsx(rows, sheet) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const [header, ...rest] = rows;
  return new Blob([toCsv(header!, rest)], { type: 'text/csv;charset=utf-8' });
}

/** The template, with one example question of each type. */
export function quizTemplate(kind: QuizFileKind): Blob {
  return templateBlob(QUIZ_SHEET_EXAMPLE, kind, 'Questions');
}

/** The import template: two quizzes on sessions 1 and 2, every question type, weights and settings. */
export function quizBookTemplate(kind: QuizFileKind): Blob {
  return templateBlob(QUIZ_BOOK_EXAMPLE, kind, 'Quizzes');
}
