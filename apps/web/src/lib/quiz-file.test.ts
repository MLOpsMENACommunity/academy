import { QUIZ_SHEET_COLUMNS, writeXlsx } from '@academy/shared';
import { describe, expect, it } from 'vitest';
import { QuizFileError, quizFileKind, quizTemplate, readQuizFile } from './quiz-file';

const file = (parts: BlobPart[], name: string) => new File(parts, name);

/** 30 questions: 10 of each type. */
function sheet(): string[][] {
  const rows: string[][] = [[...QUIZ_SHEET_COLUMNS]];
  for (let i = 1; i <= 30; i++) {
    const type = ['single', 'multiple', 'true_false'][i % 3]!;
    const correct = type === 'single' ? '2' : type === 'multiple' ? '1,3' : i % 2 ? 'true' : 'false';
    const options = type === 'true_false' ? ['', '', ''] : [`A${i}`, `B${i}`, `C${i}`];
    rows.push([type, `Question ${i}?`, ...options, '', '', '', correct, String((i % 5) + 1), i % 4 ? '' : `Because ${i}`]);
  }
  return rows;
}

describe('quiz upload files', () => {
  it('reads a 30-question .xlsx', async () => {
    const r = await readQuizFile(file([writeXlsx(sheet()) as BlobPart], 'quiz.xlsx'));
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(30);
    expect(r.questions.filter((q) => q.kind === 'TRUE_FALSE')).toHaveLength(10);
    expect(r.questions[0]).toMatchObject({ kind: 'MULTIPLE', promptEn: 'Question 1?', weight: 2, options: [{ correct: true }, { correct: false }, { correct: true }] });
  });

  it('reads the same questions from a .csv', async () => {
    const csv = sheet()
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\r\n');
    const fromCsv = await readQuizFile(file([csv], 'quiz.CSV'));
    const fromXlsx = await readQuizFile(file([writeXlsx(sheet()) as BlobPart], 'quiz.xlsx'));
    expect(fromCsv.errors).toEqual([]);
    expect(fromCsv.questions).toEqual(fromXlsx.questions);
  });

  it('round-trips both templates', async () => {
    for (const kind of ['xlsx', 'csv'] as const) {
      const r = await readQuizFile(file([quizTemplate(kind)], `template.${kind}`));
      expect(r.errors, kind).toEqual([]);
      expect(r.questions.map((q) => q.kind), kind).toEqual(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']);
    }
  });

  it('refuses other files, broken files and big files', async () => {
    expect(quizFileKind('a.xls')).toBeNull();
    expect(quizFileKind('a.XLSX')).toBe('xlsx');
    await expect(readQuizFile(file(['x'], 'old.xls'))).rejects.toEqual(new QuizFileError('BAD_FILE'));
    await expect(readQuizFile(file(['not a zip'], 'broken.xlsx'))).rejects.toEqual(new QuizFileError('BAD_FILE'));
    await expect(readQuizFile(file([new Uint8Array(5_000_001)], 'big.csv'))).rejects.toEqual(new QuizFileError('TOO_BIG'));
  });

  it('reports row errors with spreadsheet row numbers', async () => {
    const rows = sheet().slice(0, 3);
    rows.push(['single', 'Broken', 'a', 'b', '', '', '', '', '9', '', '']);
    const r = await readQuizFile(file([writeXlsx(rows) as BlobPart], 'quiz.xlsx'));
    expect(r.errors).toEqual([expect.objectContaining({ row: 4, code: 'BAD_CORRECT' })]);
  });
});
