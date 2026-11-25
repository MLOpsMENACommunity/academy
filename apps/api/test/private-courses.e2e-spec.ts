import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Courses visible to specific accounts only (Course.visibleToEmails). */
describe('private courses (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let ipCounter = 10;
  const ip = () => `198.51.100.${ipCounter++}`;

  let listed: { id: string; email: string; cookie: string };
  let other: { id: string; email: string; cookie: string };
  let course: { id: string; slug: string; questionId: string };
  let publicCourse: { id: string; slug: string; questionId: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    listed = await createUser(app, prisma, { prefix: 'private-listed' });
    other = await createUser(app, prisma, { prefix: 'private-other' });
    course = await createCourse(prisma, { type: 'PAID', price: 5000 });
    // Stored lower-cased; the account email matches whatever its case.
    await prisma.course.update({ where: { id: course.id }, data: { visibleToEmails: [listed.email.toLowerCase(), 'someone@example.com'] } });
    publicCourse = await createCourse(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  const slugsOf = (body: { slug: string }[]) => body.map((c) => c.slug);

  it('never lists a private course in the catalog or the slugs, for anyone', async () => {
    for (const cookie of [undefined, other.cookie, listed.cookie]) {
      const req = http().get('/api/courses').set('X-Forwarded-For', ip());
      const res = await (cookie ? req.set('Cookie', cookie) : req).expect(200);
      expect(slugsOf(res.body)).not.toContain(course.slug);
      expect(slugsOf(res.body)).toContain(publicCourse.slug);
    }
    const slugs = await http().get('/api/courses/slugs').set('X-Forwarded-For', ip()).expect(200);
    expect(slugsOf(slugs.body)).not.toContain(course.slug);
  });

  it('answers the course page with 404 for anonymous and non-listed accounts, the details for a listed one', async () => {
    const anon = await http().get(`/api/courses/${course.slug}`).set('X-Forwarded-For', ip()).expect(404);
    // A 404 that turns into the course after signing in is never kept by the browser.
    expect(anon.headers['cache-control']).toBe('no-store');
    await http().get(`/api/courses/${course.slug}`).set('Cookie', other.cookie).expect(404);
    const res = await http().get(`/api/courses/${course.slug}`).set('Cookie', listed.cookie).expect(200);
    expect(res.body).toMatchObject({ slug: course.slug, price: 5000, currency: 'EGP', type: 'PAID' });
    // Never kept by a browser, the edge or the public cache.
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['cache-control']).not.toMatch(/public|s-maxage/);
    // The audience is admin-only data.
    expect(JSON.stringify(res.body)).not.toContain('visibleToEmails');
    expect(JSON.stringify(res.body)).not.toContain('someone@example.com');
    // The public course is unchanged.
    await http().get(`/api/courses/${publicCourse.slug}`).set('X-Forwarded-For', ip()).expect(200);
  });

  it('hides it from an account that has not confirmed the listed email', async () => {
    const unverified = await createUser(app, prisma, { verified: false, prefix: 'private-unverified' });
    await prisma.course.update({ where: { id: course.id }, data: { visibleToEmails: { push: unverified.email } } });
    await http().get(`/api/courses/${course.slug}`).set('Cookie', unverified.cookie).expect(404);
  });

  it('GET /courses/:slug/private says only whether a private course lives there, uncached', async () => {
    const res = await http().get(`/api/courses/${course.slug}/private`).set('X-Forwarded-For', ip()).expect(200);
    expect(res.body).toEqual({ private: true });
    expect(res.headers['cache-control']).toBe('no-store');
    await http().get(`/api/courses/${publicCourse.slug}/private`).set('X-Forwarded-For', ip()).expect(404);
    await http().get('/api/courses/no-such-course/private').set('X-Forwarded-For', ip()).expect(404);
    // A draft private course doesn't exist publicly.
    const draft = await createCourse(prisma);
    await prisma.course.update({ where: { id: draft.id }, data: { status: 'DRAFT', visibleToEmails: [listed.email] } });
    await http().get(`/api/courses/${draft.slug}/private`).set('X-Forwarded-For', ip()).expect(404);
  });

  it('GET /me/private-courses lists the private courses shared with the account', async () => {
    const mine = await http().get('/api/me/private-courses').set('Cookie', listed.cookie).expect(200);
    expect(slugsOf(mine.body)).toEqual([course.slug]);
    expect(mine.body[0]).toMatchObject({ price: 5000, currency: 'EGP' });
    expect(JSON.stringify(mine.body)).not.toContain('visibleToEmails');
    expect(mine.headers['cache-control']).toBe('private, no-store');
    const theirs = await http().get('/api/me/private-courses').set('Cookie', other.cookie).expect(200);
    expect(theirs.body).toEqual([]);
    await http().get('/api/me/private-courses').set('X-Forwarded-For', ip()).expect(401);
  });

  it('refuses applying and the waiting list to non-listed accounts, and lets a listed one apply', async () => {
    const answers = { [course.questionId]: true };
    await http().post('/api/applications').set('Cookie', other.cookie).send({ courseSlug: course.slug, answers }).expect(404);
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', other.cookie).send({}).expect(404);
    expect(await prisma.application.count({ where: { courseId: course.id, userId: other.id } })).toBe(0);
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(0);

    const res = await http().post('/api/applications').set('Cookie', listed.cookie).send({ courseSlug: course.slug, answers }).expect(201);
    expect(res.body.status).toBeTruthy();
    expect(await prisma.application.count({ where: { courseId: course.id, userId: listed.id } })).toBe(1);
  });

  it('admins see the list and a Private flag; the staff editor sees only the flag', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN' });
    const list = await http().get('/api/admin/courses').set('Cookie', admin.cookie).expect(200);
    const row = (list.body as { id: string; private: boolean }[]).find((c) => c.id === course.id)!;
    expect(row.private).toBe(true);
    expect((list.body as { id: string; private: boolean }[]).find((c) => c.id === publicCourse.id)!.private).toBe(false);
    const one = await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).expect(200);
    expect(one.body.visibleToEmails).toContain(listed.email.toLowerCase());
    const staff = await http().get(`/api/teach/courses/${course.id}/details`).set('Cookie', admin.cookie).expect(200);
    expect(staff.body.visibleToEmails).toBeUndefined();
    expect(staff.body.private).toBe(true);
  });
});
