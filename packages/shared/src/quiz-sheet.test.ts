import { describe, expect, it } from 'vitest';
import { assessmentInputSchema, MAX_QUESTIONS, trueFalseKey } from './assessments';
import { parseCsv } from './csv';
import { parseQuizSheet, QUIZ_SHEET_COLUMNS, QUIZ_SHEET_EXAMPLE, sheetCellsToText } from './quiz-sheet';
import { writeXlsx, zipStored } from './xlsx';

const H = ['type', 'question', 'option1', 'option2', 'option3', 'option4', 'option5', 'option6', 'correct', 'weight', 'explanation'];
const row = (o: Partial<Record<(typeof H)[number], string>>) => H.map((h) => o[h] ?? '');

describe('parseQuizSheet', () => {
  it('reads the template example: one question of each type', () => {
    const r = parseQuizSheet(QUIZ_SHEET_EXAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(3);
    expect(r.questions).toEqual([
      {
        kind: 'SINGLE',
        promptEn: 'Which tool tracks ML experiments?',
        weight: 1,
        explanationEn: 'MLflow logs parameters, metrics and artifacts for each run.',
        explanationAr: undefined,
        options: [
          { labelEn: 'Nginx', correct: false },
          { labelEn: 'MLflow', correct: true },
          { labelEn: 'Excel', correct: false },
        ],
      },
      {
        kind: 'MULTIPLE',
        promptEn: 'Which of these are feature stores?',
        weight: 2,
        explanationEn: null,
        explanationAr: undefined,
        options: [
          { labelEn: 'Feast', correct: true },
          { labelEn: 'Grafana', correct: false },
          { labelEn: 'Tecton', correct: true },
        ],
      },
      {
        kind: 'TRUE_FALSE',
        promptEn: 'Kubernetes schedules containers onto nodes.',
        weight: 1,
        explanationEn: null,
        explanationAr: undefined,
        options: [
          { labelEn: 'True', correct: true },
          { labelEn: 'False', correct: false },
        ],
      },
    ]);
    // No Arabic is produced: what is saved is English only.
    expect(JSON.stringify(r.questions)).not.toMatch(/Ar"/);
  });

  it('the template has every column, and its questions save as a quiz', () => {
    expect(QUIZ_SHEET_EXAMPLE[0]).toEqual([...QUIZ_SHEET_COLUMNS]);
    expect(QUIZ_SHEET_COLUMNS).toEqual(H);
    const { questions } = parseQuizSheet(QUIZ_SHEET_EXAMPLE);
    const quiz = assessmentInputSchema.safeParse({ type: 'QUIZ', status: 'PUBLISHED', titleEn: 'Uploaded quiz', questions });
    expect(quiz.success).toBe(true);
  });

  it('accepts headers in any order and case, with spaces, letters and synonyms', () => {
    const rows = [
      ['Correct Answer', 'Option B', 'QUESTION', 'Option A', 'Points', 'Question Type', 'Explanation'],
      ['B', 'Right', 'Pick the right one', 'Wrong', '3', 'Single Choice', 'Because.'],
    ];
    const r = parseQuizSheet(rows);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({
      kind: 'SINGLE',
      promptEn: 'Pick the right one',
      weight: 3,
      explanationEn: 'Because.',
      options: [
        { labelEn: 'Wrong', correct: false },
        { labelEn: 'Right', correct: true },
      ],
    });
  });

  it('skips blank rows (before the header too) but keeps the sheet row numbers in errors', () => {
    const rows = [[], ['', ''], H, row({ type: 'single', question: 'Q1', option1: 'a', option2: 'b', correct: '1' }), ['', '', ''], row({ type: 'single', question: '', option1: 'a', option2: 'b', correct: '1' })];
    const r = parseQuizSheet(rows);
    expect(r.questions).toHaveLength(1);
    expect(r.rowCount).toBe(2);
    expect(r.errors).toEqual([{ row: 6, code: 'NO_QUESTION', message: 'The question is empty' }]);
  });

  it.each([
    ['single', 'SINGLE'],
    ['Single choice', 'SINGLE'],
    ['MCQ', 'SINGLE'],
    ['single_choice', 'SINGLE'],
    ['multiple', 'MULTIPLE'],
    ['multi', 'MULTIPLE'],
    ['Checkbox', 'MULTIPLE'],
    ['multiple-choice', 'MULTIPLE'],
    ['true_false', 'TRUE_FALSE'],
    ['tf', 'TRUE_FALSE'],
    ['TF', 'TRUE_FALSE'],
    ['boolean', 'TRUE_FALSE'],
    ['True or False', 'TRUE_FALSE'],
    ['true/false', 'TRUE_FALSE'],
  ])('type alias %s → %s', (type, kind) => {
    const correct = kind === 'TRUE_FALSE' ? 'false' : '1';
    const r = parseQuizSheet([H, row({ type, question: 'Q', option1: 'a', option2: 'b', correct })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.kind).toBe(kind);
  });

  it.each([
    ['2', [false, true, false]],
    ['B', [false, true, false]],
    ['b', [false, true, false]],
    [' 3 ', [false, false, true]],
    ['2.0', [false, true, false]],
    ['Option 2', [false, true, false]],
  ])('single: correct %j', (correct, flags) => {
    const r = parseQuizSheet([H, row({ type: 'single', question: 'Q', option1: 'a', option2: 'b', option3: 'c', correct })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.options.map((o) => o.correct)).toEqual(flags);
  });

  it.each([
    ['1,3', [true, false, true, false]],
    ['1, 3', [true, false, true, false]],
    ['1;3', [true, false, true, false]],
    ['1 3', [true, false, true, false]],
    ['1 and 3', [true, false, true, false]],
    ['A,C', [true, false, true, false]],
    ['a, c, d', [true, false, true, true]],
    ['3,1,3', [true, false, true, false]],
    ['2', [false, true, false, false]],
  ])('multiple: correct %j', (correct, flags) => {
    const r = parseQuizSheet([H, row({ type: 'multiple', question: 'Q', option1: 'a', option2: 'b', option3: 'c', option4: 'd', correct })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.options.map((o) => o.correct)).toEqual(flags);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['T', true],
    ['yes', true],
    ['1', true],
    ['صح', true],
    ['false', false],
    ['False', false],
    ['no', false],
    ['0', false],
    ['2', false],
    ['خطأ', false],
  ])('true/false: correct %j → %s; the labels are always True and False', (correct, isTrue) => {
    // Option cells are ignored for true/false.
    const r = parseQuizSheet([H, row({ type: 'true_false', question: 'Q', option1: 'Yes', option2: 'No', correct })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.options).toEqual([
      { labelEn: 'True', correct: isTrue },
      { labelEn: 'False', correct: !isTrue },
    ]);
  });

  it('guesses the type when the column is missing or empty', () => {
    const r = parseQuizSheet([
      ['question', 'option1', 'option2', 'option3', 'correct'],
      ['One right', 'a', 'b', '', '2'],
      ['Two right', 'a', 'b', 'c', '1,3'],
      ['A fact', '', '', '', 'true'],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.kind)).toEqual(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']);
  });

  it('keeps option numbers when options are skipped, so "correct" still points at the right one', () => {
    const r = parseQuizSheet([H, row({ type: 'single', question: 'Q', option1: 'a', option3: 'c', correct: '3' })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.options).toEqual([
      { labelEn: 'a', correct: false },
      { labelEn: 'c', correct: true },
    ]);
  });

  it('reads up to six options', () => {
    const r = parseQuizSheet([H, row({ type: 'multiple', question: 'Q', option1: '1', option2: '2', option3: '3', option4: '4', option5: '5', option6: '6', correct: 'F' })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]!.options).toHaveLength(6);
    expect(r.questions[0]!.options[5]).toEqual({ labelEn: '6', correct: true });
  });

  it('weights: empty is 1, whole numbers 1–100 only', () => {
    const base = { type: 'single', question: 'Q', option1: 'a', option2: 'b', correct: '1' };
    expect(parseQuizSheet([H, row({ ...base, weight: '' })]).questions[0]!.weight).toBe(1);
    expect(parseQuizSheet([H, row({ ...base, weight: '5' })]).questions[0]!.weight).toBe(5);
    expect(parseQuizSheet([H, row({ ...base, weight: '100' })]).questions[0]!.weight).toBe(100);
    for (const weight of ['0', '101', '1.5', '-2', 'two']) {
      const r = parseQuizSheet([H, row({ ...base, weight })]);
      expect(r.errors, weight).toEqual([expect.objectContaining({ row: 2, code: 'BAD_WEIGHT', params: { value: weight } })]);
      expect(r.questions).toEqual([]);
    }
  });

  it('reports every bad row with its row number and a reason', () => {
    const rows = [
      H,
      row({ type: 'single', question: 'ok', option1: 'a', option2: 'b', correct: '1' }),
      row({ type: 'essay', question: 'Q', option1: 'a', option2: 'b', correct: '1' }),
      row({ type: 'single', question: 'Q', option1: 'a', option2: 'b', correct: '' }),
      row({ type: 'single', question: 'Q', option1: 'a', correct: '1' }),
      row({ type: 'single', question: 'Q', option1: 'a', option2: 'b', correct: 'Z' }),
      row({ type: 'single', question: 'Q', option1: 'a', option2: 'b', correct: '4' }),
      row({ type: 'single', question: 'Q', option1: 'a', option2: 'b', correct: '1,2' }),
      row({ type: 'true_false', question: 'Q', correct: 'maybe' }),
      row({ type: 'multiple', question: 'Q', option1: 'a', option2: 'b', correct: '7' }),
      row({ type: 'single', question: 'x'.repeat(2001), option1: 'a', option2: 'b', correct: '1' }),
      row({ type: 'single', question: 'Q', option1: 'y'.repeat(501), option2: 'b', correct: '1' }),
    ];
    const r = parseQuizSheet(rows);
    expect(r.questions).toHaveLength(1);
    expect(r.errors.map((e) => [e.row, e.code])).toEqual([
      [3, 'UNKNOWN_TYPE'],
      [4, 'NO_CORRECT'],
      [5, 'TOO_FEW_OPTIONS'],
      [6, 'BAD_CORRECT'],
      [7, 'CORRECT_NOT_AN_OPTION'],
      [8, 'ONE_CORRECT'],
      [9, 'BAD_TRUE_FALSE'],
      [10, 'BAD_CORRECT'],
      [11, 'TOO_LONG'],
      [12, 'TOO_LONG'],
    ]);
    expect(r.errors[0]).toMatchObject({ params: { value: 'essay' }, message: expect.stringContaining('single, multiple or true_false') });
    expect(r.errors[4]).toMatchObject({ params: { n: 4 } });
    expect(r.errors[8]).toMatchObject({ params: { column: 'question', max: 2000 } });
    expect(r.errors[9]).toMatchObject({ params: { column: 'option', max: 500 } });
  });

  it('needs a header with question and correct columns', () => {
    expect(parseQuizSheet([]).errors).toEqual([expect.objectContaining({ row: 1, code: 'EMPTY' })]);
    expect(parseQuizSheet([[''], ['  ']]).errors).toEqual([expect.objectContaining({ code: 'EMPTY' })]);
    expect(parseQuizSheet([['Which tool?', 'MLflow', 'Nginx', '1']]).errors.map((e) => [e.row, e.code, e.params?.column])).toEqual([
      [1, 'MISSING_COLUMN', 'question'],
      [1, 'MISSING_COLUMN', 'correct'],
    ]);
    expect(parseQuizSheet([H]).errors).toEqual([expect.objectContaining({ row: 2, code: 'EMPTY' })]);
  });

  it(`stops at ${MAX_QUESTIONS} questions`, () => {
    const q = (i: number) => row({ type: 'single', question: `Q${i}`, option1: 'a', option2: 'b', correct: '1' });
    const exact = parseQuizSheet([H, ...Array.from({ length: MAX_QUESTIONS }, (_, i) => q(i))]);
    expect(exact.errors).toEqual([]);
    expect(exact.questions).toHaveLength(MAX_QUESTIONS);
    const over = parseQuizSheet([H, ...Array.from({ length: MAX_QUESTIONS + 5 }, (_, i) => q(i))]);
    expect(over.errors).toEqual([expect.objectContaining({ row: MAX_QUESTIONS + 2, code: 'TOO_MANY_QUESTIONS', params: { max: MAX_QUESTIONS } })]);
  });

  it('trims cells and drops the apostrophe that guards a formula character', () => {
    const r = parseQuizSheet([H, row({ type: 'single', question: "  '=1+1, is it 2?  ", option1: "'-1", option2: ' two ', correct: '2' })]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({ promptEn: '=1+1, is it 2?', options: [{ labelEn: '-1' }, { labelEn: 'two' }] });
  });

  it('works on CSV parsed with keepEmpty (quoted commas, line breaks, Arabic text)', () => {
    const csv = '\uFEFFtype,question,option1,option2,correct\r\nsingle,"Pick one, please","a ""quoted"" one","line\nbreak",B\r\n\r\nsingle,ما هو MLflow؟,أداة,لغة,1\r\n';
    const r = parseQuizSheet(parseCsv(csv, { keepEmpty: true }));
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.promptEn)).toEqual(['Pick one, please', 'ما هو MLflow؟']);
    expect(r.questions[0]!.options.map((o) => o.labelEn)).toEqual(['a "quoted" one', 'line\nbreak']);
    // Without keepEmpty the blank row is dropped: row numbers then drift.
    expect(parseCsv(csv)).toHaveLength(3);
    expect(parseCsv(csv, { keepEmpty: true })).toHaveLength(4);
  });
});

describe('sheetCellsToText', () => {
  it('turns spreadsheet values into text', () => {
    expect(sheetCellsToText([[null, undefined, true, false, 2, 2.5, 0.1 + 0.2, 'x', new Date('2026-01-02T00:00:00Z')]])).toEqual([
      ['', '', 'true', 'false', '2', '2.5', '0.3', 'x', '2026-01-02T00:00:00.000Z'],
    ]);
  });
});

describe('trueFalseKey', () => {
  it('localises the standard labels by position and leaves custom wording alone', () => {
    expect(trueFalseKey('TRUE_FALSE', 'True', 0)).toBe('true');
    expect(trueFalseKey('TRUE_FALSE', 'false', 1)).toBe('false');
    expect(trueFalseKey('TRUE_FALSE', 'صح', 0)).toBe('true');
    expect(trueFalseKey('TRUE_FALSE', 'Agree', 0)).toBeNull();
    expect(trueFalseKey('SINGLE', 'True', 0)).toBeNull();
  });
});

describe('writeXlsx', () => {
  it('writes a ZIP with the workbook parts and escaped inline strings', () => {
    const bytes = writeXlsx([['a', '<b> & "c"'], ['', 'عربي']]);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      expect(text).toContain(part);
    }
    expect(text).toContain('<c r="B1" t="inlineStr"><is><t xml:space="preserve">&lt;b&gt; &amp; &quot;c&quot;</t></is></c>');
    expect(text).toContain('<row r="2"><c r="B2"');
    expect(text).toContain('عربي');
  });

  it('computes standard CRC-32s', () => {
    // The CRC of "123456789" is the well-known check value 0xCBF43926.
    const zip = zipStored([{ name: 'x', data: new TextEncoder().encode('123456789') }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0xcbf43926);
  });
});
