import { describe, expect, it } from 'vitest';
import {
  assessmentInputSchema,
  drawQuestions,
  gradeQuiz,
  isPracticeExam,
  normalizeTopic,
  PRACTICE_EXAM_PRESET,
  topicCounts,
  topicScores,
} from './assessments';

/** 12 questions: 6 "Pods", 4 "Networking", 2 without a topic. */
const bank = Array.from({ length: 12 }, (_, i) => ({
  id: `q${String(i + 1).padStart(2, '0')}`,
  topic: i < 6 ? (i % 2 ? 'pods' : 'Pods') : i < 10 ? 'Networking' : null,
  weight: 1,
}));
const ids = (qs: { id: string }[]) => qs.map((q) => q.id);
const byTopic = (qs: { topic: string | null }[]) =>
  qs.reduce<Record<string, number>>((m, q) => {
    const k = normalizeTopic(q.topic)?.toLowerCase() ?? '';
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});

describe('drawQuestions', () => {
  it('is deterministic for a seed and returns the bank order', () => {
    const a = drawQuestions(bank, 5, 'attempt-1');
    expect(a).toHaveLength(5);
    expect(ids(drawQuestions(bank, 5, 'attempt-1'))).toEqual(ids(a));
    expect(ids(a)).toEqual([...ids(a)].sort());
    expect(new Set(ids(a)).size).toBe(5);
  });

  it('draws different questions for different seeds', () => {
    const draws = new Set(Array.from({ length: 20 }, (_, i) => ids(drawQuestions(bank, 5, `seed-${i}`)).join(',')));
    expect(draws.size).toBeGreaterThan(10);
  });

  it('returns every question when the count is null or at least the bank size', () => {
    expect(ids(drawQuestions(bank, null, 's'))).toEqual(ids(bank));
    expect(ids(drawQuestions(bank, 12, 's'))).toEqual(ids(bank));
    expect(ids(drawQuestions(bank, 500, 's'))).toEqual(ids(bank));
    expect(drawQuestions([], 5, 's')).toEqual([]);
  });

  it('balances across topics in proportion to their size (topics compared without case)', () => {
    for (let i = 0; i < 30; i++) {
      const six = drawQuestions(bank, 6, `b-${i}`, { balanceByTopic: true });
      expect(six).toHaveLength(6);
      // 6 × 6/12 = 3, 6 × 4/12 = 2, 6 × 2/12 = 1.
      expect(byTopic(six)).toEqual({ pods: 3, networking: 2, '': 1 });
      expect(ids(drawQuestions(bank, 6, `b-${i}`, { balanceByTopic: true }))).toEqual(ids(six));
    }
  });

  it('gives every topic at least one question when the count allows, never more than a topic has', () => {
    const skewed = [...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, topic: 'Big' })), { id: 'b0', topic: 'Small' }, { id: 'c0', topic: 'Tiny' }];
    for (let i = 0; i < 30; i++) {
      const three = drawQuestions(skewed, 3, `s-${i}`, { balanceByTopic: true });
      expect(byTopic(three)).toEqual({ big: 1, small: 1, tiny: 1 });
      const eleven = drawQuestions(skewed, 11, `s-${i}`, { balanceByTopic: true });
      expect(eleven).toHaveLength(11);
      expect(byTopic(eleven).small).toBe(1);
      expect(byTopic(eleven).tiny).toBe(1);
    }
    // Fewer draws than topics: still exactly the count.
    expect(drawQuestions(skewed, 2, 'x', { balanceByTopic: true })).toHaveLength(2);
  });

  it('without balancing, any mix of topics can come out', () => {
    const mixes = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(byTopic(drawQuestions(bank, 6, `m-${i}`)))));
    expect(mixes.size).toBeGreaterThan(1);
  });
});

describe('topicScores', () => {
  it('scores each topic in weights, General (no topic) last', () => {
    const qs = [
      { id: 'a', weight: 2, topic: null },
      { id: 'b', weight: 1, topic: 'Pods' },
      { id: 'c', weight: 3, topic: 'pods ' },
      { id: 'd', weight: 1, topic: 'Networking' },
    ];
    expect(topicScores(qs, { a: true, b: false, c: true, d: false })).toEqual([
      { topic: 'Pods', earned: 3, possible: 4, percent: 75 },
      { topic: 'Networking', earned: 0, possible: 1, percent: 0 },
      { topic: null, earned: 2, possible: 2, percent: 100 },
    ]);
  });

  it('is one General row when no question has a topic, matching the overall grade', () => {
    const qs = [
      { id: 'a', kind: 'SINGLE' as const, weight: 1, options: [{ id: 'x', correct: true }, { id: 'y', correct: false }] },
      { id: 'b', kind: 'SINGLE' as const, weight: 2, options: [{ id: 'x2', correct: true }, { id: 'y2', correct: false }] },
    ];
    const grade = gradeQuiz(qs, { a: ['x'], b: ['y2'] }, 30);
    expect(topicScores(qs, grade.correct)).toEqual([{ topic: null, earned: 1, possible: 3, percent: 33.3 }]);
    expect(grade).toMatchObject({ earnedWeight: 1, totalWeight: 3, score: 10 });
  });

  it('counts questions per topic for the editor', () => {
    expect(topicCounts(bank)).toEqual([
      { topic: 'Pods', count: 6 },
      { topic: 'Networking', count: 4 },
      { topic: null, count: 2 },
    ]);
  });
});

describe('practice exams in the assessment input', () => {
  const q = (i: number) => ({ kind: 'SINGLE', promptEn: `Q${i}`, weight: 1, topic: i % 2 ? 'A' : 'B', options: [{ labelEn: 'a', correct: true }, { labelEn: 'b', correct: false }] });
  const quiz = (n: number, extra: Record<string, unknown> = {}) => ({ type: 'QUIZ', titleEn: 'Practice', questions: Array.from({ length: n }, (_, i) => q(i)), ...extra });

  it('accepts the preset, and the draw count up to the number of questions', () => {
    const r = assessmentInputSchema.parse(quiz(25, PRACTICE_EXAM_PRESET));
    expect(r).toMatchObject({ drawCount: 20, balanceByTopic: true, attemptsAllowed: 0, countsForCertificate: false, timeLimitMin: 30, revealAnswers: 'AFTER_SUBMIT' });
    expect(r.questions[0]!.topic).toBe('B');
    expect(assessmentInputSchema.safeParse(quiz(20, { drawCount: 20 })).success).toBe(true);
  });

  it('refuses a draw count above the questions, outside 1–500, and long topics', () => {
    const over = assessmentInputSchema.safeParse(quiz(12, { drawCount: 13 }));
    expect(over.success).toBe(false);
    expect(over.error!.issues[0]!.path).toEqual(['drawCount']);
    expect(assessmentInputSchema.safeParse(quiz(5, { drawCount: 0 })).success).toBe(false);
    expect(assessmentInputSchema.safeParse(quiz(5, { drawCount: 501 })).success).toBe(false);
    // A draft without questions yet may set the count.
    expect(assessmentInputSchema.safeParse(quiz(0, { drawCount: 20 })).success).toBe(true);
    const long = { ...q(1), topic: 'x'.repeat(61) };
    expect(assessmentInputSchema.safeParse({ ...quiz(0), questions: [long] }).success).toBe(false);
  });

  it('defaults: no draw (every question), no balancing; a missing topic stays absent (kept on save)', () => {
    const r = assessmentInputSchema.parse({ type: 'QUIZ', titleEn: 'Plain', questions: [{ kind: 'SINGLE', promptEn: 'P', weight: 1, options: [{ labelEn: 'a', correct: true }, { labelEn: 'b', correct: false }] }] });
    expect(r).toMatchObject({ drawCount: null, balanceByTopic: false });
    expect(r.questions[0]!.topic).toBeUndefined();
    expect(assessmentInputSchema.parse({ ...r, questions: [{ ...r.questions[0]!, topic: '  ' }] }).questions[0]!.topic).toBeNull();
  });

  it('labels practice exams: a quiz that draws and does not count toward the certificate', () => {
    expect(isPracticeExam({ type: 'QUIZ', drawCount: 20, countsForCertificate: false })).toBe(true);
    expect(isPracticeExam({ type: 'QUIZ', drawCount: 20, countsForCertificate: true })).toBe(false);
    expect(isPracticeExam({ type: 'QUIZ', drawCount: null, countsForCertificate: false })).toBe(false);
  });
});
