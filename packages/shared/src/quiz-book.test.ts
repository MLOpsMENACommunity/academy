import { describe, expect, it } from 'vitest';
import { MAX_QUESTIONS } from './assessments';
import { toCsv } from './admin';
import { parseCsv } from './csv';
import {
  parseDueCell,
  parseQuizBook,
  parseSessionCell,
  QUIZ_BOOK_COLUMNS,
  QUIZ_BOOK_EXAMPLE,
  QUIZ_BOOK_MAX_QUESTIONS,
  QUIZ_BOOK_MAX_QUIZZES,
  quizImportSchema,
} from './quiz-book';
import { sheetCellsToText } from './quiz-sheet';

type Col = (typeof QUIZ_BOOK_COLUMNS)[number];
const H = [...QUIZ_BOOK_COLUMNS];
const row = (o: Partial<Record<Col, string>>) => H.map((h) => o[h] ?? '');
const q = (quiz: string, session: string, extra: Partial<Record<Col, string>> = {}) =>
  row({ quiz, session, type: 'single', question: `${quiz} question`, option1: 'A', option2: 'B', correct: '1', ...extra });

describe('parseQuizBook', () => {
  it('reads the template: two quizzes on sessions 1 and 2, every type, weights and settings', () => {
    const r = parseQuizBook(QUIZ_BOOK_EXAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(6);
    expect(r.questionCount).toBe(6);
    expect(r.quizzes.map((x) => [x.assessment.titleEn, x.session, x.row])).toEqual([
      ['Session 1 check-in', 1, 2],
      ['Session 2 review', 2, 5],
    ]);
    const [s1, s2] = r.quizzes.map((x) => x.assessment);
    expect(s1!.questions.map((x) => [x.kind, x.weight])).toEqual([
      ['SINGLE', 1],
      ['MULTIPLE', 2],
      ['TRUE_FALSE', 1],
    ]);
    expect(s2!.questions.map((x) => [x.kind, x.weight])).toEqual([
      ['SINGLE', 2],
      ['MULTIPLE', 3],
      ['TRUE_FALSE', 1],
    ]);
    expect(s1).toMatchObject({
      type: 'QUIZ',
      status: 'DRAFT',
      passPercent: 70,
      // 20:00 Cairo on 1 March 2027 (winter time, UTC+2).
      dueAt: new Date('2027-03-01T18:00:00.000Z'),
      attemptsAllowed: 2,
      timeLimitMin: 15,
      revealAnswers: 'AFTER_SUBMIT',
      countsForCertificate: true,
      maxPoints: 10,
      allowLate: true,
    });
    expect(s1!.instructionsEn).toMatch(/two attempts/);
    expect(s2).toMatchObject({ passPercent: 60, dueAt: null, attemptsAllowed: 1, revealAnswers: 'NEVER', countsForCertificate: false, status: 'DRAFT', maxPoints: 100 });
  });

  it('survives a CSV round trip of the template', () => {
    const [header, ...rest] = QUIZ_BOOK_EXAMPLE;
    const r = parseQuizBook(parseCsv(toCsv(header!, rest), { keepEmpty: true }));
    expect(r.errors).toEqual([]);
    expect(r.quizzes).toHaveLength(2);
  });

  it('groups rows by title in any case, wherever they are, and defaults to draft', () => {
    const r = parseQuizBook([H, q('Week quiz', '1'), q('Other', 'course'), q('WEEK QUIZ ', '', { question: 'Second' }), [], q('other', '')]);
    expect(r.errors).toEqual([]);
    expect(r.quizzes.map((x) => [x.assessment.titleEn, x.session, x.assessment.questions.length, x.assessment.status])).toEqual([
      ['Week quiz', 1, 2, 'DRAFT'],
      ['Other', null, 2, 'DRAFT'],
    ]);
  });

  it('accepts header aliases in any case and order', () => {
    const header = ['Correct Answer', 'Quiz Title', 'Session #', 'Question', 'Option A', 'Option B', 'Points', 'Pass %', 'Deadline', 'Max attempts', 'Time limit', 'Show answers', 'Required', 'Publish', 'Max points'];
    const r = parseQuizBook([header, ['B', 'Aliased', 'Session 3', 'Pick B', 'A', 'B', '4', '80%', '2026-12-01', 'unlimited', '30 min', 'never', 'no', 'published', '50']]);
    expect(r.errors).toEqual([]);
    expect(r.quizzes[0]).toMatchObject({
      session: 3,
      assessment: {
        titleEn: 'Aliased',
        passPercent: 80,
        // A date alone: 23:59 Cairo.
        dueAt: new Date('2026-12-01T21:59:00.000Z'),
        attemptsAllowed: 0,
        timeLimitMin: 30,
        revealAnswers: 'NEVER',
        countsForCertificate: false,
        status: 'PUBLISHED',
        maxPoints: 50,
      },
    });
    expect(r.quizzes[0]!.assessment.questions[0]).toMatchObject({ weight: 4, options: [{ correct: false }, { correct: true }] });
  });

  it('takes settings from the first row of each quiz only', () => {
    const r = parseQuizBook([H, q('Quiz', '1', { pass_percent: '55', attempts: '3' }), q('Quiz', '1', { pass_percent: 'nonsense', attempts: '99' })]);
    expect(r.errors).toEqual([]);
    expect(r.quizzes[0]!.assessment).toMatchObject({ passPercent: 55, attemptsAllowed: 3 });
  });

  it('turns off late work when answers are revealed after the due date', () => {
    const r = parseQuizBook([H, q('Quiz', '1', { reveal: 'after_due', due: '2026-11-20 18:00' })]);
    expect(r.errors).toEqual([]);
    expect(r.quizzes[0]!.assessment).toMatchObject({ revealAnswers: 'AFTER_DUE', allowLate: false, dueAt: new Date('2026-11-20T16:00:00.000Z') });
  });

  it('reports each bad setting with its sheet row and quiz', () => {
    const r = parseQuizBook([
      H,
      q('Bad session', 'two'),
      q('Bad pass', '1', { pass_percent: '120' }),
      q('Bad due', '1', { due: '2026-02-30 10:00' }),
      q('Bad attempts', '1', { attempts: '21' }),
      q('Bad limit', '1', { time_limit_min: '601' }),
      q('Bad reveal', '1', { reveal: 'sometimes' }),
      q('Bad mandatory', '1', { mandatory: 'maybe' }),
      q('Bad status', '1', { status: 'archived' }),
      q('Bad max', '1', { max_points: '0' }),
      q('Needs due', '1', { reveal: 'after_due' }),
      q('Practice', '1', { attempts: '0', reveal: 'after_submit', mandatory: 'yes' }),
      q('X', '1'),
    ]);
    expect(r.quizzes).toEqual([]);
    expect(r.errors.map((e) => [e.row, e.code, e.quiz])).toEqual([
      [2, 'BAD_SESSION', 'Bad session'],
      [3, 'BAD_PASS_PERCENT', 'Bad pass'],
      [4, 'BAD_DUE', 'Bad due'],
      [5, 'BAD_ATTEMPTS', 'Bad attempts'],
      [6, 'BAD_TIME_LIMIT', 'Bad limit'],
      [7, 'BAD_REVEAL', 'Bad reveal'],
      [8, 'BAD_MANDATORY', 'Bad mandatory'],
      [9, 'BAD_STATUS', 'Bad status'],
      [10, 'BAD_MAX_POINTS', 'Bad max'],
      [11, 'REVEAL_NEEDS_DUE', 'Needs due'],
      [12, 'PRACTICE_CERTIFICATE', 'Practice'],
      [13, 'BAD_TITLE', 'X'],
    ]);
  });

  it('keeps question errors at their own sheet rows, and flags a row that names another session', () => {
    const r = parseQuizBook([H, q('Quiz A', '1'), [], q('Quiz B', '2', { correct: '9' }), q('Quiz A', '2'), row({ session: '1', question: 'No quiz', correct: '1' })]);
    expect(r.errors.map((e) => [e.row, e.code])).toEqual([
      [4, 'BAD_CORRECT'],
      [5, 'SESSION_MISMATCH'],
      [6, 'NO_QUIZ_TITLE'],
    ]);
    expect(r.quizzes).toEqual([]);
  });

  it('still returns the quizzes without problems, for the preview', () => {
    const r = parseQuizBook([H, q('Good quiz', '1'), q('Bad quiz', '2', { correct: '9' })]);
    expect(r.errors.map((e) => e.quiz)).toEqual(['Bad quiz']);
    expect(r.quizzes.map((x) => x.assessment.titleEn)).toEqual(['Good quiz']);
  });

  it('needs the quiz, question and correct columns', () => {
    expect(parseQuizBook([['session', 'question', 'correct'], ['1', 'x', 'true']]).errors).toEqual([expect.objectContaining({ row: 1, code: 'MISSING_COLUMN', params: { column: 'quiz' } })]);
    expect(parseQuizBook([['quiz', 'question'], ['Q', 'x']]).errors.map((e) => e.params?.column)).toEqual(['correct']);
    expect(parseQuizBook([]).errors[0]!.code).toBe('EMPTY');
    expect(parseQuizBook([H, []]).errors[0]!.code).toBe('EMPTY');
  });

  it('enforces the limits: quizzes per file, questions per file and per quiz', () => {
    const many = [H, ...Array.from({ length: QUIZ_BOOK_MAX_QUIZZES + 1 }, (_, i) => q(`Quiz ${i}`, '1'))];
    expect(parseQuizBook(many).errors).toEqual([expect.objectContaining({ code: 'TOO_MANY_QUIZZES', params: { max: 30, count: 31 } })]);
    const lots = [H, ...Array.from({ length: QUIZ_BOOK_MAX_QUESTIONS + 1 }, (_, i) => q(`Quiz ${i % 10}`, '1'))];
    expect(parseQuizBook(lots).errors).toEqual([expect.objectContaining({ code: 'TOO_MANY_QUESTIONS', params: { max: 1000, count: 1001 } })]);
    const long = [H, ...Array.from({ length: MAX_QUESTIONS + 1 }, () => q('Long', '1'))];
    expect(parseQuizBook(long).errors).toEqual([expect.objectContaining({ code: 'QUIZ_TOO_MANY_QUESTIONS', row: MAX_QUESTIONS + 2, quiz: 'Long' })]);
  });

  it('reads Excel date cells as Cairo wall-clock time', () => {
    const cells = sheetCellsToText([[...H], q('Quiz', '1').map((v, i) => (H[i] === 'due' ? new Date('2026-11-20T18:00:00Z') : v))], { dates: 'wallClock' });
    expect(cells[1]![H.indexOf('due')]).toBe('2026-11-20 18:00');
    expect(parseQuizBook(cells).quizzes[0]!.assessment.dueAt).toEqual(new Date('2026-11-20T16:00:00.000Z'));
  });
});

describe('parseSessionCell / parseDueCell', () => {
  it('reads session numbers and course-level words', () => {
    expect(['1', '2.0', 'Session 4', 's5', '#6'].map(parseSessionCell)).toEqual([1, 2, 4, 5, 6]);
    expect(['', 'course', 'Course level', 'none', '-'].map(parseSessionCell)).toEqual([null, null, null, null, null]);
    expect(['two', '-1', '1000', '1.5'].map(parseSessionCell)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('reads Cairo wall-clock times, dates alone and zoned ISO instants', () => {
    // Summer time (UTC+3) and winter time (UTC+2).
    expect(parseDueCell('2026-07-01 18:00')).toBe('2026-07-01T15:00:00.000Z');
    expect(parseDueCell('2026-12-01T18:00')).toBe('2026-12-01T16:00:00.000Z');
    expect(parseDueCell('2026/12/01 18:00')).toBe('2026-12-01T16:00:00.000Z');
    expect(parseDueCell('2026-12-01')).toBe('2026-12-01T21:59:00.000Z');
    expect(parseDueCell('2026-12-01T18:00:00Z')).toBe('2026-12-01T18:00:00.000Z');
    expect(parseDueCell('2026-12-01T18:00:00+04:00')).toBe('2026-12-01T14:00:00.000Z');
    for (const bad of ['tomorrow', '01/12/2026', '2026-13-01', '2026-04-31', '2026-12-01 25:00', '1999-01-01']) expect(parseDueCell(bad)).toBeNull();
  });
});

describe('quizImportSchema', () => {
  const quizzes = () => parseQuizBook(QUIZ_BOOK_EXAMPLE).quizzes.map(({ session, assessment }) => ({ session, assessment }));

  it('accepts the parsed template and defaults to skipping existing quizzes', () => {
    const r = quizImportSchema.safeParse({ quizzes: quizzes() });
    expect(r.success && r.data.replaceExisting).toBe(false);
  });

  it('refuses other types, empty quizzes, the same title twice in a session, and too much', () => {
    const [a, b] = quizzes();
    const fails = (v: unknown) => !quizImportSchema.safeParse(v).success;
    expect(fails({ quizzes: [{ ...a, assessment: { ...a!.assessment, type: 'LAB', submissionKind: 'LINK', questions: [] } }] })).toBe(true);
    expect(fails({ quizzes: [{ ...a, assessment: { ...a!.assessment, questions: [] } }] })).toBe(true);
    expect(fails({ quizzes: [a, { ...b, session: 1, assessment: { ...b!.assessment, titleEn: 'SESSION 1 CHECK-IN' } }] })).toBe(true);
    expect(fails({ quizzes: [a, { ...b, session: 2, assessment: { ...b!.assessment, titleEn: 'Session 1 check-in' } }] })).toBe(false);
    expect(fails({ quizzes: [] })).toBe(true);
    expect(fails({ quizzes: Array.from({ length: 31 }, (_, i) => ({ ...a, assessment: { ...a!.assessment, titleEn: `Quiz ${i}` } })) })).toBe(true);
    const fat = { ...a!.assessment.questions[0]! };
    const big = Array.from({ length: 6 }, (_, i) => ({ session: i + 1, assessment: { ...a!.assessment, questions: Array.from({ length: 200 }, () => fat) } }));
    expect(fails({ quizzes: big })).toBe(true);
    expect(fails({ quizzes: big.slice(0, 5) })).toBe(false);
  });
});
