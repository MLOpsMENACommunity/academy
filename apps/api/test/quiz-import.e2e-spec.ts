import type { NestExpressApplication } from '@nestjs/platform-express';
import { parseQuizBook, QUIZ_BOOK_EXAMPLE, type CoursePermission, type QuizImportInput } from '@academy/shared';
import request from 'supertest';
import { AdminAssessmentsService } from '../src/assessments/admin-assessments.service';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SPEAKER_ASSESSMENTS_PER_DAY } from '../src/teaching/teaching.service';
import { createCourse, createTestApp, createUser } from './helpers';

type Account = { id: string; email: string; cookie: string };
type Result = { created: { id: string; title: string; session: number | null; questions: number }[]; replaced: { id: string }[]; skipped: { id: string; title: string }[]; rows: { id: string; titleEn: string; sessionId: string | null; status: string; questionCount: number }[] };

/** The template, parsed as the browser does: two quizzes on sessions 1 and 2. */
function template(): QuizImportInput['quizzes'] {
  const r = parseQuizBook(QUIZ_BOOK_EXAMPLE);
  expect(r.errors).toEqual([]);
  return r.quizzes.map(({ session, assessment }) => ({ session, assessment }));
}

/** `n` one-question quizzes on session 1 (titles "Bulk 0"…). */
const many = (n: number, extra: (i: number) => object = () => ({})) =>
  Array.from({ length: n }, (_, i) => {
    const [first] = template();
    return { session: 1, assessment: { ...first!.assessment, titleEn: `Bulk ${i}`, questions: first!.assessment.questions.slice(0, 1), ...extra(i) } };
  });

describe('quiz import (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  const http = () => request(app.getHttpServer());

  async function courseWithSessions(n = 2) {
    const c = await createCourse(prisma);
    const sessions = [];
    for (let i = 1; i <= n; i++) {
      sessions.push(
        await prisma.courseSession.create({ data: { courseId: c.id, order: i, titleEn: `Session ${i}`, titleAr: `الجلسة ${i}`, startsAt: new Date(Date.UTC(2030, 0, i, 17)) } }),
      );
    }
    return { ...c, sessions };
  }
  const importAdmin = (courseId: string, body: object, who: Account = admin) => http().post(`/api/admin/courses/${courseId}/assessments/import`).set('Cookie', who.cookie).send(body);

  async function staffWith(courseId: string, permissions: CoursePermission[]): Promise<Account> {
    const who = await createUser(app, prisma, { prefix: 'qim-staff' });
    const roles = (await http().post(`/api/admin/courses/${courseId}/staff/roles`).set('Cookie', admin.cookie).send({ name: `Role ${permissions.join('+')} ${Date.now()}`, permissions, visibility: 'SHOWN' }).expect(201)).body as { roles: { id: string; name: string }[] };
    const role = roles.roles.at(-1)!;
    await http().post(`/api/admin/courses/${courseId}/staff`).set('Cookie', admin.cookie).send({ roleId: role.id, email: who.email }).expect(201);
    return who;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true as never);
    jest.spyOn(app.get(EmailService), 'deliver').mockResolvedValue({ ok: true } as never);
  });
  // A fresh admin per test: imports are rate limited per account.
  beforeEach(async () => {
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'qim-admin' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates every quiz of the file on its session, with weights and settings, as drafts, and audits the import', async () => {
    const c = await courseWithSessions();
    const res = (await importAdmin(c.id, { quizzes: template() }).expect(200)).body as Result;
    expect(res.created.map((x) => [x.title, x.session, x.questions])).toEqual([
      ['Session 1 check-in', 1, 3],
      ['Session 2 review', 2, 3],
    ]);
    expect(res.skipped).toEqual([]);
    expect(res.rows.map((r) => [r.titleEn, r.sessionId, r.status, r.questionCount])).toEqual([
      ['Session 1 check-in', c.sessions[0]!.id, 'DRAFT', 3],
      ['Session 2 review', c.sessions[1]!.id, 'DRAFT', 3],
    ]);
    const one = (await http().get(`/api/admin/assessments/${res.created[0]!.id}`).set('Cookie', admin.cookie).expect(200)).body;
    expect(one).toMatchObject({ passPercent: 70, attemptsAllowed: 2, timeLimitMin: 15, revealAnswers: 'AFTER_SUBMIT', countsForCertificate: true, maxPoints: 10, dueAt: '2027-03-01T18:00:00.000Z' });
    expect(one.questions.map((q: { kind: string; weight: number }) => [q.kind, q.weight])).toEqual([
      ['SINGLE', 1],
      ['MULTIPLE', 2],
      ['TRUE_FALSE', 1],
    ]);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'assessment.imported', entityId: c.id } });
    expect(audit).toMatchObject({ actorId: admin.id, metadata: { created: 2, replaced: 0, skipped: 0, questions: 6, published: 0 } });
    expect(await prisma.auditLog.count({ where: { action: 'assessment.created', entityId: { in: res.created.map((x) => x.id) } } })).toBe(2);
    // Drafts tell nobody.
    expect(await prisma.notification.count({ where: { type: 'assessment.published', link: { contains: res.created[0]!.id } } })).toBe(0);
  });

  it('is all or nothing: a failure on the second quiz leaves no quiz behind', async () => {
    const c = await courseWithSessions();
    const svc = app.get(AdminAssessmentsService) as unknown as { saveQuestions: (...a: unknown[]) => Promise<void> };
    const real = svc.saveQuestions.bind(svc);
    let calls = 0;
    const spy = jest.spyOn(svc, 'saveQuestions').mockImplementation(async (...a: unknown[]) => {
      if (++calls === 2) throw new Error('boom');
      return real(...a);
    });
    try {
      await importAdmin(c.id, { quizzes: template() }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'assessment.imported', entityId: c.id } })).toBe(0);
  });

  it('refuses a session the course does not have (400), and saves nothing', async () => {
    const c = await courseWithSessions(1);
    const res = await importAdmin(c.id, { quizzes: template() }).expect(400);
    expect(res.body).toMatchObject({ code: 'UNKNOWN_SESSION', errors: [{ path: 'quizzes.1.session', message: 'This course has no session 2' }] });
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(0);
    // Course-level quizzes need no session.
    const [first] = template();
    const ok = (await importAdmin(c.id, { quizzes: [{ ...first!, session: null }] }).expect(200)).body as Result;
    expect(ok.rows[0]!.sessionId).toBeNull();
  });

  it('enforces the limits: 30 quizzes and 1,000 questions per file; a large file fits', async () => {
    const c = await courseWithSessions(1);
    await importAdmin(c.id, { quizzes: many(31) }).expect(400);
    const [first] = template();
    const q = first!.assessment.questions[0]!;
    const fat = (i: number) => ({ ...q, promptEn: `Question ${i}: ${'x'.repeat(400)}` });
    const big = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ session: 1, assessment: { ...first!.assessment, titleEn: `Big ${i}`, questions: Array.from({ length: 200 }, (_, j) => fat(i * 200 + j)) } }));
    await importAdmin(c.id, { quizzes: [...big(5), ...many(1)] }).expect(400);
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(0);
    // 1,000 questions (~0.5 MB, above the API's usual 256 KB body limit) in one go.
    const body = { quizzes: big(5) };
    expect(JSON.stringify(body).length).toBeGreaterThan(400_000);
    const res = (await importAdmin(c.id, body).expect(200)).body as Result;
    expect(res.created.reduce((n, x) => n + x.questions, 0)).toBe(1000);
    // Other routes keep the small limit.
    await http().post(`/api/admin/courses/${c.id}/assessments`).set('Cookie', admin.cookie).send({ ...first!.assessment, titleEn: 'Too big', questions: Array.from({ length: 200 }, (_, j) => ({ ...fat(j), promptEn: 'y'.repeat(1900) })) }).expect(413);
  });

  it('skips quizzes whose title is already used in that session, or replaces them when asked', async () => {
    const c = await courseWithSessions();
    const first = (await importAdmin(c.id, { quizzes: template() }).expect(200)).body as Result;
    const ids = first.created.map((x) => x.id);

    // Same titles, other case: skipped by default.
    const again = template().map((q) => ({ ...q, assessment: { ...q.assessment, titleEn: q.assessment.titleEn.toUpperCase() } }));
    const skipped = (await importAdmin(c.id, { quizzes: again }).expect(200)).body as Result;
    expect(skipped.created).toEqual([]);
    expect(skipped.skipped.map((x) => x.id)).toEqual(ids);
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(2);
    // The same title on another session is a different quiz.
    const [s1] = template();
    const moved = (await importAdmin(c.id, { quizzes: [{ ...s1!, session: 2 }] }).expect(200)).body as Result;
    expect(moved.created).toHaveLength(1);

    // Replace: same ids, the file's questions and settings, published (students told once).
    const student = await createUser(app, prisma, { prefix: 'qim-stu' });
    await prisma.enrollment.create({ data: { userId: student.id, courseId: c.id } });
    const replacing = template().map((q) => ({ ...q, assessment: { ...q.assessment, status: 'PUBLISHED' as const, passPercent: 90, questions: q.assessment.questions.slice(0, 2) } }));
    const replaced = (await importAdmin(c.id, { replaceExisting: true, quizzes: replacing }).expect(200)).body as Result;
    expect(replaced.replaced.map((x) => x.id)).toEqual(ids);
    expect(replaced.created).toEqual([]);
    const after = await prisma.assessment.findUnique({ where: { id: ids[0] }, include: { _count: { select: { questions: true } } } });
    expect(after).toMatchObject({ status: 'PUBLISHED', passPercent: 90, _count: { questions: 2 } });
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'assessment.published' } })).toBe(2);
    expect(await prisma.outboundEmail.count({ where: { userId: student.id, category: 'assessment-published' } })).toBe(2);

    // A quiz students have submitted can't be replaced: the whole file is refused.
    await prisma.submission.create({ data: { assessmentId: ids[1]!, userId: student.id, submittedAt: new Date(), score: 5, maxScore: 100 } });
    const locked = await importAdmin(c.id, { replaceExisting: true, quizzes: template() }).expect(409);
    expect(locked.body).toMatchObject({ code: 'HAS_SUBMISSIONS', titles: ['Session 2 review'] });
    expect((await prisma.assessment.findUnique({ where: { id: ids[0] } }))!.passPercent).toBe(90);
    // Skipping still works for it.
    expect(((await importAdmin(c.id, { quizzes: template() }).expect(200)).body as Result).skipped).toHaveLength(2);
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'assessment.published' } })).toBe(2);
  });

  it('is open to course staff with "manage assessments" in Teaching, within their daily cap', async () => {
    const c = await courseWithSessions();
    const manager = await staffWith(c.id, ['MANAGE_ASSESSMENTS']);
    const grader = await staffWith(c.id, ['GRADE']);
    const teach = (who: Account, body: object, courseId = c.id) => http().post(`/api/teach/courses/${courseId}/assessments/import`).set('Cookie', who.cookie).send(body);

    const res = (await teach(manager, { quizzes: template() }).expect(200)).body as Result;
    expect(res.created).toHaveLength(2);
    expect(await prisma.assessment.count({ where: { courseId: c.id, updatedById: manager.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'assessment.imported', actorId: manager.id, entityId: c.id } })).toBe(1);

    expect((await teach(grader, { quizzes: template() }).expect(403)).body.code).toBe('COURSE_PERMISSION');
    const other = await courseWithSessions();
    expect((await teach(manager, { quizzes: template() }, other.id).expect(403)).body.code).toBe('NOT_YOUR_COURSE');
    // The old /speaker/courses prefix serves the same route, with the same checks.
    await http().post(`/api/speaker/courses/${c.id}/assessments/import`).set('Cookie', grader.cookie).send({ quizzes: template() }).expect(403);

    // New quizzes count toward the daily cap on new assessments: refused before anything is written.
    const left = SPEAKER_ASSESSMENTS_PER_DAY - 2;
    expect((await teach(manager, { quizzes: many(left + 1) }).expect(429)).body.code).toBe('SPEAKER_ASSESSMENT_LIMIT');
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(2);
    // Skipped ones don't count.
    expect(((await teach(manager, { quizzes: template() }).expect(200)).body as Result).skipped).toHaveLength(2);
  });

  it('is closed to admin presets without academic access, and to students', async () => {
    const c = await courseWithSessions();
    const content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'qim-content' });
    const admissions = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'qim-adm' });
    const student = await createUser(app, prisma, { prefix: 'qim-s' });
    await importAdmin(c.id, { quizzes: template() }, content).expect(403);
    await importAdmin(c.id, { quizzes: template() }, admissions).expect(403);
    await importAdmin(c.id, { quizzes: template() }, student).expect(403);
    await http().post(`/api/teach/courses/${c.id}/assessments/import`).set('Cookie', content.cookie).send({ quizzes: template() }).expect(403);
    expect(await prisma.assessment.count({ where: { courseId: c.id } })).toBe(0);
    // A super admin may.
    const sup = await createUser(app, prisma, { role: 'ADMIN', prefix: 'qim-super' });
    await importAdmin(c.id, { quizzes: template() }, sup).expect(200);
  });
});
