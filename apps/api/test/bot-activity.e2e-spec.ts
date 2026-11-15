import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('community bot activity feed (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const token = 'b'.repeat(40);
  const window = { from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' };
  const at = (d: number, h = 18) => new Date(Date.UTC(2026, 0, d, h));

  beforeAll(async () => {
    process.env.BOT_API_TOKEN = token;
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    delete process.env.BOT_API_TOKEN;
    await app.close();
  });

  const get = () => request(app.getHttpServer()).get('/api/bot/v1/activity');

  async function setup() {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma, { prefix: 'botfeed' });
    await prisma.profile.update({ where: { userId: student.id }, data: { telegramUsername: 'Layla_ML' } });
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    const session = (order: number, startsAt: Date) => prisma.courseSession.create({ data: { courseId: course.id, order, titleEn: 's', titleAr: 's', startsAt } });
    const first = await session(1, at(5));
    const second = await session(2, at(12));
    const assessment = (type: 'QUIZ' | 'LAB', sessionId: string | null) =>
      prisma.assessment.create({ data: { courseId: course.id, sessionId, type, status: 'PUBLISHED', titleEn: 'a', titleAr: 'a' } });
    return { course, student, first, second, assessment };
  }
  const items = async (userId: string) => {
    const res = await get().query(window).set('x-bot-token', token).expect(200);
    return (res.body.items as { academyUserId: string }[]).filter((i) => i.academyUserId === userId) as Record<string, unknown>[];
  };

  it('needs the token, checked before the query', async () => {
    await get().query(window).expect(401);
    await get().set('x-bot-token', 'wrong').expect(401);
    await get().query({ from: 'nope' }).set('x-bot-token', token).expect(400);
  });

  it('is never cached', async () => {
    const res = await get().query(window).set('x-bot-token', token).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports each kind of activity, with only what the bot needs', async () => {
    const { course, student, first, second, assessment } = await setup();
    const quiz = await assessment('QUIZ', first.id);
    const midpoint = await assessment('QUIZ', null);
    const lab = await assessment('LAB', first.id);
    const answers = { q: ['o'] };
    await prisma.submission.create({ data: { assessmentId: quiz.id, userId: student.id, answers, submittedAt: at(6), maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: midpoint.id, userId: student.id, answers, submittedAt: at(7), maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: lab.id, userId: student.id, url: 'https://x.io', submittedAt: at(8), createdAt: at(8), maxScore: 100 } });
    await prisma.sessionAttendance.create({ data: { sessionId: first.id, userId: student.id, status: 'PARTIAL' } });
    await prisma.sessionAttendance.create({ data: { sessionId: second.id, userId: student.id, status: 'ABSENT' } });

    const got = await items(student.id);
    expect(got.map((i) => i.kind)).toEqual(['ATTENDANCE', 'WEEKLY_QUIZ', 'MIDPOINT_QUIZ', 'PRACTICAL_TASK']);
    expect(got[3]).toEqual({
      id: expect.stringMatching(/^submission:/),
      academyUserId: student.id,
      telegramUsername: 'Layla_ML',
      courseSlug: course.slug,
      kind: 'PRACTICAL_TASK',
      occurredAt: at(8).toISOString(),
      deadlineAt: at(12).toISOString(),
    });
  });

  it('dates a resubmitted lab by its first hand-in', async () => {
    const { student, first, assessment } = await setup();
    const lab = await assessment('LAB', first.id);
    await prisma.submission.create({ data: { assessmentId: lab.id, userId: student.id, submittedAt: at(20), createdAt: at(8), maxScore: 100 } });
    expect((await items(student.id))[0]).toMatchObject({ occurredAt: at(8).toISOString() });
  });

  it('skips a timed-out quiz with no answers, a capstone, in-progress attempts and retakes', async () => {
    const { student, first, assessment } = await setup();
    const timedOut = await assessment('QUIZ', first.id);
    const open = await assessment('QUIZ', first.id);
    const retaken = await assessment('QUIZ', first.id);
    const capstone = await assessment('LAB', null);
    await prisma.submission.create({ data: { assessmentId: timedOut.id, userId: student.id, answers: {}, submittedAt: at(6), maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: open.id, userId: student.id, maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: retaken.id, userId: student.id, attempt: 1, answers: { q: ['o'] }, submittedAt: at(6), maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: retaken.id, userId: student.id, attempt: 2, answers: { q: ['o'] }, submittedAt: at(7), maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: capstone.id, userId: student.id, submittedAt: at(6), maxScore: 100 } });
    const got = await items(student.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ occurredAt: at(6).toISOString() });
  });

  it('leaves out students who are no longer enrolled or whose account is deleted', async () => {
    const { student, first, course } = await setup();
    await prisma.sessionAttendance.create({ data: { sessionId: first.id, userId: student.id, status: 'PRESENT' } });
    expect(await items(student.id)).toHaveLength(1);
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
    expect(await items(student.id)).toHaveLength(0);
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: null } });
    await prisma.enrollment.delete({ where: { userId_courseId: { userId: student.id, courseId: course.id } } });
    expect(await items(student.id)).toHaveLength(0);
  });
});

describe('community bot activity feed, no token configured (e2e)', () => {
  it('does not exist', async () => {
    delete process.env.BOT_API_TOKEN;
    const { app } = await createTestApp();
    await request(app.getHttpServer()).get('/api/bot/v1/activity').set('x-bot-token', 'x'.repeat(40)).expect(404);
    await app.close();
  });
});
