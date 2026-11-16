import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Star ratings: only finished students rate, and only approved ratings count (5 or more to show). */
describe('course ratings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const yesterday = () => new Date(Date.now() - 86_400_000);
  const nextWeek = () => new Date(Date.now() + 7 * 86_400_000);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** A live course, still running unless `ended`. */
  async function liveCourse(opts: { ended?: 'status' | 'date' } = {}) {
    const course = await createCourse(prisma);
    await prisma.course.update({
      where: { id: course.id },
      data: opts.ended === 'status' ? { status: 'COMPLETED' } : { endDate: opts.ended === 'date' ? yesterday() : nextWeek() },
    });
    return course;
  }

  async function student(courseId: string, name = 'Rita Rater') {
    const s = await createUser(app, prisma, { prefix: 'rater' });
    await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    await prisma.profile.update({ where: { userId: s.id }, data: { fullNameEn: name } });
    return s;
  }

  async function certify(userId: string, courseId: string) {
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId } } });
    await prisma.certificate.create({
      data: {
        enrollmentId: enrollment.id,
        serial: `MMA-2026-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        nameOnCertificate: 'Rita Rater',
        courseTitleEn: 'Test course',
        courseTitleAr: 'دورة تجريبية',
      },
    });
  }

  const rate = (slug: string, cookie: string, body: Record<string, unknown>) =>
    http().put(`/api/learn/${slug}/testimonial`).set('Cookie', cookie).send(body);
  const learn = async (slug: string, cookie: string) => (await http().get(`/api/learn/${slug}`).set('Cookie', cookie).expect(200)).body;
  const page = async (slug: string) => (await http().get(`/api/courses/${slug}`).expect(200)).body;
  const catalogRating = async (slug: string) =>
    ((await http().get('/api/courses').expect(200)).body as { slug: string; rating: unknown }[]).find((c) => c.slug === slug)?.rating;

  const academic = () => createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'ratings-academic' });
  const approve = (courseId: string, id: string, cookie: string, status: 'APPROVED' | 'REJECTED' = 'APPROVED') =>
    http().put(`/api/admin/courses/${courseId}/testimonials/${id}/review`).set('Cookie', cookie).send({ status }).expect(204);

  it('waits until the student has finished the course', async () => {
    const course = await liveCourse();
    const s = await student(course.id);
    expect((await learn(course.slug, s.cookie)).canReview).toBe(false);
    const res = await rate(course.slug, s.cookie, { rating: 5, consent: true }).expect(409);
    expect(res.body.code).toBe('REVIEW_NOT_FINISHED');
    // Not enrolled at all.
    const outsider = await createUser(app, prisma);
    await rate(course.slug, outsider.cookie, { rating: 5, consent: true }).expect(403);
  });

  it('opens with a certificate, or once the course is over', async () => {
    const running = await liveCourse();
    const certified = await student(running.id);
    await certify(certified.id, running.id);
    expect((await learn(running.slug, certified.cookie)).canReview).toBe(true);
    await rate(running.slug, certified.cookie, { rating: 4, consent: true }).expect(204);
    expect((await learn(running.slug, certified.cookie)).testimonial).toEqual({ body: '', rating: 4, status: 'PENDING' });

    // A revoked certificate doesn't count.
    const revoked = await student(running.id);
    await certify(revoked.id, running.id);
    await prisma.certificate.updateMany({ where: { enrollment: { userId: revoked.id } }, data: { revokedAt: new Date() } });
    await rate(running.slug, revoked.cookie, { rating: 4, consent: true }).expect(409);

    for (const ended of ['status', 'date'] as const) {
      const c = await liveCourse({ ended });
      const s = await student(c.id);
      expect((await learn(c.slug, s.cookie)).canReview).toBe(true);
      await rate(c.slug, s.cookie, { rating: 3, body: 'Clear explanations and useful labs every week.', consent: true }).expect(204);
    }
  });

  it('validates the rating and keeps consent required', async () => {
    const course = await liveCourse({ ended: 'status' });
    const s = await student(course.id);
    await rate(course.slug, s.cookie, { rating: 6, consent: true }).expect(400);
    await rate(course.slug, s.cookie, { rating: 0, consent: true }).expect(400);
    await rate(course.slug, s.cookie, { consent: true }).expect(400);
    await rate(course.slug, s.cookie, { rating: 5, consent: false }).expect(400);
    await rate(course.slug, s.cookie, { rating: 5, body: 'too short', consent: true }).expect(400);
  });

  it('counts approved ratings only, and shows the average from 5', async () => {
    const course = await liveCourse({ ended: 'status' });
    const a = await academic();
    const stars = [5, 4, 4, 5, 4, 1];
    const ids: string[] = [];
    for (const [i, rating] of stars.entries()) {
      const s = await student(course.id, `Rater ${i}`);
      await rate(course.slug, s.cookie, { rating, ...(i === 0 ? { body: 'The best MLOps course I have taken so far.' } : {}), consent: true }).expect(204);
      ids.push((await prisma.testimonial.findFirstOrThrow({ where: { userId: s.id } })).id);
    }
    // Private course feedback never counts.
    const fb = await student(course.id);
    await prisma.sessionFeedback.create({ data: { userId: fb.id, courseId: course.id, rating: 1 } });

    // Pending ratings never count.
    expect((await page(course.slug)).rating).toBeNull();

    for (const id of ids.slice(0, 4)) await approve(course.id, id, a.cookie);
    expect((await page(course.slug)).rating).toBeNull();
    expect(await catalogRating(course.slug)).toBeNull();

    // The fifth: 5+4+4+5+4 = 22 / 5 = 4.4.
    await approve(course.id, ids[4]!, a.cookie);
    expect((await page(course.slug)).rating).toEqual({ average: 4.4, count: 5 });
    expect(await catalogRating(course.slug)).toEqual({ average: 4.4, count: 5 });

    // Rejected doesn't count.
    await approve(course.id, ids[5]!, a.cookie, 'REJECTED');
    expect((await page(course.slug)).rating).toEqual({ average: 4.4, count: 5 });

    // One decimal: a sixth approved 5 → 27 / 6 = 4.5.
    const sixth = await student(course.id, 'Rater six');
    await rate(course.slug, sixth.cookie, { rating: 5, consent: true }).expect(204);
    await approve(course.id, (await prisma.testimonial.findFirstOrThrow({ where: { userId: sixth.id } })).id, a.cookie);
    expect((await page(course.slug)).rating).toEqual({ average: 4.5, count: 6 });

    // The list shows reviews with words (with their stars); stars-only reviews only count.
    expect((await page(course.slug)).testimonials).toEqual([
      expect.objectContaining({ name: 'Rater 0', rating: 5, body: 'The best MLOps course I have taken so far.' }),
    ]);

    // Every review is in the audit log.
    expect(await prisma.auditLog.count({ where: { action: 'testimonial.reviewed', entityId: ids[4]! } })).toBe(1);
  });

  it('puts every course in the admin queue, for the academic preset only', async () => {
    const course = await liveCourse({ ended: 'status' });
    const s = await student(course.id, 'Queue Person');
    await rate(course.slug, s.cookie, { rating: 2, consent: true }).expect(204);
    const id = (await prisma.testimonial.findFirstOrThrow({ where: { userId: s.id } })).id;

    for (const p of ['CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const) {
      const other = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: [p], prefix: `ratings-${p.toLowerCase()}` });
      const res = await http().get('/api/admin/reviews').set('Cookie', other.cookie).expect(403);
      expect(res.body.code).toBe('ADMIN_PERMISSION');
      await http().put(`/api/admin/courses/${course.id}/testimonials/${id}/review`).set('Cookie', other.cookie).send({ status: 'APPROVED' }).expect(403);
    }
    await http().get('/api/admin/reviews').set('Cookie', s.cookie).expect(403);

    const a = await academic();
    const pending = (await http().get('/api/admin/reviews').set('Cookie', a.cookie).expect(200)).body;
    expect(pending).toContainEqual(
      expect.objectContaining({ id, rating: 2, status: 'PENDING', name: 'Queue Person', courseId: course.id, courseSlug: course.slug, courseTitleEn: 'Test course' }),
    );
    await http().get('/api/admin/reviews?status=NOPE').set('Cookie', a.cookie).expect(400);

    await approve(course.id, id, a.cookie);
    expect(await prisma.auditLog.count({ where: { action: 'testimonial.reviewed', entityId: id, actorId: a.id } })).toBe(1);
    const approved = (await http().get('/api/admin/reviews?status=APPROVED').set('Cookie', a.cookie).expect(200)).body;
    expect(approved.map((r: { id: string }) => r.id)).toContain(id);
    const stillPending = (await http().get('/api/admin/reviews').set('Cookie', a.cookie).expect(200)).body;
    expect(stillPending.map((r: { id: string }) => r.id)).not.toContain(id);

    // Editing an approved review sends it back to the queue.
    await rate(course.slug, s.cookie, { rating: 3, consent: true }).expect(204);
    expect((await learn(course.slug, s.cookie)).testimonial).toEqual({ body: '', rating: 3, status: 'PENDING' });
  });
});
