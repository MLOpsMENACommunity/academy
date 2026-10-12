import { parseCsv, parseQuizSheet, QUIZ_SHEET_EXAMPLE, sheetCellsToText, toCsv, writeXlsx, type QuizSheetResult } from '@academy/shared';

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
  if (file.size > QUIZ_FILE_MAX_BYTES) throw new QuizFileError('TOO_BIG');
  const kind = quizFileKind(file.name);
  if (!kind) throw new QuizFileError('BAD_FILE');
  let rows: string[][];
  try {
    if (kind === 'xlsx') {
      const { readSheet } = await import('read-excel-file/browser');
      rows = sheetCellsToText(await readSheet(file));
    } else {
      rows = parseCsv(await file.text(), { keepEmpty: true });
    }
  } catch {
    throw new QuizFileError('BAD_FILE');
  }
  return parseQuizSheet(rows);
}

/** The template, with one example question of each type. */
export function quizTemplate(kind: QuizFileKind): Blob {
  if (kind === 'xlsx') {
    return new Blob([writeXlsx(QUIZ_SHEET_EXAMPLE, 'Questions') as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const [header, ...rows] = QUIZ_SHEET_EXAMPLE;
  return new Blob([toCsv(header!, rows)], { type: 'text/csv;charset=utf-8' });
}
