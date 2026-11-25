import type { NestExpressApplication } from '@nestjs/platform-express';
import { PRACTICE_EXAM_PRESET } from '@academy/shared';
import request from 'supertest';
import { AssessmentsService } from '../src/assessments/assessments.service';
import { CertificatesService } from '../src/certificates/certificates.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Question i: "Pods" for 0–5, "Networking" for 6–9, no topic for 10–11; weight 1, 2 or 3 (unless flat). */
const bankQuestion = (i: number, flat: boolean) => ({
  kind: 'SINGLE',
  promptEn: `Bank question ${i + 1}`,
  weight: flat ? 1 : (i % 3) + 1,
  topic: i < 6 ? 'Pods' : i < 10 ? 'Networking' : null,
  options: [
    { labelEn: 'Right', correct: true },
    { labelEn: 'Wrong', correct: false },
  ],
});
const bank = (extra: Record<string, unknown> = {}, opts: { n?: number; flat?: boolean } = {}) => ({
  type: 'QUIZ',
  status: 'PUBLISHED',
  titleEn: 'CKA practice exam',
  maxPoints: 100,
  passPercent: 70,
  ...PRACTICE_EXAM_PRESET,
  drawCount: 5,
  timeLimitMin: null,
  questions: Array.from({ length: opts.n ?? 12 }, (_, i) => bankQuestion(i, opts.flat ?? false)),
  ...extra,
});

type Created = { id: string; questions: { id: string; weight: number; topic: string | null; options: { id: string; correct: boolean }[] }[] };
type Attempt = { submissionId: string; attempt: number; questions: { id: string; topic: string | null; options: { id: string }[] }[] };

describe('practice exams from a question bank (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  async function setup(course?: { id: string; slug: string }) {
    const c = course ?? (await createCourse(prisma));
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma, { prefix: 'student' });
    await prisma.enrollment.create({ data: { userId: student.id, courseId: c.id } });
    return { course: c, admin, student };
  }
  async function create(courseId: string, cookie: string, body: Record<string, unknown>): Promise<Created> {
    const res = await http().post(`/api/admin/courses/${courseId}/assessments`).set('Cookie', cookie).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }
  const base = (slug: string, id: string) => `/api/learn/${slug}/assessments/${id}`;
  const start = async (slug: string, id: string, cookie: string): Promise<Attempt> => (await http().post(`${base(slug, id)}/start`).set('Cookie', cookie).expect(200)).body;
  const detail = async (slug: string, id: string, cookie: string) => (await http().get(base(slug, id)).set('Cookie', cookie).expect(200)).body;
  const submit = async (slug: string, id: string, cookie: string, answers: Record<string, string[]>) =>
    (await http().post(`${base(slug, id)}/submit`).set('Cookie', cookie).send({ answers }).expect(200)).body;
  const right = (a: Created, qid: string) => [a.questions.find((q) => q.id === qid)!.options.find((o) => o.correct)!.id];
  const wrong = (a: Created, qid: string) => [a.questions.find((q) => q.id === qid)!.options.find((o) => !o.correct)!.id];

  it('serves exactly the drawn questions, the same ones after a reload, and draws again for a new attempt', async () => {
    const { course, admin, student } = await setup();
    const quiz = await create(course.id, admin.cookie, bank());
    expect(quiz).toMatchObject({ drawCount: 5, balanceByTopic: true, attemptsAllowed: 0, countsForCertificate: false });
    expect(quiz.questions.map((q) => q.topic)).toEqual([...Array(6).fill('Pods'), ...Array(4).fill('Networking'), null, null]);

    const before = await detail(course.slug, quiz.id, student.cookie);
    expect(before).toMatchObject({ questionCount: 5, drawCount: 5, practice: true });
    const list = (await http().get(`/api/learn/${course.slug}/assessments`).set('Cookie', student.cookie).expect(200)).body;
    expect(list[0]).toMatchObject({ questionCount: 5, practice: true });

    const first = await start(course.slug, quiz.id, student.cookie);
    expect(first.questions).toHaveLength(5);
    const ids = first.questions.map((q) => q.id);
    // Balanced in proportion (5 of 6 + 4 + 2): Pods 2, Networking 2, General 1.
    const count = (t: string | null) => first.questions.filter((q) => q.topic === t).length;
    expect([count('Pods'), count('Networking'), count(null)]).toEqual([2, 2, 1]);
    // A reload (detail or start again) serves the same five.
    expect((await detail(course.slug, quiz.id, student.cookie)).inProgress.questions.map((q: { id: string }) => q.id)).toEqual(ids);
    expect((await start(course.slug, quiz.id, student.cookie)).questions.map((q) => q.id)).toEqual(ids);
    const row = await prisma.submission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect([...row.drawnQuestionIds].sort()).toEqual([...ids].sort());
    expect(row.maxScore).toBe(100);

    // Answers to every question of the bank: only the drawn ones are stored and graded.
    const all = Object.fromEntries(quiz.questions.map((q) => [q.id, right(quiz, q.id)]));
    const result = await submit(course.slug, quiz.id, student.cookie, all);
    expect(result).toMatchObject({ score: 100, maxScore: 100, percent: 100, passed: true, attemptsLeft: null });
    const stored = await prisma.submission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(Object.keys(stored.answers as object).sort()).toEqual([...ids].sort());
    // The review covers the drawn questions only, with the score per topic.
    expect(result.review.questions.map((q: { id: string }) => q.id).sort()).toEqual([...ids].sort());
    const drawnWeight = quiz.questions.filter((q) => ids.includes(q.id)).reduce((n, q) => n + q.weight, 0);
    expect(result.review.topics.map((t: { topic: string | null }) => t.topic)).toEqual(['Pods', 'Networking', null]);
    expect(result.review.topics.reduce((n: number, t: { possible: number }) => n + t.possible, 0)).toBe(drawnWeight);
    expect(result.review.topics.every((t: { earned: number; possible: number; percent: number }) => t.earned === t.possible && t.percent === 100)).toBe(true);

    // New attempts draw again (at random): over several attempts, not always the same five.
    const draws = new Set([ids.slice().sort().join()]);
    for (let i = 0; i < 6; i++) {
      const next = await start(course.slug, quiz.id, student.cookie);
      expect(next.questions).toHaveLength(5);
      draws.add(next.questions.map((q) => q.id).sort().join());
      await submit(course.slug, quiz.id, student.cookie, {});
    }
    expect(draws.size).toBeGreaterThan(1);
    // Past attempts list their own scores; the latest review is shown (answers after each attempt).
    const after = await detail(course.slug, quiz.id, student.cookie);
    expect(after.submissions).toHaveLength(7);
    expect(after.review.questions).toHaveLength(5);
    expect(after.review.topics).toHaveLength(3);
  });

  it('scores only the drawn questions: percent = earned weight ÷ the drawn questions’ weight', async () => {
    const { course, admin, student } = await setup();
    const quiz = await create(course.id, admin.cookie, bank({ balanceByTopic: false, passPercent: 50 }));
    const attempt = await start(course.slug, quiz.id, student.cookie);
    const drawn = attempt.questions.map((q) => quiz.questions.find((x) => x.id === q.id)!);
    const [hit, ...rest] = drawn;
    const answers = { [hit!.id]: right(quiz, hit!.id), ...Object.fromEntries(rest.map((q) => [q.id, wrong(quiz, q.id)])) };
    // An answer to a question this attempt didn't draw is ignored, even when right.
    const other = quiz.questions.find((q) => !drawn.includes(q))!;
    const result = await submit(course.slug, quiz.id, student.cookie, { ...answers, [other.id]: right(quiz, other.id) });
    const total = drawn.reduce((n, q) => n + q.weight, 0);
    const expected = Math.round((hit!.weight / total) * 100 * 100) / 100;
    expect(result.score).toBe(expected);
    expect(result.maxScore).toBe(100);
    expect(result.percent).toBe(Math.round((expected / 100) * 1000) / 10);
    expect(result.passed).toBe(expected >= 50);
    const earned = result.review.topics.reduce((n: number, t: { earned: number }) => n + t.earned, 0);
    expect(earned).toBe(hit!.weight);

    // The gradebook and the admin's view of the attempt agree, with the drawn questions only.
    const book = (await http().get(`/api/admin/assessments/${quiz.id}/submissions`).set('Cookie', admin.cookie).expect(200)).body;
    expect(book.rows.find((r: { userId: string }) => r.userId === student.id)).toMatchObject({ score: expected, maxScore: 100 });
    const view = (await http().get(`/api/admin/submissions/${attempt.submissionId}`).set('Cookie', admin.cookie).expect(200)).body;
    expect(view.review.questions).toHaveLength(5);
    expect(view.review.topics.reduce((n: number, t: { possible: number }) => n + t.possible, 0)).toBe(total);
    // Course results (certificates, points, CSV) use the same score out of max points.
    const results = await app.get(AssessmentsService).courseResults(student.id, course.id);
    expect(results.assessments[0]).toMatchObject({ score: expected, maxPoints: 100, percent: Math.round((expected / 100) * 1000) / 10 });
  });

  it('refuses a draw count above the number of questions (400), on create and on edit', async () => {
    const { course, admin } = await setup();
    const bad = await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send(bank({ drawCount: 13 })).expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toContain('drawCount');
    await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send(bank({ drawCount: 0 })).expect(400);
    const quiz = await create(course.id, admin.cookie, bank({ drawCount: 12 }));
    const full = (await http().get(`/api/admin/assessments/${quiz.id}`).set('Cookie', admin.cookie).expect(200)).body;
    const edit = await http().put(`/api/admin/assessments/${quiz.id}`).set('Cookie', admin.cookie).send({ ...full, questions: full.questions.slice(0, 4) }).expect(400);
    expect(edit.body.errors.map((e: { path: string }) => e.path)).toContain('drawCount');
    // Topics are kept when a client doesn't send them, and cleared when sent empty.
    const kept = (await http().put(`/api/admin/assessments/${quiz.id}`).set('Cookie', admin.cookie).send({ ...full, questions: full.questions.map(({ topic: _t, ...q }: { topic: string | null }) => q) }).expect(200)).body;
    expect(kept.questions[0].topic).toBe('Pods');
    const cleared = (await http().put(`/api/admin/assessments/${quiz.id}`).set('Cookie', admin.cookie).send({ ...full, questions: full.questions.map((q: object) => ({ ...q, topic: '' })) }).expect(200)).body;
    expect(cleared.questions.every((q: { topic: string | null }) => q.topic === null)).toBe(true);
    // A count of at least the bank serves every question (nothing drawn).
    const student = await createUser(app, prisma, { prefix: 'student' });
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    const attempt = await start(course.slug, quiz.id, student.cookie);
    expect(attempt.questions).toHaveLength(12);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: attempt.submissionId } })).drawnQuestionIds).toEqual([]);
  });

  it('the certificate rule compares the attempt’s own percent when a drawn quiz counts toward it', async () => {
    const course = await createCourse(prisma, { requiresApproval: false });
    await prisma.course.update({ where: { id: course.id }, data: { selfPaced: true, certRequireAssessments: true } });
    const { admin, student } = await setup(course);
    const weak = await createUser(app, prisma, { prefix: 'weak' });
    await prisma.enrollment.create({ data: { userId: weak.id, courseId: course.id } });
    // Mandatory, so limited attempts; the self-paced 80% rule raises the pass mark to 80.
    const quiz = await create(
      course.id,
      admin.cookie,
      bank({ countsForCertificate: true, attemptsAllowed: 2, passPercent: 60, scoring: 'BEST' }, { flat: true }),
    );
    expect((await http().get(`/api/admin/assessments/${quiz.id}`).set('Cookie', admin.cookie).expect(200)).body.passPercent).toBe(80);
    const take = async (cookie: string, correct: number) => {
      const a = await start(course.slug, quiz.id, cookie);
      const answers = Object.fromEntries(a.questions.map((q, i) => [q.id, i < correct ? right(quiz, q.id) : wrong(quiz, q.id)]));
      return submit(course.slug, quiz.id, cookie, answers);
    };
    // 4 of the 5 drawn questions: 80% (of the whole 12-question bank it would be 33%).
    expect(await take(student.cookie, 4)).toMatchObject({ score: 80, percent: 80, passed: true });
    expect(await take(weak.cookie, 3)).toMatchObject({ score: 60, percent: 60, passed: false });
    const c = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    const elig = await app.get(CertificatesService).eligibilityFor(c, [student.id, weak.id]);
    expect(elig.get(student.id)).toMatchObject({ assessments: { required: 1, passed: 1, ok: true }, total: { percent: 80 } });
    expect(elig.get(weak.id)).toMatchObject({ assessments: { required: 1, passed: 0, ok: false }, total: { percent: 60 } });

    // A live course with a minimum total of 80%: the total is the attempt's score out of max points too.
    const live = await createCourse(prisma);
    await prisma.course.update({ where: { id: live.id }, data: { certRequireAssessments: true, certMinTotalPercent: 80 } });
    const l = await setup(live);
    const liveQuiz = await create(live.id, l.admin.cookie, bank({ countsForCertificate: true, attemptsAllowed: 1, passPercent: 80 }, { flat: true }));
    const a = await start(live.slug, liveQuiz.id, l.student.cookie);
    await submit(live.slug, liveQuiz.id, l.student.cookie, Object.fromEntries(a.questions.map((q, i) => [q.id, i < 4 ? right(liveQuiz, q.id) : wrong(liveQuiz, q.id)])));
    const lc = await prisma.course.findUniqueOrThrow({ where: { id: live.id } });
    expect((await app.get(CertificatesService).eligibilityFor(lc, [l.student.id])).get(l.student.id)).toMatchObject({
      assessments: { required: 1, passed: 1, ok: true },
      total: { percent: 80, required: 80, ok: true },
    });
  });

  it('a quiz without a draw count serves every question, as before', async () => {
    const { course, admin, student } = await setup();
    const quiz = await create(course.id, admin.cookie, bank({ drawCount: null, balanceByTopic: false, attemptsAllowed: 1, revealAnswers: 'NEVER' }));
    expect(quiz).toMatchObject({ drawCount: null, balanceByTopic: false });
    expect(await detail(course.slug, quiz.id, student.cookie)).toMatchObject({ questionCount: 12, drawCount: null, practice: false });
    const attempt = await start(course.slug, quiz.id, student.cookie);
    expect(attempt.questions.map((q) => q.id)).toEqual(quiz.questions.map((q) => q.id));
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: attempt.submissionId } })).drawnQuestionIds).toEqual([]);
    const result = await submit(course.slug, quiz.id, student.cookie, Object.fromEntries(quiz.questions.map((q) => [q.id, right(quiz, q.id)])));
    // Answers never shown: no review, so no per-topic scores either.
    expect(result).toMatchObject({ score: 100, percent: 100, review: null });
  });
});
