import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AssessmentReminderJobs } from '../src/assessments/assessment-reminders.jobs';
import { AssessmentsService } from '../src/assessments/assessments.service';
import { GITHUB_FETCH, type FetchLike } from '../src/assessments/github-repo-check';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';
import { createCourse, createUser } from './helpers';

const HOUR = 3_600_000;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** GitHub as seen without a token: owner/repo → HTTP status, or 'down' for a network failure. */
const github = new Map<string, number | 'down'>();
const fakeFetch: FetchLike = async (url) => {
  const m = /repos\/([^/]+)\/([^/?]+)/.exec(url);
  const v = github.get(`${m?.[1]}/${m?.[2]}`) ?? 404;
  if (v === 'down') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  return { status: v, headers: new Headers() };
};

/** Two single-choice questions (weights 1 and 2) and one multiple-choice (weight 3). */
const quizInput = (extra: Record<string, unknown> = {}) => ({
  type: 'QUIZ',
  status: 'PUBLISHED',
  titleEn: 'Midpoint quiz',
  titleAr: 'اختبار منتصف الدورة',
  instructionsEn: 'Answer everything.',
  maxPoints: 60,
  passPercent: 50,
  countsForCertificate: true,
  attemptsAllowed: 2,
  revealAnswers: 'AFTER_SUBMIT',
  questions: [
    {
      kind: 'SINGLE',
      promptEn: 'Which tool tracks experiments?',
      promptAr: 'أي أداة تتبع التجارب؟',
      weight: 1,
      explanationEn: 'SECRET-EXPLANATION MLflow tracks runs.',
      options: [
        { labelEn: 'MLflow', labelAr: 'MLflow', correct: true },
        { labelEn: 'Nginx', labelAr: 'Nginx', correct: false },
      ],
    },
    {
      kind: 'TRUE_FALSE',
      promptEn: 'Kubernetes schedules pods.',
      promptAr: 'كوبرنيتس يجدول الحاويات.',
      weight: 2,
      options: [
        { labelEn: 'True', labelAr: 'صحيح', correct: true },
        { labelEn: 'False', labelAr: 'خطأ', correct: false },
      ],
    },
    {
      kind: 'MULTIPLE',
      promptEn: 'Which are feature stores?',
      promptAr: 'أي منها مخازن ميزات؟',
      weight: 3,
      options: [
        { labelEn: 'Feast', labelAr: 'Feast', correct: true },
        { labelEn: 'Tecton', labelAr: 'Tecton', correct: true },
        { labelEn: 'Grafana', labelAr: 'Grafana', correct: false },
      ],
    },
  ],
  ...extra,
});

describe('assessments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = 'log';
    process.env.JOBS_ENABLED = 'false';
    process.env.PUBLIC_CACHE_TTL_S ??= '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GITHUB_FETCH).useValue(fakeFetch).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const course = await createCourse(prisma);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma, { prefix: 'student' });
    const other = await createUser(app, prisma, { prefix: 'other' });
    await prisma.enrollment.createMany({ data: [{ userId: student.id, courseId: course.id }, { userId: other.id, courseId: course.id }] });
    return { course, admin, student, other };
  }

  async function createAssessment(courseId: string, cookie: string, body: Record<string, unknown>): Promise<{ id: string; questions: { id: string; options: { id: string; correct: boolean }[] }[] }> {
    const res = await http().post(`/api/admin/courses/${courseId}/assessments`).set('Cookie', cookie).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  it('lets admins create, read, update and delete assessments (and nobody else)', async () => {
    const { course, admin, student } = await setup();
    await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', student.cookie).send(quizInput()).expect(403);
    const bad = await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send({ ...quizInput(), questions: [] }).expect(400);
    expect(bad.body.errors[0].path).toBe('questions');

    const created = await createAssessment(course.id, admin.cookie, quizInput({ status: 'DRAFT' }));
    expect(created.questions).toHaveLength(3);
    expect(created.questions[0]!.options[0]!.correct).toBe(true);

    // Editing keeps question and option ids (earlier answers still line up).
    const full = (await http().get(`/api/admin/assessments/${created.id}`).set('Cookie', admin.cookie).expect(200)).body;
    full.questions[0].promptEn = 'Which tool tracks ML experiments?';
    full.questions.pop();
    const updated = (await http().put(`/api/admin/assessments/${created.id}`).set('Cookie', admin.cookie).send({ ...full, status: 'PUBLISHED' }).expect(200)).body;
    expect(updated.questions.map((q: { id: string }) => q.id)).toEqual(created.questions.slice(0, 2).map((q) => q.id));
    expect(updated.questions[0].options.map((o: { id: string }) => o.id)).toEqual(created.questions[0]!.options.map((o) => o.id));
    expect(updated.status).toBe('PUBLISHED');

    const rows = (await http().get(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).expect(200)).body;
    expect(rows).toEqual([expect.objectContaining({ id: created.id, questionCount: 2, submitted: 0, toGrade: 0 })]);

    // A session from another course is refused.
    const otherCourse = await createCourse(prisma);
    const foreign = await prisma.courseSession.create({ data: { courseId: otherCourse.id, order: 1, titleEn: 'x', titleAr: 'x', startsAt: new Date() } });
    await http().put(`/api/admin/assessments/${created.id}`).set('Cookie', admin.cookie).send({ ...full, sessionId: foreign.id }).expect(400);

    await http().delete(`/api/admin/assessments/${created.id}`).set('Cookie', admin.cookie).expect(204);
    const audit = await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['assessment.created', 'assessment.updated', 'assessment.deleted']);
  });

  it('keeps drafts hidden and other courses closed', async () => {
    const { course, admin, student } = await setup();
    const draft = await createAssessment(course.id, admin.cookie, quizInput({ status: 'DRAFT' }));
    const outsider = await createUser(app, prisma);
    await http().get(`/api/learn/${course.slug}/assessments`).expect(401);
    expect((await http().get(`/api/learn/${course.slug}/assessments`).set('Cookie', outsider.cookie).expect(403)).body.code).toBe('NOT_ENROLLED');
    expect((await http().get(`/api/learn/${course.slug}/assessments`).set('Cookie', student.cookie).expect(200)).body).toEqual([]);
    await http().get(`/api/learn/${course.slug}/assessments/${draft.id}`).set('Cookie', student.cookie).expect(404);
    await http().post(`/api/learn/${course.slug}/assessments/${draft.id}/start`).set('Cookie', student.cookie).expect(404);

    // A published assessment is only reachable through its own course.
    const pub = await createAssessment(course.id, admin.cookie, quizInput());
    const elsewhere = await createCourse(prisma);
    await prisma.enrollment.create({ data: { userId: outsider.id, courseId: elsewhere.id } });
    await http().get(`/api/learn/${elsewhere.slug}/assessments/${pub.id}`).set('Cookie', outsider.cookie).expect(404);
    // Admins can preview but not take it.
    await http().get(`/api/learn/${course.slug}/assessments/${pub.id}`).set('Cookie', admin.cookie).expect(200);
    await http().post(`/api/learn/${course.slug}/assessments/${pub.id}/start`).set('Cookie', admin.cookie).expect(403);
  });

  it('grades a quiz on the server, by weight, and never leaks the key before the reveal', async () => {
    const { course, admin, student } = await setup();
    const quiz = await createAssessment(course.id, admin.cookie, quizInput());
    const [q1, q2, q3] = quiz.questions as { id: string; options: { id: string; correct: boolean }[] }[];
    const base = `/api/learn/${course.slug}/assessments/${quiz.id}`;

    const list = (await http().get(`/api/learn/${course.slug}/assessments`).set('Cookie', student.cookie).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id: quiz.id, state: 'NOT_STARTED', due: true, questionCount: 3 })]);
    const detail = await http().get(base).set('Cookie', student.cookie).expect(200);
    expect(detail.body.review).toBeNull();
    expect(JSON.stringify(detail.body)).not.toMatch(/"correct"|SECRET-EXPLANATION|explanation/);

    const start = await http().post(`${base}/start`).set('Cookie', student.cookie).expect(200);
    expect(start.body.questions).toHaveLength(3);
    expect(JSON.stringify(start.body)).not.toMatch(/"correct"|SECRET-EXPLANATION|explanation/);
    // Starting again returns the same open attempt.
    expect((await http().post(`${base}/start`).set('Cookie', student.cookie).expect(200)).body.submissionId).toBe(start.body.submissionId);

    // q1 right (1), q2 wrong, q3 half right = wrong (all-or-nothing) → 1/6 of 60 = 10.
    const pick = (q: typeof q1, correct: boolean) => q!.options.filter((o) => o.correct === correct).map((o) => o.id);
    const first = await http()
      .post(`${base}/submit`)
      .set('Cookie', student.cookie)
      .send({ answers: { [q1!.id]: pick(q1, true), [q2!.id]: pick(q2, false), [q3!.id]: [pick(q3, true)[0]!], bogus: ['x'] } })
      .expect(200);
    expect(first.body).toMatchObject({ score: 10, maxScore: 60, percent: 16.7, passed: false, attemptsLeft: 1, review: null });
    expect(JSON.stringify(first.body)).not.toMatch(/"correct"|SECRET-EXPLANATION/);
    await http().post(`${base}/submit`).set('Cookie', student.cookie).send({ answers: {} }).expect(409);
    const stored = await prisma.submission.findUniqueOrThrow({ where: { id: start.body.submissionId } });
    expect(Object.keys(stored.answers as object)).not.toContain('bogus');

    // Last attempt: everything right → 60, and now the key with explanations is revealed.
    await http().post(`${base}/start`).set('Cookie', student.cookie).expect(200);
    const second = await http()
      .post(`${base}/submit`)
      .set('Cookie', student.cookie)
      .send({ answers: { [q1!.id]: pick(q1, true), [q2!.id]: pick(q2, true), [q3!.id]: pick(q3, true) } })
      .expect(200);
    expect(second.body).toMatchObject({ score: 60, percent: 100, passed: true, attemptsLeft: 0 });
    expect(second.body.review.questions[0]).toMatchObject({ correct: true, explanationEn: 'SECRET-EXPLANATION MLflow tracks runs.' });
    expect((await http().post(`${base}/start`).set('Cookie', student.cookie).expect(409)).body).toMatchObject({ code: 'ASSESSMENT_CLOSED', reason: 'NO_ATTEMPTS' });

    const after = (await http().get(base).set('Cookie', student.cookie).expect(200)).body;
    expect(after).toMatchObject({ state: 'GRADED', score: 60, passed: true, attemptsUsed: 2, attemptsLeft: 0, due: false });
    expect(after.submissions).toHaveLength(2);

    // The shared score rule for certificates and points.
    const results = await app.get(AssessmentsService).courseResults(student.id, course.id);
    expect(results.assessments[0]).toMatchObject({ attempts: 2, best: 60, last: 60, score: 60, passed: true });
    expect(results.total).toEqual({ earned: 60, possible: 60, percent: 100 });
    expect(results.certificate).toEqual({ required: 1, passed: 1, allPassed: true });
  });

  it('keeps answers hidden until the due date with AFTER_DUE, and applies NEVER', async () => {
    const { course, admin, student } = await setup();
    const quiz = await createAssessment(course.id, admin.cookie, quizInput({ revealAnswers: 'AFTER_DUE', dueAt: new Date(Date.now() + HOUR).toISOString(), attemptsAllowed: 0 }));
    const base = `/api/learn/${course.slug}/assessments/${quiz.id}`;
    await http().post(`${base}/start`).set('Cookie', student.cookie).expect(200);
    const r = await http().post(`${base}/submit`).set('Cookie', student.cookie).send({ answers: {} }).expect(200);
    expect(r.body).toMatchObject({ score: 0, review: null, attemptsLeft: null });
    await prisma.assessment.update({ where: { id: quiz.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
    const detail = (await http().get(base).set('Cookie', student.cookie).expect(200)).body;
    expect(detail.review.questions).toHaveLength(3);
    expect(detail.closed).toBe('ANSWERS_REVEALED');

    await prisma.assessment.update({ where: { id: quiz.id }, data: { revealAnswers: 'NEVER' } });
    expect((await http().get(base).set('Cookie', student.cookie).expect(200)).body.review).toBeNull();
  });

  it('enforces time limits and due dates on the server', async () => {
    const { course, admin, student, other } = await setup();
    const timed = await createAssessment(course.id, admin.cookie, quizInput({ timeLimitMin: 5, attemptsAllowed: 1 }));
    const base = `/api/learn/${course.slug}/assessments/${timed.id}`;
    const start = await http().post(`${base}/start`).set('Cookie', student.cookie).expect(200);
    expect(new Date(start.body.deadline).getTime() - new Date(start.body.startedAt).getTime()).toBe(5 * 60_000);
    await prisma.submission.update({ where: { id: start.body.submissionId }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await http().post(`${base}/submit`).set('Cookie', student.cookie).send({ answers: {} }).expect(409)).body.code).toBe('TIME_UP');
    expect(await prisma.submission.findUniqueOrThrow({ where: { id: start.body.submissionId } })).toMatchObject({ score: 0 });

    // An abandoned timed attempt is closed when the student comes back.
    const s2 = await http().post(`${base}/start`).set('Cookie', other.cookie).expect(200);
    await prisma.submission.update({ where: { id: s2.body.submissionId }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await http().get(base).set('Cookie', other.cookie).expect(200)).body).toMatchObject({ state: 'GRADED', score: 0, inProgress: null });

    const hard = await createAssessment(course.id, admin.cookie, quizInput({ dueAt: new Date(Date.now() - HOUR).toISOString(), allowLate: false }));
    const closed = await http().post(`/api/learn/${course.slug}/assessments/${hard.id}/start`).set('Cookie', student.cookie).expect(409);
    expect(closed.body.reason).toBe('PAST_DUE');
    expect((await http().get(`/api/learn/${course.slug}/assessments/${hard.id}`).set('Cookie', student.cookie).expect(200)).body.state).toBe('MISSED');

    const soft = await createAssessment(course.id, admin.cookie, quizInput({ dueAt: new Date(Date.now() - HOUR).toISOString() }));
    await http().post(`/api/learn/${course.slug}/assessments/${soft.id}/start`).set('Cookie', student.cookie).expect(200);
    const late = await http().post(`/api/learn/${course.slug}/assessments/${soft.id}/submit`).set('Cookie', student.cookie).send({ answers: {} }).expect(200);
    expect(late.body.late).toBe(true);
  });

  it('takes GitHub labs only from public repositories, and flags ones it could not check', async () => {
    const { course, admin, student, other } = await setup();
    const lab = await createAssessment(course.id, admin.cookie, { type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab 1', titleAr: 'المختبر ١', submissionKind: 'GITHUB_REPO', maxPoints: 10 });
    const url = `/api/learn/${course.slug}/assessments/${lab.id}/submission`;
    github.set('student/public-lab', 200);
    github.set('student/private-lab', 404);
    github.set('student/flaky', 'down');

    expect((await http().post(url).set('Cookie', student.cookie).send({ url: 'https://gitlab.com/a/b', attested: true }).expect(400)).body.code).toBe('INVALID_GITHUB_URL');
    expect((await http().post(url).set('Cookie', student.cookie).send({ url: 'https://github.com/student/public-lab' }).expect(400)).body.code).toBe('ATTESTATION_REQUIRED');
    const priv = await http().post(url).set('Cookie', student.cookie).send({ url: 'https://github.com/student/private-lab', attested: true }).expect(422);
    expect(priv.body).toMatchObject({ code: 'REPO_NOT_PUBLIC', message: "This repository isn't public (or doesn't exist)" });
    expect(await prisma.submission.count({ where: { assessmentId: lab.id } })).toBe(0);

    const ok = await http().post(url).set('Cookie', student.cookie).send({ url: 'https://github.com/student/public-lab.git', attested: true, note: 'See README' }).expect(200);
    expect(ok.body).toMatchObject({ url: 'https://github.com/student/public-lab', repoCheck: 'PUBLIC', late: false, score: null });
    // Resubmitting replaces the same row.
    const again = await http().post(url).set('Cookie', student.cookie).send({ url: 'https://github.com/student/flaky', attested: true }).expect(200);
    expect(again.body).toMatchObject({ id: ok.body.id, repoCheck: 'UNVERIFIED' });

    // The grader sees the flag; grading is audited and the student is told.
    const book = (await http().get(`/api/admin/assessments/${lab.id}/submissions`).set('Cookie', admin.cookie).expect(200)).body;
    expect(book.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: student.id, state: 'SUBMITTED', repoCheck: 'UNVERIFIED' }),
        expect.objectContaining({ userId: other.id, state: 'MISSING' }),
      ]),
    );
    expect((await http().get(`/api/admin/assessments/${lab.id}/submissions?filter=missing`).set('Cookie', admin.cookie).expect(200)).body.rows.map((r: { userId: string }) => r.userId)).toEqual([other.id]);
    await http().put(`/api/admin/submissions/${ok.body.id}/grade`).set('Cookie', admin.cookie).send({ score: 11 }).expect(400);
    await http().put(`/api/admin/submissions/${ok.body.id}/grade`).set('Cookie', student.cookie).send({ score: 5 }).expect(403);
    const graded = await http().put(`/api/admin/submissions/${ok.body.id}/grade`).set('Cookie', admin.cookie).send({ score: 8, feedback: 'Good tests.', rubricNotes: 'Code 4/5, docs 4/5' }).expect(200);
    expect(graded.body).toMatchObject({ score: 8, feedback: 'Good tests.', gradedAt: expect.any(String) });
    await http().put(`/api/admin/submissions/${ok.body.id}/grade`).set('Cookie', admin.cookie).send({ score: 9, feedback: 'Better.' }).expect(200);
    const audit = await prisma.auditLog.findMany({ where: { entityId: ok.body.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => [a.action, (a.metadata as { score: number }).score])).toEqual([
      ['submission.graded', 8],
      ['submission.regraded', 9],
    ]);
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'assessment.graded' } })).toBe(2);

    const mine = (await http().get(`/api/learn/${course.slug}/assessments/${lab.id}`).set('Cookie', student.cookie).expect(200)).body;
    expect(mine).toMatchObject({ state: 'GRADED', score: 9, closed: 'GRADED' });
    expect(mine.submissions[0]).toMatchObject({ feedback: 'Better.', rubricNotes: null });
    // Graded work can't be replaced.
    expect((await http().post(url).set('Cookie', student.cookie).send({ url: 'https://github.com/student/public-lab', attested: true }).expect(409)).body.reason).toBe('GRADED');
    // Students never reach the gradebook or another student's work.
    await http().get(`/api/admin/submissions/${ok.body.id}`).set('Cookie', other.cookie).expect(403);
    const theirs = (await http().get(`/api/learn/${course.slug}/assessments/${lab.id}`).set('Cookie', other.cookie).expect(200)).body;
    expect(theirs.submissions).toEqual([]);
  });

  it('checks Drive links and the sharing box, and takes PDFs', async () => {
    const { course, admin, student } = await setup();
    const doc = await createAssessment(course.id, admin.cookie, { type: 'ASSIGNMENT', status: 'PUBLISHED', titleEn: 'Design doc', titleAr: 'وثيقة التصميم', submissionKind: 'DRIVE_LINK' });
    const url = `/api/learn/${course.slug}/assessments/${doc.id}/submission`;
    expect((await http().post(url).set('Cookie', student.cookie).send({ url: 'https://evil.example/doc', attested: true }).expect(400)).body.code).toBe('INVALID_DRIVE_URL');
    expect((await http().post(url).set('Cookie', student.cookie).send({ url: 'https://docs.google.com/document/d/abc/edit' }).expect(400)).body.code).toBe('ATTESTATION_REQUIRED');
    await http().post(url).set('Cookie', student.cookie).send({ url: 'http://docs.google.com/document/d/abc/edit', attested: true }).expect(400);
    const ok = await http().post(url).set('Cookie', student.cookie).send({ url: 'https://docs.google.com/document/d/abc/edit', attested: true }).expect(200);
    expect(ok.body).toMatchObject({ url: 'https://docs.google.com/document/d/abc/edit', repoCheck: null });

    const pdf = await createAssessment(course.id, admin.cookie, { type: 'ASSIGNMENT', status: 'PUBLISHED', titleEn: 'Report', titleAr: 'تقرير', submissionKind: 'PDF', dueAt: new Date(Date.now() - HOUR).toISOString() });
    const fileUrl = `/api/learn/${course.slug}/assessments/${pdf.id}/submission/file`;
    expect((await http().post(fileUrl).set('Cookie', student.cookie).attach('file', Buffer.from('not a pdf'), 'x.pdf').expect(400)).body.code).toBe('FILE_TYPE');
    const up = await http().post(fileUrl).set('Cookie', student.cookie).field('note', 'Final version').attach('file', PDF, 'report.pdf').expect(200);
    expect(up.body).toMatchObject({ hasFile: true, fileName: 'report.pdf', note: 'Final version', late: true });
    expect((await http().get(`/api/learn/${course.slug}/assessments/${pdf.id}/file`).set('Cookie', student.cookie).expect(200)).body.url).toContain('submissions/');
    // Past the due date: the one late submission is in, no resubmission.
    expect((await http().post(fileUrl).set('Cookie', student.cookie).attach('file', PDF, 'v2.pdf').expect(409)).body.reason).toBe('PAST_DUE');
    expect((await http().get(`/api/admin/assessments/${pdf.id}/submissions?filter=late`).set('Cookie', admin.cookie).expect(200)).body.rows).toHaveLength(1);
    expect((await http().get(`/api/admin/submissions/${up.body.id}/file`).set('Cookie', admin.cookie).expect(200)).body.url).toContain('X-Amz-Signature');
  });

  it('exports a per-course gradebook CSV', async () => {
    const { course, admin, student } = await setup();
    const quiz = await createAssessment(course.id, admin.cookie, quizInput({ titleEn: 'Quiz =1+1' }));
    await createAssessment(course.id, admin.cookie, { type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab', titleAr: 'مختبر', submissionKind: 'LINK', maxPoints: 40 });
    await http().post(`/api/learn/${course.slug}/assessments/${quiz.id}/start`).set('Cookie', student.cookie).expect(200);
    await http().post(`/api/learn/${course.slug}/assessments/${quiz.id}/submit`).set('Cookie', student.cookie).send({ answers: {} }).expect(200);
    await http().get(`/api/admin/courses/${course.id}/gradebook.csv`).set('Cookie', student.cookie).expect(403);
    const res = await http().get(`/api/admin/courses/${course.id}/gradebook.csv`).set('Cookie', admin.cookie).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('"Name","Email","Quiz =1+1 (/60)","Lab (/40)","Total","Possible","Percent","Certificate assessments passed"');
    expect(lines.find((l) => l.includes(student.email))).toContain('"0","missing","0","100","0","0/1"');
    expect(lines).toHaveLength(3);
  });

  it('emails a 24-hour reminder once to students who have not submitted', async () => {
    const { course, admin, student, other } = await setup();
    const lab = await createAssessment(course.id, admin.cookie, { type: 'LAB', status: 'PUBLISHED', titleEn: 'Due lab', titleAr: 'مختبر', submissionKind: 'LINK', dueAt: new Date(Date.now() + 23 * HOUR).toISOString() });
    await http().post(`/api/learn/${course.slug}/assessments/${lab.id}/submission`).set('Cookie', other.cookie).send({ url: 'https://example.com/work' }).expect(200);
    const jobs = app.get(AssessmentReminderJobs);
    await jobs.run();
    const logs = await prisma.assessmentReminderLog.findMany({ where: { assessmentId: lab.id } });
    expect(logs.map((l) => l.userId)).toEqual([student.id]);
    await jobs.run();
    expect(await prisma.assessmentReminderLog.count({ where: { assessmentId: lab.id } })).toBe(1);
  });
});
