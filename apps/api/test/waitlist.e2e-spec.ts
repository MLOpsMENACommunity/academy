import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AnnouncementDelivery } from '../src/announcements/announcement-delivery.service';
import { WaitlistLinks } from '../src/announcements/waitlist-links';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

describe('waiting list (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let links: WaitlistLinks;
  let sendSpy: jest.SpyInstance;
  const http = () => request(app.getHttpServer());
  /** Visitors are rate-limited per IP: give each test its own address. */
  let ipCounter = 10;
  const ip = () => `203.0.113.${ipCounter++}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    links = app.get(WaitlistLinks);
    sendSpy = jest.spyOn(app.get(EmailService), 'send');
  });
  afterAll(async () => {
    sendSpy.mockRestore();
    await app.close();
  });
  beforeEach(() => sendSpy.mockClear());

  async function comingSoon() {
    const course = await createCourse(prisma);
    await prisma.course.update({ where: { id: course.id }, data: { status: 'COMING_SOON' } });
    return course;
  }
  const templates = () => sendSpy.mock.calls.map((c) => (c[2] as { name: string }).name);

  it('lets a visitor join with an email; joining twice keeps one row and sends one confirmation', async () => {
    const course = await comingSoon();
    const email = uniqueEmail('wl');
    const from = ip();
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', from).send({ email, locale: 'ar' }).expect(200, { joined: true });
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', from).send({ email: email.toUpperCase() }).expect(200, { joined: true });

    const rows = await prisma.courseInterest.findMany({ where: { courseId: course.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email, userId: null, locale: 'ar', notifiedAt: null });
    expect(templates()).toEqual(['waitlistJoined']);
    expect(sendSpy.mock.calls[0]![0]).toBe(email);
    expect(sendSpy.mock.calls[0]![3]).toEqual({ bulk: true });
  });

  it('needs an email from visitors and validates it', async () => {
    const course = await comingSoon();
    const res = await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({}).expect(400);
    expect(res.body.code).toBe('EMAIL_REQUIRED');
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({ email: 'not-an-email' }).expect(400);
    await http().post('/api/courses/no-such-course/interest').set('X-Forwarded-For', ip()).send({ email: uniqueEmail() }).expect(404);
  });

  it('joins a signed-in student in one click with their account email, and lets them leave', async () => {
    const course = await comingSoon();
    const student = await createUser(app, prisma);
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    const status = await http().get(`/api/courses/${course.slug}/my-status`).set('Cookie', student.cookie).expect(200);
    expect(status.body.interested).toBe(true);
    const row = await prisma.courseInterest.findFirstOrThrow({ where: { courseId: course.id } });
    expect(row).toMatchObject({ email: student.email, userId: student.id });

    await http().delete(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).expect(204);
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(0);
    const after = await http().get(`/api/courses/${course.slug}/my-status`).set('Cookie', student.cookie).expect(200);
    expect(after.body.interested).toBe(false);
  });

  it('leaves through the signed link in the email; a GET alone changes nothing, and forged links fail', async () => {
    const course = await comingSoon();
    const email = uniqueEmail('wl');
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({ email }).expect(200);
    const row = await prisma.courseInterest.findFirstOrThrow({ where: { courseId: course.id, email } });
    const token = links.token(row.id);
    // The confirmation email carries this link.
    const sent = sendSpy.mock.calls.find((c) => (c[2] as { name: string }).name === 'waitlistJoined')!;
    expect((sent[2] as { leaveUrl: string }).leaveUrl).toContain(encodeURIComponent(token));

    const peek = await http().get(`/api/waitlist/leave?token=${encodeURIComponent(token)}`).expect(200);
    expect(peek.body).toMatchObject({ left: false, course: { slug: course.slug } });
    expect(await prisma.courseInterest.count({ where: { id: row.id } })).toBe(1);

    const forged = `${row.id}.${'A'.repeat(43)}`;
    await http().post('/api/waitlist/leave').send({ token: forged }).expect(400);
    await http().post('/api/waitlist/leave').send({ token: 'garbage' }).expect(400);
    expect(await prisma.courseInterest.count({ where: { id: row.id } })).toBe(1);

    const res = await http().post('/api/waitlist/leave').send({ token }).expect(200);
    expect(res.body).toMatchObject({ left: true, course: { slug: course.slug } });
    expect(await prisma.courseInterest.count({ where: { id: row.id } })).toBe(0);
    // Twice is fine.
    await http().post('/api/waitlist/leave').send({ token }).expect(200, { left: true, course: null });
  });

  it('sends one confirmation per address per day, however many courses it is signed up for', async () => {
    const [a, b] = [await comingSoon(), await comingSoon()];
    const email = uniqueEmail('flood');
    await http().post(`/api/courses/${a.slug}/interest`).set('X-Forwarded-For', ip()).send({ email }).expect(200);
    await http().post(`/api/courses/${b.slug}/interest`).set('X-Forwarded-For', ip()).send({ email }).expect(200);
    expect(await prisma.courseInterest.count({ where: { email } })).toBe(2);
    expect(templates()).toEqual(['waitlistJoined']);
  });

  it('ignores bots that fill in the honeypot (no row, no email)', async () => {
    const course = await comingSoon();
    const email = uniqueEmail('bot');
    await http()
      .post(`/api/courses/${course.slug}/interest`)
      .set('X-Forwarded-For', ip())
      .send({ email, website: 'http://spam.example' })
      .expect(200, { joined: true });
    expect(await prisma.courseInterest.count({ where: { email } })).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rate-limits joins from one address', async () => {
    const course = await comingSoon();
    const from = ip();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', from).send({ email: uniqueEmail('rl') });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.at(-1)).toBe(429);
  });

  it('shows admins the list, exports it as CSV and notifies everyone once, setting notifiedAt', async () => {
    const course = await comingSoon();
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const visitor = uniqueEmail('wl');
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({ email: visitor }).expect(200);
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);

    // Students can't see it.
    await http().get(`/api/admin/courses/${course.id}/waitlist`).set('Cookie', student.cookie).expect(403);

    const list = await http().get(`/api/admin/courses/${course.id}/waitlist`).set('Cookie', admin.cookie).expect(200);
    expect(list.body).toMatchObject({ count: 2, waiting: 2, notified: 0, sending: 0 });
    expect(list.body.entries.map((e: { email: string }) => e.email).sort()).toEqual([student.email, visitor].sort());

    const csv = await http().get(`/api/admin/courses/${course.id}/waitlist/export.csv`).set('Cookie', admin.cookie).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('waiting-list-');
    expect(csv.text).toContain('"Email"');
    expect(csv.text).toContain(visitor);
    expect(csv.text).toContain(student.email);

    // Not while the course is still closed: people would land on a page where they can't apply.
    const early = await http()
      .post(`/api/admin/courses/${course.id}/waitlist/notify`)
      .set('Cookie', admin.cookie)
      .send({ subjectEn: 'Open', bodyEn: 'Apply now.', idempotencyKey: `wl-early-${Date.now()}-abcdef` })
      .expect(400);
    expect(early.body.code).toBe('COURSE_NOT_OPEN');

    await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN' } });
    sendSpy.mockClear();
    const key = `wl-notify-${Date.now()}-abcdef`;
    const body = { subjectEn: 'Applications are open', bodyEn: 'Apply now.', idempotencyKey: key };
    const sent = await http().post(`/api/admin/courses/${course.id}/waitlist/notify`).set('Cookie', admin.cookie).send(body).expect(201);
    expect(sent.body.recipients).toBe(2);
    // Same key again (a retried request): no second announcement.
    const again = await http().post(`/api/admin/courses/${course.id}/waitlist/notify`).set('Cookie', admin.cookie).send(body).expect(201);
    expect(again.body.id).toBe(sent.body.id);

    await app.get(AnnouncementDelivery).process();
    const rows = await prisma.courseInterest.findMany({ where: { courseId: course.id } });
    expect(rows.every((r) => r.notifiedAt && r.deliveryStatus === 'SENT')).toBe(true);
    const openEmails = sendSpy.mock.calls.filter((c) => (c[2] as { name: string }).name === 'waitlistOpen');
    expect(openEmails.map((c) => c[0]).sort()).toEqual([student.email, visitor].sort());
    expect(openEmails.every((c) => (c[2] as { leaveUrl: string }).leaveUrl.includes('/waitlist/leave?token='))).toBe(true);
    // The student also gets an in-app notification.
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'course.waitlist' } })).toBe(1);

    // Nobody left to tell: a new message is refused rather than re-sent.
    const none = await http()
      .post(`/api/admin/courses/${course.id}/waitlist/notify`)
      .set('Cookie', admin.cookie)
      .send({ ...body, idempotencyKey: `wl-notify-${Date.now()}-second` })
      .expect(400);
    expect(none.body.code).toBe('NO_RECIPIENTS');

    const history = await http().get(`/api/admin/courses/${course.id}/announcements`).set('Cookie', admin.cookie).expect(200);
    expect(history.body[0]).toMatchObject({ statuses: ['WAITLIST'], recipients: 2, sent: 2, pending: 0 });

    const entry = rows[0]!;
    await http().delete(`/api/admin/courses/${course.id}/waitlist/${entry.id}`).set('Cookie', admin.cookie).expect(204);
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(1);
  });

  it('includes waiting lists in the data export and removes them when the account is deleted', async () => {
    const course = await comingSoon();
    const student = await createUser(app, prisma);
    await prisma.user.update({ where: { id: student.id }, data: { passwordHash: null, googleId: `g-${student.id}` } });
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);

    const exported = await http().get('/api/me/export').set('Cookie', student.cookie).expect(200);
    expect(exported.body.waitingLists).toEqual([expect.objectContaining({ email: student.email, course: expect.objectContaining({ slug: course.slug }) })]);

    await prisma.courseInterest.deleteMany({ where: { email: student.email } });
    await prisma.courseInterest.create({ data: { courseId: course.id, email: student.email } });
    const { AccountService } = await import('../src/users/account.service');
    await app.get(AccountService).deleteAccount({ id: student.id, role: 'STUDENT', amr: 'google', authTime: new Date() }, undefined);
    expect(await prisma.courseInterest.count({ where: { email: student.email } })).toBe(0);
  });
});
