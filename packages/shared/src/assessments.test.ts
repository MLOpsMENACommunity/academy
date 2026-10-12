import { describe, expect, it } from 'vitest';
import {
  answersRevealed,
  assessmentInputSchema,
  assessmentOrderSchema,
  MAX_QUESTIONS,
  assessmentResult,
  attemptEnd,
  attemptsLeft,
  countedAttempt,
  gradeQuiz,
  hasPassed,
  isDriveUrl,
  parseGithubRepoUrl,
  quizClosedReason,
  seededShuffle,
  summarizeResults,
  workClosedReason,
  type GradableQuestion,
} from './assessments';

const q = (id: string, kind: GradableQuestion['kind'], weight: number, correct: string[], all: string[]): GradableQuestion => ({
  id,
  kind,
  weight,
  options: all.map((o) => ({ id: o, correct: correct.includes(o) })),
});

describe('gradeQuiz', () => {
  const questions = [
    q('q1', 'SINGLE', 1, ['a'], ['a', 'b', 'c']),
    q('q2', 'MULTIPLE', 3, ['a', 'c'], ['a', 'b', 'c']),
    q('q3', 'TRUE_FALSE', 2, ['t'], ['t', 'f']),
  ];

  it('scores by weight, scaled to max points', () => {
    const g = gradeQuiz(questions, { q1: ['a'], q2: ['a', 'c'], q3: ['f'] }, 100);
    expect(g.earnedWeight).toBe(4);
    expect(g.totalWeight).toBe(6);
    expect(g.score).toBe(66.67);
    expect(g.correct).toEqual({ q1: true, q2: true, q3: false });
  });

  it('is all-or-nothing for multiple choice', () => {
    expect(gradeQuiz(questions, { q2: ['a'] }, 6).correct.q2).toBe(false);
    expect(gradeQuiz(questions, { q2: ['a', 'b', 'c'] }, 6).correct.q2).toBe(false);
    expect(gradeQuiz(questions, { q2: ['c', 'a'] }, 6).score).toBe(3);
  });

  it('ignores unknown ids, duplicates and unanswered questions', () => {
    expect(gradeQuiz(questions, { q1: ['zzz'] }, 10).score).toBe(0);
    expect(gradeQuiz(questions, { q1: ['a', 'a'] }, 6).score).toBe(1);
    expect(gradeQuiz(questions, {}, 10).score).toBe(0);
    expect(gradeQuiz(questions, { nope: ['a'] }, 10).score).toBe(0);
  });

  it('gives full marks for a perfect quiz and handles an empty one', () => {
    expect(gradeQuiz(questions, { q1: ['a'], q2: ['a', 'c'], q3: ['t'] }, 20).score).toBe(20);
    expect(gradeQuiz([], {}, 20).score).toBe(0);
  });
});

describe('attempts and the counted score', () => {
  const at = (attempt: number, score: number | null, submitted = true) => ({ attempt, score, submittedAt: submitted ? new Date() : null });

  it('picks the best or the last graded attempt', () => {
    const list = [at(1, 80), at(2, 60), at(3, null, false)];
    expect(countedAttempt(list, 'BEST')?.attempt).toBe(1);
    expect(countedAttempt(list, 'LAST')?.attempt).toBe(2);
    expect(countedAttempt([at(1, 70), at(2, 70)], 'BEST')?.attempt).toBe(1);
    expect(countedAttempt([at(1, null, false)], 'BEST')).toBeNull();
  });

  it('counts attempts left (0 = unlimited)', () => {
    expect(attemptsLeft(0, 50)).toBeNull();
    expect(attemptsLeft(3, 1)).toBe(2);
    expect(attemptsLeft(1, 2)).toBe(0);
  });

  it('passes at the pass mark', () => {
    expect(hasPassed(7, 10, 70)).toBe(true);
    expect(hasPassed(6.99, 10, 70)).toBe(false);
    expect(hasPassed(null, 10, 0)).toBe(false);
  });
});

describe('reveal rules', () => {
  const base = { attemptsAllowed: 2, dueAt: null as Date | null, submitted: 1, inProgress: false };
  const now = new Date('2026-11-10T10:00:00Z');

  it('NEVER never reveals', () => {
    expect(answersRevealed({ ...base, revealAnswers: 'NEVER', submitted: 2 })).toBe(false);
  });

  it('AFTER_SUBMIT waits for the last attempt (or every attempt when unlimited)', () => {
    expect(answersRevealed({ ...base, revealAnswers: 'AFTER_SUBMIT' })).toBe(false);
    expect(answersRevealed({ ...base, revealAnswers: 'AFTER_SUBMIT', submitted: 2 })).toBe(true);
    expect(answersRevealed({ ...base, revealAnswers: 'AFTER_SUBMIT', attemptsAllowed: 0 })).toBe(true);
    expect(answersRevealed({ ...base, revealAnswers: 'AFTER_SUBMIT', attemptsAllowed: 0, inProgress: true })).toBe(false);
    expect(answersRevealed({ ...base, revealAnswers: 'AFTER_SUBMIT', submitted: 0, attemptsAllowed: 0 })).toBe(false);
  });

  it('AFTER_DUE waits for the due date, and only for students who submitted', () => {
    const r = { ...base, revealAnswers: 'AFTER_DUE' as const, now };
    expect(answersRevealed({ ...r, dueAt: new Date('2026-11-11T00:00:00Z') })).toBe(false);
    expect(answersRevealed({ ...r, dueAt: new Date('2026-11-09T00:00:00Z') })).toBe(true);
    expect(answersRevealed({ ...r, dueAt: new Date('2026-11-09T00:00:00Z'), submitted: 0 })).toBe(false);
  });

  it('closes a quiz once answers are out after the due date', () => {
    const a = { status: 'PUBLISHED' as const, allowLate: true, attemptsAllowed: 3, started: 1, submitted: 1, now };
    expect(quizClosedReason({ ...a, revealAnswers: 'AFTER_DUE', dueAt: new Date('2026-11-09T00:00:00Z') })).toBe('ANSWERS_REVEALED');
    expect(quizClosedReason({ ...a, revealAnswers: 'AFTER_SUBMIT', dueAt: null })).toBeNull();
    expect(quizClosedReason({ ...a, revealAnswers: 'NEVER', dueAt: null, started: 3 })).toBe('NO_ATTEMPTS');
    expect(quizClosedReason({ ...a, revealAnswers: 'NEVER', dueAt: new Date('2026-11-09T00:00:00Z'), allowLate: false })).toBe('PAST_DUE');
    expect(quizClosedReason({ ...a, status: 'DRAFT', revealAnswers: 'NEVER', dueAt: null })).toBe('NOT_PUBLISHED');
  });

  it('lets labs be resubmitted until the due date or the grade', () => {
    const w = { status: 'PUBLISHED' as const, dueAt: new Date('2026-11-09T00:00:00Z'), allowLate: true, now };
    expect(workClosedReason({ ...w, hasSubmission: false, graded: false })).toBeNull();
    expect(workClosedReason({ ...w, hasSubmission: true, graded: false })).toBe('PAST_DUE');
    expect(workClosedReason({ ...w, allowLate: false, hasSubmission: false, graded: false })).toBe('PAST_DUE');
    expect(workClosedReason({ ...w, dueAt: null, hasSubmission: true, graded: true })).toBe('GRADED');
    expect(workClosedReason({ ...w, dueAt: null, hasSubmission: true, graded: false })).toBeNull();
  });
});

describe('attemptEnd', () => {
  const start = new Date('2026-11-10T10:00:00Z');
  it('ends at the time limit or a hard due date, whichever is first', () => {
    expect(attemptEnd({ timeLimitMin: 20, dueAt: null, allowLate: true }, start)?.toISOString()).toBe('2026-11-10T10:20:00.000Z');
    expect(attemptEnd({ timeLimitMin: 20, dueAt: '2026-11-10T10:05:00Z', allowLate: false }, start)?.toISOString()).toBe('2026-11-10T10:05:00.000Z');
    expect(attemptEnd({ timeLimitMin: null, dueAt: '2026-11-10T10:05:00Z', allowLate: true }, start)).toBeNull();
    expect(attemptEnd({ timeLimitMin: null, dueAt: '2026-11-10T11:00:00Z', allowLate: false }, start)?.toISOString()).toBe('2026-11-10T11:00:00.000Z');
  });
});

describe('URLs', () => {
  it('parses GitHub repository links', () => {
    expect(parseGithubRepoUrl('https://github.com/mlops-mena/academy')).toEqual({ owner: 'mlops-mena', repo: 'academy' });
    expect(parseGithubRepoUrl('https://www.github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(parseGithubRepoUrl('https://github.com/a/my.repo_1/tree/main/src')).toEqual({ owner: 'a', repo: 'my.repo_1' });
    expect(parseGithubRepoUrl(' https://github.com/a/b/ ')).toEqual({ owner: 'a', repo: 'b' });
  });

  it('rejects anything that is not a GitHub repository', () => {
    for (const bad of [
      'http://github.com/a/b',
      'https://github.com/a',
      'https://gitlab.com/a/b',
      'https://github.com.evil.com/a/b',
      'https://user:pw@github.com/a/b',
      'https://github.com/-bad/b',
      'https://github.com/a/..',
      'github.com/a/b',
      'javascript:alert(1)',
    ]) {
      expect(parseGithubRepoUrl(bad)).toBeNull();
    }
  });

  it('accepts only Google Drive and Docs links', () => {
    expect(isDriveUrl('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe(true);
    expect(isDriveUrl('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(isDriveUrl('http://drive.google.com/file/d/abc')).toBe(false);
    expect(isDriveUrl('https://drive.google.com.evil.io/x')).toBe(false);
    expect(isDriveUrl('https://evil.io/?drive.google.com')).toBe(false);
    expect(isDriveUrl('not a url')).toBe(false);
  });
});

describe('results', () => {
  const a = { id: 'a1', type: 'QUIZ' as const, titleEn: 'Q', titleAr: 'Q', maxPoints: 20, passPercent: 70, countsForCertificate: true, scoring: 'BEST' as const };
  const s = (attempt: number, score: number | null, late = false) => ({ attempt, score, late, submittedAt: new Date() });

  it('reports best, last, counted, pass and pending', () => {
    const r = assessmentResult(a, [s(1, 16), s(2, 10, true)]);
    expect(r).toMatchObject({ attempts: 2, best: 16, last: 10, score: 16, percent: 80, passed: true, pending: false, late: false });
    const last = assessmentResult({ ...a, scoring: 'LAST' }, [s(1, 16), s(2, 10, true)]);
    expect(last).toMatchObject({ score: 10, passed: false, late: true });
    expect(assessmentResult({ ...a, type: 'LAB' }, [s(1, null)])).toMatchObject({ score: null, pending: true, passed: false });
    expect(assessmentResult(a, [])).toMatchObject({ attempts: 0, score: null, passed: false });
  });

  it('totals a course', () => {
    const results = [assessmentResult(a, [s(1, 16)]), assessmentResult({ ...a, id: 'a2', maxPoints: 80, countsForCertificate: false }, [s(1, 40)])];
    expect(summarizeResults('u', 'c', results)).toMatchObject({
      total: { earned: 56, possible: 100, percent: 56 },
      certificate: { required: 1, passed: 1, allPassed: true },
    });
  });
});

describe('assessment input', () => {
  const quiz = {
    type: 'QUIZ',
    titleEn: 'Midpoint quiz',
    titleAr: 'اختبار منتصف الدورة',
    questions: [{ kind: 'SINGLE', promptEn: 'P', promptAr: 'P', weight: 1, options: [{ labelEn: 'a', labelAr: 'a', correct: true }, { labelEn: 'b', labelAr: 'b', correct: false }] }],
  };

  it('accepts a quiz and applies defaults', () => {
    const r = assessmentInputSchema.parse(quiz);
    expect(r).toMatchObject({ status: 'DRAFT', attemptsAllowed: 1, scoring: 'BEST', revealAnswers: 'AFTER_SUBMIT', maxPoints: 100, dueAt: null });
  });

  it('checks the answer key shape', () => {
    const two = { ...quiz.questions[0]!, options: quiz.questions[0]!.options.map((o) => ({ ...o, correct: true })) };
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: [two] }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: [{ ...two, kind: 'MULTIPLE' }] }).success).toBe(true);
    const three = { ...quiz.questions[0]!, kind: 'TRUE_FALSE', options: [...quiz.questions[0]!.options, { labelEn: 'c', labelAr: 'c', correct: false }] };
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: [three] }).success).toBe(false);
  });

  it('needs questions to publish, a due date to reveal after it, and a submission type for labs', () => {
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: [], status: 'PUBLISHED' }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, revealAnswers: 'AFTER_DUE' }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, revealAnswers: 'AFTER_DUE', dueAt: '2026-11-10T10:00:00Z' }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, revealAnswers: 'AFTER_DUE', dueAt: '2026-11-10T10:00:00Z', allowLate: false }).success).toBe(true);
    expect(assessmentInputSchema.safeParse({ ...quiz, attemptsAllowed: 0, countsForCertificate: true }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, attemptsAllowed: 0, countsForCertificate: true, revealAnswers: 'NEVER' }).success).toBe(true);
    expect(assessmentInputSchema.safeParse({ ...quiz, type: 'LAB', questions: [] }).success).toBe(false);
    expect(assessmentInputSchema.safeParse({ ...quiz, type: 'LAB', questions: [], submissionKind: 'GITHUB_REPO' }).success).toBe(true);
  });

  it('takes English only: Arabic left out stays out (kept as stored), and no order means "keep" or "last"', () => {
    const english = {
      type: 'QUIZ',
      titleEn: 'English only',
      questions: [{ kind: 'SINGLE', promptEn: 'P', weight: 1, explanationEn: 'Why', options: [{ labelEn: 'a', correct: true }, { labelEn: 'b', correct: false }] }],
    };
    const r = assessmentInputSchema.parse(english);
    for (const k of ['titleAr', 'instructionsAr', 'order']) expect(k in r, k).toBe(false);
    expect('promptAr' in r.questions[0]!).toBe(false);
    expect('explanationAr' in r.questions[0]!).toBe(false);
    expect(r.questions[0]!.options.every((o) => !('labelAr' in o))).toBe(true);
    // Sent on purpose, Arabic is still taken (an empty explanation clears it).
    const both = assessmentInputSchema.parse({ ...quiz, questions: [{ ...quiz.questions[0]!, explanationAr: '' }] });
    expect(both).toMatchObject({ titleAr: 'اختبار منتصف الدورة', questions: [{ promptAr: 'P', explanationAr: null, options: [{ labelAr: 'a' }, { labelAr: 'b' }] }] });
    expect(assessmentInputSchema.safeParse({ ...english, titleEn: 'x' }).success).toBe(false);
  });

  it('takes up to MAX_QUESTIONS questions', () => {
    const q = quiz.questions[0]!;
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: Array.from({ length: MAX_QUESTIONS }, () => q) }).success).toBe(true);
    expect(assessmentInputSchema.safeParse({ ...quiz, questions: Array.from({ length: MAX_QUESTIONS + 1 }, () => q) }).success).toBe(false);
  });
});

describe('assessment order', () => {
  it('takes each id once', () => {
    expect(assessmentOrderSchema.safeParse({ ids: ['a', 'b'] }).success).toBe(true);
    expect(assessmentOrderSchema.safeParse({ ids: ['a', 'a'] }).success).toBe(false);
    expect(assessmentOrderSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe('seededShuffle', () => {
  it('is stable per seed and keeps every item', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = seededShuffle(items, 'attempt-1');
    expect(seededShuffle(items, 'attempt-1')).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(seededShuffle(items, 'attempt-2')).not.toEqual(a);
  });
});
