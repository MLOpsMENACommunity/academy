import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

const video = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const past = new Date('2026-08-16T16:00:00Z');

describe('resume at the exact second (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** A course (self-paced or live) with two videos and a session without one, and an enrolled student. */
  async function setup(selfPaced = true) {
    const course = await createCourse(prisma, { requiresApproval: false });
    await prisma.course.update({ where: { id: course.id }, data: { selfPaced } });
    const lesson = (order: number, recordingUrl: string | null) =>
      prisma.courseSession.create({
        data: { courseId: course.id, order, titleEn: `L${order}`, titleAr: `د${order}`, startsAt: past, durationMin: 60, recordingUrl },
      });
    const first = await lesson(1, video('aaaaaaaaaaa'));
    const second = await lesson(2, video('bbbbbbbbbbb'));
    const noVideo = await lesson(3, null);
    const student = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    return { course, student, first, second, noVideo };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const save = (c: Ctx, sessionId: string, body: object, cookie = c.student.cookie, slug = c.course.slug) =>
    http().put(`/api/learn/${slug}/sessions/${sessionId}/position`).set('Cookie', cookie).send(body);
  const learn = async (c: Ctx) => (await http().get(`/api/learn/${c.course.slug}`).set('Cookie', c.student.cookie).expect(200)).body;
  const sessionOf = async (c: Ctx, id: string) => (await learn(c)).sessions.find((s: { id: string }) => s.id === id);

  it('saves where they stopped and resumes 3 seconds earlier; nothing saved is null', async () => {
    const c = await setup();
    let body = await learn(c);
    expect(body.lastWatched).toBeNull();
    expect(body.sessions.every((s: { resumeAt: unknown }) => s.resumeAt === null)).toBe(true);

    await save(c, c.first.id, { positionSec: 2530, durationSec: 3600 }).expect(204);
    body = await learn(c);
    expect(body.sessions.find((s: { id: string }) => s.id === c.first.id).resumeAt).toBe(2527);
    expect(body.sessions.find((s: { id: string }) => s.id === c.second.id).resumeAt).toBeNull();
    expect(body.lastWatched).toEqual({ sessionId: c.first.id, positionSec: 2530 });

    // Saving again moves it (one row per student and session), without a duration too.
    await save(c, c.first.id, { positionSec: 100 }).expect(204);
    expect((await sessionOf(c, c.first.id)).resumeAt).toBe(97);
    expect(await prisma.lessonWatch.count({ where: { userId: c.student.id } })).toBe(1);
    // A position never completes the lesson.
    expect(await sessionOf(c, c.first.id)).toMatchObject({ completed: false, lessonCompletion: null });
  });

  it('starts from the beginning near the end, under 5 seconds and once the lesson is completed', async () => {
    const c = await setup();
    await save(c, c.first.id, { positionSec: 3595, durationSec: 3600 }).expect(204);
    expect((await sessionOf(c, c.first.id)).resumeAt).toBe(0);
    await save(c, c.first.id, { positionSec: 4 }).expect(204);
    expect((await sessionOf(c, c.first.id)).resumeAt).toBe(0);

    await save(c, c.second.id, { positionSec: 600, durationSec: 3600 }).expect(204);
    await http()
      .put(`/api/learn/${c.course.slug}/sessions/${c.second.id}/lesson-completion`)
      .set('Cookie', c.student.cookie)
      .send({ completed: true, source: 'MANUAL' })
      .expect(204);
    const body = await learn(c);
    expect(body.sessions.find((s: { id: string }) => s.id === c.second.id).resumeAt).toBe(0);
    // Nothing left to resume: no "Continue".
    expect(body.lastWatched).toBeNull();
  });

  it('lastWatched is the most recently saved video that can still be resumed', async () => {
    const c = await setup();
    await save(c, c.first.id, { positionSec: 300, durationSec: 3600 }).expect(204);
    await save(c, c.second.id, { positionSec: 120, durationSec: 3600 }).expect(204);
    expect((await learn(c)).lastWatched).toEqual({ sessionId: c.second.id, positionSec: 120 });

    // The second one finished (completed): the first one is what's left to continue.
    await http()
      .put(`/api/learn/${c.course.slug}/sessions/${c.second.id}/lesson-completion`)
      .set('Cookie', c.student.cookie)
      .send({ completed: true, source: 'WATCHED' })
      .expect(204);
    expect((await learn(c)).lastWatched).toEqual({ sessionId: c.first.id, positionSec: 300 });

    // Watching the first one to its end leaves nothing to continue.
    await save(c, c.first.id, { positionSec: 3600, durationSec: 3600 }).expect(204);
    expect((await learn(c)).lastWatched).toBeNull();
  });

  it('works for the recordings of a live course too, where attendance does not restart the video', async () => {
    const c = await setup(false);
    await prisma.sessionAttendance.create({ data: { userId: c.student.id, sessionId: c.first.id, status: 'PRESENT', minutes: 60, percent: 100 } });
    await save(c, c.first.id, { positionSec: 900, durationSec: 3600 }).expect(204);
    const body = await learn(c);
    expect(body.sessions.find((s: { id: string }) => s.id === c.first.id)).toMatchObject({ completed: true, resumeAt: 897 });
    expect(body.lastWatched).toEqual({ sessionId: c.first.id, positionSec: 900 });
  });

  it('refuses a student who is not enrolled, an admin preview, a session of another course and a session without a video', async () => {
    const c = await setup();
    const other = await setup();
    const stranger = await createUser(app, prisma);
    await save(c, c.first.id, { positionSec: 60 }, stranger.cookie).expect(403);
    const admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'] });
    await save(c, c.first.id, { positionSec: 60 }, admin.cookie).expect(403);
    await save(c, other.first.id, { positionSec: 60 }).expect(404);
    await save(c, 'no-such-session', { positionSec: 60 }).expect(404);
    await save(c, c.noVideo.id, { positionSec: 60 }).expect(409);
    await http().put(`/api/learn/${c.course.slug}/sessions/${c.first.id}/position`).send({ positionSec: 60 }).expect(401);
    expect(await prisma.lessonWatch.count({ where: { sessionId: { in: [c.first.id, other.first.id, c.noVideo.id] } } })).toBe(0);
  });

  it('validates the body', async () => {
    const c = await setup();
    for (const body of [{}, { positionSec: -1 }, { positionSec: 86_401 }, { positionSec: 1.5 }, { positionSec: 10, durationSec: 0 }, { positionSec: '10' }, { positionSec: 10, completed: true }]) {
      await save(c, c.first.id, body).expect(400);
    }
    await save(c, c.first.id, { positionSec: 86_400, durationSec: 86_400 }).expect(204);
  });

  it('is in the data export and deleted on anonymisation', async () => {
    const c = await setup();
    await save(c, c.first.id, { positionSec: 2530, durationSec: 3600 }).expect(204);
    const exported = (await http().get('/api/me/export').set('Cookie', c.student.cookie).expect(200)).body;
    expect(exported.videoPositions).toEqual([
      expect.objectContaining({ course: c.course.slug, session: 1, sessionTitle: 'L1', positionSec: 2530, durationSec: 3600 }),
    ]);

    await prisma.user.update({ where: { id: c.student.id }, data: { deletedAt: new Date() } });
    await app.get(AccountService).anonymize(c.student.id);
    expect(await prisma.lessonWatch.count({ where: { userId: c.student.id } })).toBe(0);
  });

  it("leaves the signed-in cache alone (it writes nothing the cache holds)", async () => {
    const { SignedInCache } = await import('../src/common/signed-in-cache');
    const cache = app.get(SignedInCache);
    const c = await setup();
    const spy = jest.spyOn(cache, 'clear');
    await save(c, c.first.id, { positionSec: 60 }).expect(204);
    expect(spy).not.toHaveBeenCalled();
    await http().put(`/api/learn/${c.course.slug}/reminders`).set('Cookie', c.student.cookie).send({ emailReminders: false }).expect(204);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
