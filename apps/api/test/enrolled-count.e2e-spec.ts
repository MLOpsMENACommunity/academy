import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PublicRevalidator } from '../src/common/revalidate';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/**
 * Course pages show "N students enrolled" and "X seats left": public numbers only (never who),
 * hidden per course by the admin, deleted accounts never counted, and every enrolment or
 * withdrawal asks the site to revalidate so the pages are current within seconds.
 */
describe('public enrolled count and seats left (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let site: Server;
  let revalidator: PublicRevalidator;
  const saved = { url: process.env.REVALIDATE_URL, token: process.env.REVALIDATE_TOKEN };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // Stands in for the site's revalidation endpoint.
    site = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    process.env.REVALIDATE_URL = `http://127.0.0.1:${(site.address() as AddressInfo).port}/_internal/revalidate`;
    process.env.REVALIDATE_TOKEN = 'e2e-enrolled-count-token-0123456789-abcdef';
    ({ app, prisma } = await createTestApp());
    revalidator = app.get(PublicRevalidator);
  });
  afterAll(async () => {
    await revalidator.settle();
    await app.close();
    await new Promise((r) => site.close(r));
    for (const [k, v] of [['REVALIDATE_URL', saved.url], ['REVALIDATE_TOKEN', saved.token]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const apply = (cookie: string, course: { slug: string; questionId: string }) =>
    http().post('/api/applications').set('Cookie', cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } });
  const view = async (slug: string) => (await http().get(`/api/courses/${slug}`).expect(200)).body as { enrolledCount: number | null; seatsLeft: number | null };
  const card = async (slug: string) => ((await http().get('/api/courses').expect(200)).body as { slug: string; enrolledCount: number | null; seatsLeft: number | null }[]).find((c) => c.slug === slug)!;
  /** Whether a revalidation call went out (or is scheduled) since `before`. */
  const revalidatedSince = async (before: number) => {
    await revalidator.settle();
    return revalidator.sent > before;
  };

  it('counts enrolments and seats left, in the course page and the catalog, and refreshes the site on each enrolment', async () => {
    const course = await createCourse(prisma, { requiresApproval: false, capacity: 3 });
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 0, seatsLeft: 3 });

    const a = await createUser(app, prisma, { prefix: 'enc-a' });
    const b = await createUser(app, prisma, { prefix: 'enc-b' });
    await revalidator.settle();
    const before = revalidator.sent;
    // Instant enrolment (free, no approval): a student's own request, not an admin's.
    expect((await apply(a.cookie, course).expect(201)).body.status).toBe('ENROLLED');
    expect(await revalidatedSince(before)).toBe(true);
    await apply(b.cookie, course).expect(201);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 2, seatsLeft: 1 });
    expect(await card(course.slug)).toMatchObject({ enrolledCount: 2, seatsLeft: 1 });

    // Only numbers: no names, emails or ids of students in the public answer.
    const raw = JSON.stringify((await http().get(`/api/courses/${course.slug}`)).body);
    for (const u of [a, b]) {
      expect(raw).not.toContain(u.email);
      expect(raw).not.toContain(u.id);
    }

    // Full: 0 seats left (the page says "Course full"); a third student joins the waitlist.
    const c = await createUser(app, prisma, { prefix: 'enc-c' });
    await apply(c.cookie, course).expect(201);
    const d = await createUser(app, prisma, { prefix: 'enc-d' });
    expect((await apply(d.cookie, course).expect(201)).body.status).toBe('WAITLISTED');
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 3, seatsLeft: 0 });

    // Seats left only while applications are open.
    await prisma.course.update({ where: { id: course.id }, data: { applicationDeadline: new Date(Date.now() - 60_000) } });
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 3, seatsLeft: null });
  });

  it('returns null for the count when the admin turns it off (seats left still show)', async () => {
    const course = await createCourse(prisma, { requiresApproval: false, capacity: 10 });
    const s = await createUser(app, prisma, { prefix: 'enc-hide' });
    await apply(s.cookie, course).expect(201);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 1, seatsLeft: 9 });

    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'enc-admin' });
    const original = (await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).expect(200)).body;
    // On by default.
    expect(original.showEnrolledCount).toBe(true);
    // Saved through the admin editor (the test course is too bare for the full form's checks:
    // the Playwright test unticks it in the real editor).
    const { id: _id, questions: _q, sessions: _s, instructors: _i, createdAt: _c, updatedAt: _u, archivedAt: _a, ...rest } = original;
    const form = { ...rest, shortDescriptionEn: 'A course for the enrolled-count test.', shortDescriptionAr: 'دورة لاختبار عدد الطلاب المسجلين.', showEnrolledCount: false };
    const saved = await http().put(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).send(form);
    expect(saved.status).toBe(200);
    expect((await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).expect(200)).body.showEnrolledCount).toBe(false);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: null, seatsLeft: 9 });
    expect((await card(course.slug)).enrolledCount).toBeNull();
  });

  it('does not count deleted accounts, and refreshes the site when an enrolled student deletes their account', async () => {
    const course = await createCourse(prisma, { requiresApproval: false, capacity: 5 });
    const stays = await createUser(app, prisma, { prefix: 'enc-stays' });
    const leaves = await createUser(app, prisma, { prefix: 'enc-leaves' });
    await apply(stays.cookie, course).expect(201);
    await apply(leaves.cookie, course).expect(201);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 2, seatsLeft: 3 });

    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'enc-admin2' });
    await revalidator.settle();
    const before = revalidator.sent;
    await http().post(`/api/admin/students/${leaves.id}/delete`).set('Cookie', admin.cookie).send({ confirm: leaves.email }).expect(200);
    expect(await revalidatedSince(before)).toBe(true);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 1, seatsLeft: 4 });
    // The enrolment row itself stays (certificates, anonymisation later): it just isn't counted.
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(2);
  });

  it('gives the seat back when a student withdraws, and refreshes the site', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 500, capacity: 2 });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'enc-admin3' });
    const s = await createUser(app, prisma, { prefix: 'enc-withdraw' });
    const appl = (await apply(s.cookie, course).expect(201)).body;
    await http().post(`/api/admin/applications/${appl.id}/transition`).set('Cookie', admin.cookie).send({ event: 'ACCEPT' }).expect(200);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 0, seatsLeft: 1 });

    await revalidator.settle();
    const before = revalidator.sent;
    await http().post(`/api/me/applications/${appl.id}/withdraw`).set('Cookie', s.cookie).expect(200);
    expect(await revalidatedSince(before)).toBe(true);
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 0, seatsLeft: 2 });
  });

  it('counts a student enrolled by email by the course team', async () => {
    const course = await createCourse(prisma, { capacity: 4 });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'enc-admin4' });
    const s = await createUser(app, prisma, { prefix: 'enc-invited' });
    await http()
      .post(`/api/admin/courses/${course.id}/invites`)
      .set('Cookie', admin.cookie)
      .send({ entries: [{ email: s.email }], sendEmail: false, locale: 'en' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(await view(course.slug)).toMatchObject({ enrolledCount: 1, seatsLeft: 3 });
  });
});
