import { parseAttendanceSheet, parseCsv, sheetCellsToText, type AttendanceSheetResult } from '@academy/shared';
import { quizFileKind } from './quiz-file';

/** Meet attendance files are read in this browser; only the matched records are sent. */
export const ATTENDANCE_FILE_MAX_BYTES = 5_000_000;

export class AttendanceFileError extends Error {
  constructor(readonly code: 'TOO_BIG' | 'BAD_FILE') {
    super(code);
  }
}

/** An .xlsx (first sheet) or .csv attendance file → one record per person, and the rows it skipped. */
export async function readAttendanceFile(file: Blob & { name: string }): Promise<AttendanceSheetResult> {
  if (file.size > ATTENDANCE_FILE_MAX_BYTES) throw new AttendanceFileError('TOO_BIG');
  const kind = quizFileKind(file.name);
  if (!kind) throw new AttendanceFileError('BAD_FILE');
  let rows: string[][];
  try {
    if (kind === 'xlsx') {
      // The Excel reader loads only now, so it never weighs on the rest of the site.
      const { readSheet } = await import('read-excel-file/browser');
      rows = sheetCellsToText(await readSheet(file));
    } else {
      rows = parseCsv(await file.text(), { keepEmpty: true });
    }
  } catch {
    throw new AttendanceFileError('BAD_FILE');
  }
  return parseAttendanceSheet(rows);
}
