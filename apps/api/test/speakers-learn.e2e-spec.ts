import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { AccountJobs } from '../src/jobs/account.jobs';
import { FeedbackPromptJobs } from '../src/learn/feedback-prompts.jobs';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Speakers study too: a SPEAKER account goes through every student flow (profile, apply,
 * admission, learn page, assessments, roster, leaderboard, feedback prompts, certificates)
 * and keeps its speaker portal.
 */
describe('speakers can learn (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it('a speaker completes the student profile, applies, is enrolled and learns like a student', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'spl-admin' });
    const speaker = await createUser(app, prisma, {
      role: 'SPEAKER',
      prefix: 'spl-speaker',
      coreComplete: false,
    });
    const as = (cookie: string) => ({
      get: (url: string) => http().get(url).set('Cookie', cookie),
      put: (url: string, body: object) => http().put(url).set('Cookie', cookie).send(body),
      post: (url: string, body: object = {}) => http().post(url).set('Cookie', cookie).send(body),
    });
    const me = as(speaker.cookie);
    const course = await createCourse(prisma);
    const now = Date.now();
    // Session 1 ended two hours ago (feedback prompt); session 2 is next week.
    const s1 = await prisma.courseSession.create({
      data: {
        courseId: course.id,
        order: 1,
        titleEn: 'Pipelines',
        titleAr: 'خطوط',
        startsAt: new Date(now - 3.5 * HOUR),
        durationMin: 90,
      },
    });
    await prisma.courseSession.create({
      data: {
        courseId: course.id,
        order: 2,
        titleEn: 'Serving',
        titleAr: 'الخدمة',
        startsAt: new Date(now + 7 * DAY),
        durationMin: 90,
      },
    });

    // Before any course: a speaker's home, no student side yet, never nagged about usernames.
    expect((await me.get('/api/auth/me').expect(200)).body).toMatchObject({
      role: 'SPEAKER',
      learning: false,
      profile: { coreComplete: false, needsCommunityHandles: false },
    });

    // The same profile gate as a student: applying needs the complete profile first.
    const apply = () =>
      me.post('/api/applications', {
        courseSlug: course.slug,
        answers: { [course.questionId]: true },
      });
    expect((await apply().expect(403)).body.code).toBe('PROFILE_INCOMPLETE');

    await me
      .put('/api/me/profile/core', {
        fullNameEn: 'Sara Speaker',
        phone: '0100 123 4567',
        country: 'EG',
        city: 'Cairo',
        timezone: 'Africa/Cairo',
        employmentStatus: 'EMPLOYED_FULL_TIME',
        jobTitle: 'ML Engineer',
        experienceYears: 'Y3_5',
        primaryArea: 'MLOPS',
        googleEmail: 'sara.speaker@gmail.com',
        preferredLanguage: 'en',
        acceptTerms: true,
      })
      .expect(200);
    await me
      .put('/api/me/profile/professional', {
        industry: 'TELECOM',
        mlExperienceYears: 'Y1_3',
        seniority: 'MID',
        secondaryAreas: [],
      })
      .expect(200);
    await me.put('/api/me/profile/education', { educationLevel: 'BACHELORS' }).expect(200);
    await me
      .put('/api/me/profile/links', {
        linkedinUrl: 'https://www.linkedin.com/in/sara-speaker',
        githubUrl: 'https://github.com/sara-speaker',
      })
      .expect(200);
    // Including the Telegram and Discord usernames, like any student.
    const community = {
      referralSource: 'LINKEDIN',
      communityMember: false,
      openToOpportunities: false,
      shareWithPartners: false,
      marketingEmails: false,
    };
    await me.put('/api/me/profile/community', community).expect(400);
    const done = await me
      .put('/api/me/profile/community', {
        ...community,
        telegramUsername: '@sara_ml',
        discordUsername: 'sara.ml',
      })
      .expect(200);
    expect(done.body).toMatchObject({ coreComplete: true, telegramUsername: 'sara_ml' });

    // Apply: the application is the speaker's, on the student dashboard, and "My learning" turns on.
    const app1 = (await apply().expect(201)).body;
    expect(app1.status).toBe('SUBMITTED');
    expect((await me.get('/api/me/applications').expect(200)).body).toEqual([
      expect.objectContaining({ id: app1.id }),
    ]);
    expect((await me.get('/api/auth/me').expect(200)).body).toMatchObject({
      learning: true,
      profile: { coreComplete: true, needsCommunityHandles: false },
    });

    // Admins see it with the other applications, and the speaker in Admin → Students (with their role).
    const apps = (
      await as(admin.cookie).get(`/api/admin/applications?courseId=${course.id}`).expect(200)
    ).body;
    expect(JSON.stringify(apps)).toContain(app1.id);
    const dir = (
      await as(admin.cookie)
        .get(`/api/admin/students?q=${encodeURIComponent(speaker.email)}`)
        .expect(200)
    ).body;
    expect(dir.items).toEqual([
      expect.objectContaining({ id: speaker.id, role: 'SPEAKER', applications: 1 }),
    ]);

    // Accepted (a free course): enrolled.
    const accepted = await as(admin.cookie)
      .post(`/api/admin/applications/${app1.id}/transition`, { event: 'ACCEPT' })
      .expect(200);
    expect(accepted.body.status).toBe('ENROLLED');
    expect(
      await prisma.enrollment.count({ where: { userId: speaker.id, courseId: course.id } }),
    ).toBe(1);
    await prisma.enrollment.updateMany({
      where: { userId: speaker.id, courseId: course.id },
      data: { enrolledAt: new Date(now - DAY) },
    });

    // The learn page.
    const learn = (await me.get(`/api/learn/${course.slug}`).expect(200)).body;
    expect(learn.sessions).toHaveLength(2);

    // A quiz that counts for the certificate: submitted and passed.
    const quiz = (
      await as(admin.cookie)
        .post(`/api/admin/courses/${course.id}/assessments`, {
          type: 'QUIZ',
          status: 'PUBLISHED',
          titleEn: 'Check',
          titleAr: 'تحقق',
          instructionsEn: 'Answer.',
          maxPoints: 10,
          passPercent: 50,
          countsForCertificate: true,
          attemptsAllowed: 1,
          revealAnswers: 'AFTER_SUBMIT',
          questions: [
            {
              kind: 'SINGLE',
              promptEn: 'Which tool tracks experiments?',
              promptAr: 'أي أداة؟',
              weight: 1,
              options: [
                { labelEn: 'MLflow', labelAr: 'MLflow', correct: true },
                { labelEn: 'Nginx', labelAr: 'Nginx', correct: false },
              ],
            },
          ],
        })
        .expect(201)
    ).body as {
      id: string;
      questions: { id: string; options: { id: string; correct: boolean }[] }[];
    };
    const q = quiz.questions[0]!;
    const base = `/api/learn/${course.slug}/assessments/${quiz.id}`;
    await me.post(`${base}/start`).expect(200);
    const submitted = await me
      .post(`${base}/submit`, {
        answers: { [q.id]: q.options.filter((o) => o.correct).map((o) => o.id) },
      })
      .expect(200);
    expect(submitted.body).toMatchObject({ score: 10, passed: true });

    // The attendance roster and the leaderboard.
    const roster = (
      await as(admin.cookie).get(`/api/admin/courses/${course.id}/attendance`).expect(200)
    ).body;
    expect(roster.students).toEqual([
      expect.objectContaining({ userId: speaker.id, name: 'Sara Speaker' }),
    ]);
    await prisma.pointsEntry.create({
      data: { userId: speaker.id, courseId: course.id, points: 15, reason: 'MANUAL_OTHER' },
    });
    await me.put(`/api/learn/${course.slug}/leaderboard/opt-in`, { optedIn: true }).expect(200);
    const board = (await me.get(`/api/learn/${course.slug}/leaderboard?scope=course`).expect(200))
      .body;
    expect(board.me).toMatchObject({ rank: 1, optedIn: true });
    expect(board.rows).toEqual([expect.objectContaining({ rank: 1, me: true, name: 'Sara S.' })]);
    const adminBoard = (
      await as(admin.cookie)
        .get(`/api/admin/courses/${course.id}/leaderboard?scope=course`)
        .expect(200)
    ).body;
    expect(adminBoard.rows).toEqual([expect.objectContaining({ userId: speaker.id })]);

    // "How was the session?": the speaker is asked like any enrolled student.
    await app.get(FeedbackPromptJobs).run();
    expect(
      await prisma.notification.count({ where: { userId: speaker.id, type: 'feedback.prompt' } }),
    ).toBe(1);
    expect(
      await prisma.outboundEmail.count({
        where: { dedupeKey: { startsWith: `feedback:${s1.id}:` }, userId: speaker.id },
      }),
    ).toBe(1);

    // Certificate-eligible (default rule: pass the counted assessments), and issued.
    const certs = (
      await as(admin.cookie).get(`/api/admin/courses/${course.id}/certificates`).expect(200)
    ).body;
    expect(certs.rows).toEqual([
      expect.objectContaining({
        userId: speaker.id,
        eligibility: expect.objectContaining({ eligible: true }),
      }),
    ]);
    const issued = await as(admin.cookie)
      .post(`/api/admin/courses/${course.id}/certificates`, { userIds: [speaker.id] })
      .expect(201);
    expect(JSON.stringify(issued.body)).toContain(speaker.id);
    expect(
      await prisma.certificate.count({
        where: { enrollment: { userId: speaker.id, courseId: course.id } },
      }),
    ).toBe(1);

    // The speaker portal still works for them.
    const portal = (await me.get('/api/speaker').expect(200)).body;
    expect(portal).toHaveProperty('bookings');
  });

  it('withdraws, and an admin trying the flow is still never counted as a student', async () => {
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spl-withdraw' });
    const course = await createCourse(prisma);
    const res = await http()
      .post('/api/applications')
      .set('Cookie', speaker.cookie)
      .send({ courseSlug: course.slug, answers: { [course.questionId]: true } })
      .expect(201);
    const w = await http()
      .post(`/api/me/applications/${res.body.id}/withdraw`)
      .set('Cookie', speaker.cookie)
      .expect(200);
    expect(w.body.status).toBe('WITHDRAWN');

    // An admin enrolled in a course (testing) is left out of the certificate roster; a speaker isn't.
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'spl-adm2' });
    const other = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spl-enrolled' });
    await prisma.enrollment.createMany({
      data: [
        { userId: admin.id, courseId: course.id },
        { userId: other.id, courseId: course.id },
      ],
    });
    const certs = (
      await http()
        .get(`/api/admin/courses/${course.id}/certificates`)
        .set('Cookie', admin.cookie)
        .expect(200)
    ).body;
    expect(certs.rows.map((r: { userId: string }) => r.userId)).toEqual([other.id]);
  });

  it('lists in Admin → Students only the speakers who applied or enrolled', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'spl-dir-admin' });
    const quiet = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spl-dir-quiet' });
    const enrolled = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spl-dir-enrolled' });
    const course = await createCourse(prisma);
    await prisma.enrollment.create({ data: { userId: enrolled.id, courseId: course.id } });
    const find = async (email: string) =>
      (
        await http()
          .get(`/api/admin/students?q=${encodeURIComponent(email)}`)
          .set('Cookie', admin.cookie)
          .expect(200)
      ).body.items;
    expect(await find(quiet.email)).toEqual([]);
    expect(await find(enrolled.email)).toEqual([
      expect.objectContaining({ id: enrolled.id, role: 'SPEAKER', enrollments: 1 }),
    ]);
    const csv = (
      await http()
        .get(`/api/admin/students.csv?q=${encodeURIComponent(enrolled.email)}`)
        .set('Cookie', admin.cookie)
        .expect(200)
    ).text;
    const [header, row] = csv.trim().split(/\r?\n/);
    expect(header).toMatch(/,"Speaker"$/);
    expect(row).toMatch(/,"?true"?$/);
  });

  it('reminds only learning speakers to review a stale profile', async () => {
    const quiet = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spl-review-quiet' });
    const learner = await createUser(app, prisma, {
      role: 'SPEAKER',
      prefix: 'spl-review-learner',
    });
    const course = await createCourse(prisma);
    await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
    const old = new Date(Date.now() - 400 * DAY);
    await prisma.$executeRaw`UPDATE "Profile" SET "updatedAt" = ${old}, "reviewPromptSentAt" = NULL WHERE "userId" IN (${quiet.id}, ${learner.id})`;
    const send = jest.spyOn(app.get(EmailService), 'send');
    try {
      // Other tests leave stale profiles too: run until ours have been seen (100 per run).
      for (let i = 0; i < 20 && (await app.get(AccountJobs).runProfileReview()) > 0; i++);
      const sentTo = send.mock.calls.map((c) => c[0]);
      expect(sentTo).toContain(learner.email);
      expect(sentTo).not.toContain(quiet.email);
    } finally {
      send.mockRestore();
    }
  });
});
