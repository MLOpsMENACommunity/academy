import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const video = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const past = new Date('2026-08-16T16:00:00Z');

describe('self-paced courses (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** Two required videos, one optional video, one lesson with no video, and a required quiz (70%). */
  async function setup(opts: { quiz?: boolean; name?: boolean; selfPaced?: boolean } = {}) {
    const course = await createCourse(prisma, { requiresApproval: false });
    await prisma.course.update({ where: { id: course.id }, data: { selfPaced: opts.selfPaced ?? true } });
    const lesson = (order: number, recordingUrl: string | null, optional = false) =>
      prisma.courseSession.create({ data: { courseId: course.id, order, titleEn: `L${order}`, titleAr: `د${order}`, startsAt: past, durationMin: 60, recordingUrl, optional } });
    const required1 = await lesson(1, video('aaaaaaaaaaa'));
    const required2 = await lesson(2, video('bbbbbbbbbbb'));
    const optional = await lesson(3, video('ccccccccccc'), true);
    const noVideo = await lesson(4, null);
    const student = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    await prisma.profile.update({ where: { userId: student.id }, data: opts.name === false ? { fullNameEn: '', fullNameAr: '' } : { fullNameEn: 'Sam Student' } });
    let quiz: { id: string; questionId: string; right: string; wrong: string } | null = null;
    if (opts.quiz !== false) {
      const a = await prisma.assessment.create({
        data: {
          courseId: course.id,
          type: 'QUIZ',
          status: 'PUBLISHED',
          titleEn: 'Final',
          titleAr: 'نهائي',
          maxPoints: 10,
          passPercent: 70,
          attemptsAllowed: 0,
          countsForCertificate: true,
          questions: { create: { kind: 'SINGLE', promptEn: 'Q', promptAr: 'س', weight: 1, order: 0, options: { create: [{ labelEn: 'Yes', labelAr: 'نعم', correct: true, order: 0 }, { labelEn: 'No', labelAr: 'لا', correct: false, order: 1 }] } } },
        },
        include: { questions: { include: { options: true } } },
      });
      const q = a.questions[0]!;
      quiz = { id: a.id, questionId: q.id, right: q.options.find((o) => o.correct)!.id, wrong: q.options.find((o) => !o.correct)!.id };
    }
    return { course, student, required1, required2, optional, noVideo, quiz };
  }

  type Ctx = Awaited<ReturnType<typeof setup>>;
  const put = (c: Ctx, sessionId: string, body: { completed: boolean; source: 'WATCHED' | 'MANUAL' }, cookie = c.student.cookie) =>
    http().put(`/api/learn/${c.course.slug}/sessions/${sessionId}/lesson-completion`).set('Cookie', cookie).send(body);
  const learn = async (c: Ctx) => (await http().get(`/api/learn/${c.course.slug}`).set('Cookie', c.student.cookie).expect(200)).body;
  const certOf = (c: Ctx) => prisma.certificate.findFirst({ where: { enrollment: { userId: c.student.id, courseId: c.course.id } } });
  async function takeQuiz(c: Ctx, optionId: string) {
    const base = `/api/learn/${c.course.slug}/assessments/${c.quiz!.id}`;
    await http().post(`${base}/start`).set('Cookie', c.student.cookie).expect(200);
    await http().post(`${base}/submit`).set('Cookie', c.student.cookie).send({ answers: { [c.quiz!.questionId]: [optionId] } }).expect(200);
  }
  const giveFeedback = (c: Ctx, comment: string | null = 'Clear and practical.') =>
    http().put(`/api/learn/${c.course.slug}/feedback`).set('Cookie', c.student.cookie).send({ rating: 5, comment }).expect(204);
  const finishRequired = async (c: Ctx) => {
    await put(c, c.required1.id, { completed: true, source: 'WATCHED' }).expect(204);
    await put(c, c.required2.id, { completed: true, source: 'MANUAL' }).expect(204);
  };

  it('records how a lesson was completed, and a video that ended outranks a manual tick', async () => {
    const c = await setup();
    await put(c, c.required1.id, { completed: true, source: 'MANUAL' }).expect(204);
    let lesson = (await learn(c)).sessions.find((s: { id: string }) => s.id === c.required1.id);
    expect(lesson).toMatchObject({ completed: true, lessonCompletion: 'MANUAL', phase: 'ended' });

    await put(c, c.required1.id, { completed: true, source: 'WATCHED' }).expect(204);
    await put(c, c.required1.id, { completed: true, source: 'MANUAL' }).expect(204);
    lesson = (await learn(c)).sessions.find((s: { id: string }) => s.id === c.required1.id);
    expect(lesson.lessonCompletion).toBe('WATCHED');

    await put(c, c.required1.id, { completed: false, source: 'MANUAL' }).expect(204);
    lesson = (await learn(c)).sessions.find((s: { id: string }) => s.id === c.required1.id);
    expect(lesson).toMatchObject({ completed: false, lessonCompletion: null });
  });

  it('counts only required videos toward progress', async () => {
    const c = await setup();
    await put(c, c.optional.id, { completed: true, source: 'MANUAL' }).expect(204);
    expect((await learn(c)).progress).toEqual({ completed: 0, total: 2, percent: 0 });
    await put(c, c.required1.id, { completed: true, source: 'WATCHED' }).expect(204);
    expect((await learn(c)).progress).toEqual({ completed: 1, total: 2, percent: 50 });
  });

  it('refuses a lesson with no video, a live course, a stranger and an invalid source', async () => {
    const c = await setup();
    await put(c, c.noVideo.id, { completed: true, source: 'MANUAL' }).expect(409);
    await http().put(`/api/learn/${c.course.slug}/sessions/${c.required1.id}/lesson-completion`).set('Cookie', c.student.cookie).send({ completed: true, source: 'OTHER' }).expect(400);
    const stranger = await createUser(app, prisma);
    await put(c, c.required1.id, { completed: true, source: 'MANUAL' }, stranger.cookie).expect(403);

    const live = await setup({ selfPaced: false });
    await put(live, live.required1.id, { completed: true, source: 'MANUAL' }).expect(409);
  });

  it('issues the attendance certificate as soon as the quiz is passed after the videos', async () => {
    const c = await setup();
    await giveFeedback(c);
    await finishRequired(c);
    expect(await certOf(c)).toBeNull();
    await takeQuiz(c, c.quiz!.wrong);
    expect(await certOf(c)).toBeNull();
    await takeQuiz(c, c.quiz!.right);
    expect(await certOf(c)).toMatchObject({ kind: 'ATTENDANCE', issuedById: null, nameOnCertificate: 'Sam Student' });
    const view = await http().get(`/api/certificates/${(await certOf(c))!.serial}`).expect(200);
    expect(view.body.kind).toBe('ATTENDANCE');
  });

  it('issues it when the last video is finished after the quiz, and does not need the optional one', async () => {
    const c = await setup();
    await giveFeedback(c);
    await takeQuiz(c, c.quiz!.right);
    await put(c, c.required1.id, { completed: true, source: 'MANUAL' }).expect(204);
    expect(await certOf(c)).toBeNull();
    await put(c, c.required2.id, { completed: true, source: 'WATCHED' }).expect(204);
    expect((await certOf(c))?.kind).toBe('ATTENDANCE');
  });

  it('never issues on watching alone: a course with no required quiz gives no certificate', async () => {
    const c = await setup({ quiz: false });
    await giveFeedback(c);
    await finishRequired(c);
    expect(await certOf(c)).toBeNull();
    const card = (await http().get(`/api/learn/${c.course.slug}/certificate`).set('Cookie', c.student.cookie).expect(200)).body;
    expect(card).toMatchObject({ selfPaced: true, eligibility: { eligible: false }, certificate: null });
  });

  it('ignores completions that did not come from the lesson player', async () => {
    const c = await setup();
    await prisma.sessionProgress.createMany({ data: [c.required1, c.required2].map((s) => ({ userId: c.student.id, sessionId: s.id })) });
    await prisma.sessionAttendance.create({ data: { userId: c.student.id, sessionId: c.required2.id, minutes: 60, percent: 100, status: 'PRESENT', source: 'MANUAL' } });
    await takeQuiz(c, c.quiz!.right);
    expect(await certOf(c)).toBeNull();
    expect((await learn(c)).progress.completed).toBe(0);
  });

  it('issues a certificate held back by a missing name once the name is added and the course is opened', async () => {
    const c = await setup({ name: false });
    await giveFeedback(c);
    await finishRequired(c);
    await takeQuiz(c, c.quiz!.right);
    expect(await certOf(c)).toBeNull();
    await prisma.profile.update({ where: { userId: c.student.id }, data: { fullNameEn: 'Late Name' } });
    const card = (await http().get(`/api/learn/${c.course.slug}/certificate`).set('Cookie', c.student.cookie).expect(200)).body;
    expect(card.certificate).toMatchObject({ nameOnCertificate: 'Late Name', status: 'VALID' });
  });

  it('waits for the course feedback with a comment, and issues the moment it arrives', async () => {
    const c = await setup();
    await finishRequired(c);
    await takeQuiz(c, c.quiz!.right);
    expect(await certOf(c)).toBeNull();
    await giveFeedback(c, null);
    expect(await certOf(c)).toBeNull();
    let card = (await http().get(`/api/learn/${c.course.slug}/certificate`).set('Cookie', c.student.cookie).expect(200)).body;
    expect(card.eligibility).toMatchObject({ eligible: false, feedback: { ok: false } });
    await giveFeedback(c);
    expect((await certOf(c))?.kind).toBe('ATTENDANCE');
    card = (await http().get(`/api/learn/${c.course.slug}/certificate`).set('Cookie', c.student.cookie).expect(200)).body;
    expect(card.certificate.status).toBe('VALID');
  });

  describe('testimonials', () => {
    const text = 'This course changed how I ship models to production.';
    const say = (c: Ctx, body: Record<string, unknown>, cookie = c.student.cookie) => http().put(`/api/learn/${c.course.slug}/testimonial`).set('Cookie', cookie).send(body);
    const publicList = async (c: Ctx) => (await http().get(`/api/courses/${c.course.slug}`).expect(200)).body.testimonials;
    const admin = () => createUser(app, prisma, { role: 'ADMIN', prefix: 'testimonial-admin' });
    const base = (c: Ctx) => `/api/admin/courses/${c.course.id}/testimonials`;

    it('needs consent, real text and an enrolment in a self-paced course', async () => {
      const c = await setup();
      await say(c, { body: text, consent: false }).expect(400);
      await say(c, { body: 'too short', consent: true }).expect(400);
      await say(c, { body: text, consent: true }, (await createUser(app, prisma)).cookie).expect(403);
      const live = await setup({ selfPaced: false });
      await say(live, { body: text, consent: true }).expect(409);
    });

    it('is public only once approved, with the name and the words only', async () => {
      const c = await setup();
      const a = await admin();
      await say(c, { body: text, consent: true }).expect(204);
      expect(await publicList(c)).toEqual([]);
      expect((await learn(c)).testimonial).toEqual({ body: text, status: 'PENDING' });

      await http().get(base(c)).set('Cookie', c.student.cookie).expect(403);
      const [row] = (await http().get(base(c)).set('Cookie', a.cookie).expect(200)).body;
      await http().put(`${base(c)}/${row.id}/review`).set('Cookie', c.student.cookie).send({ status: 'APPROVED' }).expect(403);
      await http().put(`${base(c)}/${row.id}/review`).set('Cookie', a.cookie).send({ status: 'APPROVED' }).expect(204);
      expect(await publicList(c)).toEqual([{ id: row.id, name: 'Sam Student', nameAr: null, body: text }]);
      expect(await prisma.auditLog.count({ where: { action: 'testimonial.reviewed', entityId: row.id } })).toBe(1);

      // An edit goes back to review and leaves the site.
      await say(c, { body: `${text} Edited.`, consent: true }).expect(204);
      expect(await publicList(c)).toEqual([]);
      expect((await learn(c)).testimonial.status).toBe('PENDING');
    });

    it('can be withdrawn, and a review cannot reach another course', async () => {
      const c = await setup();
      const other = await setup();
      const a = await admin();
      await say(c, { body: text, consent: true }).expect(204);
      const [row] = (await http().get(base(c)).set('Cookie', a.cookie).expect(200)).body;
      await http().put(`${base(other)}/${row.id}/review`).set('Cookie', a.cookie).send({ status: 'APPROVED' }).expect(404);
      await http().put(`${base(c)}/${row.id}/review`).set('Cookie', a.cookie).send({ status: 'APPROVED' }).expect(204);
      await http().delete(`/api/learn/${c.course.slug}/testimonial`).set('Cookie', c.student.cookie).expect(204);
      expect(await publicList(c)).toEqual([]);
      expect(await prisma.testimonial.count({ where: { courseId: c.course.id } })).toBe(0);
    });

    it('is not needed for the certificate', async () => {
      const c = await setup();
      await giveFeedback(c);
      await finishRequired(c);
      await takeQuiz(c, c.quiz!.right);
      expect((await certOf(c))?.kind).toBe('ATTENDANCE');
      expect(await prisma.testimonial.count({ where: { courseId: c.course.id } })).toBe(0);
    });
  });

  it('keeps the videos behind enrolment even with public recordings ticked', async () => {
    const c = await setup();
    await prisma.course.update({ where: { id: c.course.id }, data: { publicRecordings: true } });
    const page = (await http().get(`/api/courses/${c.course.slug}`).expect(200)).body;
    expect(page.publicRecordings).toBe(false);
    expect(page.sessions.map((s: { recordingUrl: string | null }) => s.recordingUrl)).toEqual([null, null, null, null]);
    expect(await learn(c)).toMatchObject({ selfPaced: true });
  });

  it('leaves live courses as they were: same rule, completion certificates, no automatic issue', async () => {
    const c = await setup({ selfPaced: false });
    await prisma.course.update({ where: { id: c.course.id }, data: { certMinSessionsPercent: null } });
    await takeQuiz(c, c.quiz!.right);
    expect(await certOf(c)).toBeNull();
    expect((await learn(c)).selfPaced).toBe(false);
  });
});
