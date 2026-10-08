import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('applications (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  const apply = (cookie: string, courseSlug: string, answers: Record<string, unknown>, source?: Record<string, string>) =>
    http().post('/api/applications').set('Cookie', cookie).send({ courseSlug, answers, source });

  it('requires a verified email and a complete profile', async () => {
    const course = await createCourse(prisma);
    const unverified = await createUser(app, prisma, { verified: false });
    const incomplete = await createUser(app, prisma, { coreComplete: false });
    expect((await apply(unverified.cookie, course.slug, { [course.questionId]: true }).expect(403)).body.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await apply(incomplete.cookie, course.slug, { [course.questionId]: true }).expect(403)).body.code).toBe('PROFILE_INCOMPLETE');
  });

  it('validates answers against the course questions', async () => {
    const course = await createCourse(prisma);
    const s = await createUser(app, prisma);
    const res = await apply(s.cookie, course.slug, {}).expect(400);
    expect(res.body.errors[0].path).toBe(`answers.${course.questionId}`);
  });

  it('runs the paid flow: submit → shortlist → accept → awaiting payment, with history, notifications and audit', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 2500 });
    const student = await createUser(app, prisma);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });

    const res = await apply(student.cookie, course.slug, { [course.questionId]: true, injected: 'x' }, { ref: 'main-site', utm_source: 'li', bogus: 'y' }).expect(201);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.answers).toEqual({ [course.questionId]: true });
    expect(res.body.source).toEqual({ ref: 'main-site', utm_source: 'li' });
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.ref).toBe('main-site');
    expect((stored.profileSnapshot as { fullNameEn: string }).fullNameEn).toBe('Test Person');

    await apply(student.cookie, course.slug, { [course.questionId]: true }).expect(409);

    // Students can't move their own application.
    await http().post(`/api/admin/applications/${res.body.id}/transition`).set('Cookie', student.cookie).send({ event: 'SHORTLIST' }).expect(403);

    const t = (event: string) =>
      http().post(`/api/admin/applications/${res.body.id}/transition`).set('Cookie', admin.cookie).send({ event });
    expect((await t('SHORTLIST').expect(200)).body.status).toBe('SHORTLISTED');
    expect((await t('ACCEPT').expect(200)).body.status).toBe('AWAITING_PAYMENT');
    expect((await t('SHORTLIST').expect(409)).body.code).toBe('INVALID_TRANSITION');

    const mine = await http().get(`/api/me/applications/${res.body.id}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['SUBMITTED', 'SHORTLISTED', 'AWAITING_PAYMENT']);
    const notes = await prisma.notification.findMany({ where: { userId: student.id } });
    expect(notes.map((n) => n.type).sort()).toEqual(['application.awaiting_payment', 'application.shortlisted', 'application.submitted']);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'application.status_changed' } })).toBe(2);
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(0);

    // Other students can't read it.
    const other = await createUser(app, prisma);
    await http().get(`/api/me/applications/${res.body.id}`).set('Cookie', other.cookie).expect(404);
  });

  it('enrols instantly for a free course without approval and waitlists when full', async () => {
    const course = await createCourse(prisma, { requiresApproval: false, capacity: 1 });
    const a = await createUser(app, prisma);
    const b = await createUser(app, prisma);
    expect((await apply(a.cookie, course.slug, { [course.questionId]: true }).expect(201)).body.status).toBe('ENROLLED');
    expect((await apply(b.cookie, course.slug, { [course.questionId]: true }).expect(201)).body.status).toBe('WAITLISTED');
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(1);
    const view = await http().get(`/api/courses/${course.slug}`).expect(200);
    expect(view.body.seatsRemaining).toBe(0);
  });

  it('never oversells the last seat under concurrent applications', async () => {
    const course = await createCourse(prisma, { requiresApproval: false, capacity: 1 });
    const users = await Promise.all(Array.from({ length: 6 }, () => createUser(app, prisma)));
    const results = await Promise.all(users.map((u) => apply(u.cookie, course.slug, { [course.questionId]: true })));
    const statuses = results.map((r) => r.body.status).sort();
    expect(statuses.filter((s) => s === 'ENROLLED')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'WAITLISTED')).toHaveLength(5);
  });
});
