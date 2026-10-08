import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ReminderJobs } from '../src/jobs/reminders.jobs';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const MIN = 60_000;

describe('learn (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const course = await createCourse(prisma, { type: 'PAID', price: 100 });
    await prisma.course.update({
      where: { id: course.id },
      data: { recordingsPlatform: 'GOOGLE_DRIVE', driveFolderUrl: 'https://drive.google.com/drive/folders/FOLDER' },
    });
    const now = Date.now();
    const [past, soon, later] = await Promise.all([
      prisma.courseSession.create({
        data: { courseId: course.id, order: 1, titleEn: 'Past', titleAr: 'ماضية', startsAt: new Date(now - 3 * 24 * 60 * MIN), durationMin: 90, liveUrl: 'https://meet.google.com/past-link', recordingUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
      prisma.courseSession.create({
        data: { courseId: course.id, order: 2, titleEn: 'Soon', titleAr: 'قريبة', startsAt: new Date(now + 30 * MIN), durationMin: 90, liveUrl: 'https://meet.google.com/soon-link' },
      }),
      prisma.courseSession.create({
        data: { courseId: course.id, order: 3, titleEn: 'Later', titleAr: 'لاحقة', startsAt: new Date(now + 23 * 60 * MIN), durationMin: 90, liveUrl: 'https://meet.google.com/later-link' },
      }),
    ]);
    const student = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    return { course, student, past, soon, later };
  }

  const slugOf = async (id: string) => (await prisma.course.findUniqueOrThrow({ where: { id } })).slug;

  it('only lets enrolled students in', async () => {
    const { course } = await setup();
    const slug = await slugOf(course.id);
    const outsider = await createUser(app, prisma);
    await http().get(`/api/learn/${slug}`).expect(401);
    expect((await http().get(`/api/learn/${slug}`).set('Cookie', outsider.cookie).expect(403)).body.code).toBe('NOT_ENROLLED');
    await http().get(`/api/learn/${slug}/calendar.ics`).set('Cookie', outsider.cookie).expect(403);
  });

  it('reveals live links only inside the window and parses recordings', async () => {
    const { course, student, past, soon, later } = await setup();
    const res = await http().get(`/api/learn/${await slugOf(course.id)}`).set('Cookie', student.cookie).expect(200);
    type S = { id: string; liveUrl: string | null; phase: string; recording: unknown };
    const byId = Object.fromEntries((res.body.sessions as S[]).map((s) => [s.id, s])) as Record<string, S>;
    expect(byId[soon.id]!.liveUrl).toBe('https://meet.google.com/soon-link');
    expect(byId[later.id]!.liveUrl).toBeNull();
    expect(byId[past.id]!.liveUrl).toBeNull();
    expect(byId[past.id]!.recording).toMatchObject({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' });
    expect(byId[past.id]!.phase).toBe('ended');
    expect(res.body.driveFolderUrl).toBe('https://drive.google.com/drive/folders/FOLDER');
    expect(res.body.googleEmail).toMatch(/^g\./);
    expect(JSON.stringify(res.body)).not.toContain('later-link');
  });

  it('tracks progress and feedback', async () => {
    const { course, student, past, later } = await setup();
    const slug = await slugOf(course.id);
    await http().put(`/api/learn/${slug}/sessions/${past.id}/progress`).set('Cookie', student.cookie).send({ completed: true }).expect(204);
    let res = await http().get(`/api/learn/${slug}`).set('Cookie', student.cookie).expect(200);
    expect(res.body.progress).toEqual({ completed: 1, total: 3, percent: 33 });
    await http().put(`/api/learn/${slug}/sessions/${past.id}/progress`).set('Cookie', student.cookie).send({ completed: false }).expect(204);

    expect((await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ sessionId: later.id, rating: 5 }).expect(403)).body.code).toBe('NOT_STARTED');
    await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ sessionId: past.id, rating: 4, comment: 'Great' }).expect(204);
    await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ sessionId: past.id, rating: 5 }).expect(204);
    // Course feedback opens at the last session.
    expect((await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ rating: 3 }).expect(403)).body.code).toBe('NOT_STARTED');
    // Move the whole course into the past so its last session has started.
    await prisma.courseSession.updateMany({ where: { courseId: course.id, id: { not: later.id } }, data: { startsAt: new Date(Date.now() - 2 * 24 * 60 * MIN) } });
    await prisma.courseSession.update({ where: { id: later.id }, data: { startsAt: new Date(Date.now() - 60 * MIN) } });
    // Double submit: still exactly one course-level row.
    await Promise.all([
      http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ rating: 2 }),
      http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ rating: 2 }),
    ]);
    await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ rating: 3, comment: 'Course end' }).expect(204);
    await http().put(`/api/learn/${slug}/feedback`).set('Cookie', student.cookie).send({ rating: 7 }).expect(400);
    expect(await prisma.sessionFeedback.count({ where: { userId: student.id, courseId: course.id } })).toBe(2);
    res = await http().get(`/api/learn/${slug}`).set('Cookie', student.cookie).expect(200);
    expect(res.body.courseFeedback).toEqual({ rating: 3, comment: 'Course end' });
  });

  it('exports calendars without live links', async () => {
    const { course, student, soon } = await setup();
    const slug = await slugOf(course.id);
    const all = await http().get(`/api/learn/${slug}/calendar.ics`).set('Cookie', student.cookie).expect(200);
    expect(all.headers['content-type']).toMatch(/text\/calendar/);
    expect(all.text.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(all.text).not.toContain('meet.google.com');
    const one = await http().get(`/api/learn/${slug}/sessions/${soon.id}/calendar.ics`).set('Cookie', student.cookie).expect(200);
    expect(one.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('sends each reminder once and respects opt-out', async () => {
    const { course, student, soon, later } = await setup();
    const slug = await slugOf(course.id);
    const other = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: other.id, courseId: course.id } });
    await http().put(`/api/learn/${slug}/reminders`).set('Cookie', other.cookie).send({ emailReminders: false }).expect(204);

    const jobs = app.get(ReminderJobs);
    await jobs.run();
    await jobs.run();
    const logs = await prisma.reminderLog.findMany({ where: { sessionId: { in: [soon.id, later.id] } } });
    expect(logs.filter((l) => l.userId === student.id).map((l) => l.kind).sort()).toEqual(['H1', 'H24']);
    expect(logs.filter((l) => l.userId === other.id)).toHaveLength(0);
  });

  it('lists the next sessions on the dashboard', async () => {
    const { student, soon } = await setup();
    const res = await http().get('/api/me/next-sessions').set('Cookie', student.cookie).expect(200);
    expect(res.body[0]).toMatchObject({ sessionId: soon.id, titleEn: 'Soon' });
    expect(JSON.stringify(res.body)).not.toContain('meet.google');
  });

  it('lets admins preview but not write as a student', async () => {
    const { course, past } = await setup();
    const slug = await slugOf(course.id);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const view = await http().get(`/api/learn/${slug}`).set('Cookie', admin.cookie).expect(200);
    expect(view.body.sessions.every((s: { liveUrl: string | null }) => s.liveUrl)).toBe(true);
    expect((await http().put(`/api/learn/${slug}/sessions/${past.id}/progress`).set('Cookie', admin.cookie).send({ completed: true }).expect(403)).body.code).toBe('NOT_ENROLLED');
    await http().put(`/api/learn/${slug}/feedback`).set('Cookie', admin.cookie).send({ sessionId: past.id, rating: 5 }).expect(403);
  });

  it('retries a reminder whose email failed', async () => {
    const { student, soon } = await setup();
    const { EmailService } = await import('../src/email/email.service');
    const email = app.get(EmailService);
    const spy = jest.spyOn(email, 'send').mockResolvedValue(false);
    const jobs = app.get(ReminderJobs);
    await jobs.run();
    expect(await prisma.reminderLog.count({ where: { sessionId: soon.id, userId: student.id } })).toBe(0);
    spy.mockRestore();
    await jobs.run();
    expect(await prisma.reminderLog.count({ where: { sessionId: soon.id, userId: student.id, kind: 'H1' } })).toBe(1);
  });
});
