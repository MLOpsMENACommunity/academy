import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AnnouncementDelivery } from '../src/announcements/announcement-delivery.service';
import { WaitlistLinks } from '../src/announcements/waitlist-links';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/email/email.service';
import { randomToken, sha256 } from '../src/common/crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

describe('waiting list (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let links: WaitlistLinks;
  let sendSpy: jest.SpyInstance;
  const http = () => request(app.getHttpServer());
  /** Requests without a session are rate-limited per IP: give each one its own address. */
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

  /** An entry from before the waiting list needed an account (no userId). */
  const guestEntry = (courseId: string, email: string, locale: 'en' | 'ar' = 'en') =>
    prisma.courseInterest.create({ data: { courseId, email, locale } });

  it('refuses visitors without an account: no row, no email', async () => {
    const course = await comingSoon();
    const email = uniqueEmail('wl');
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({ email, locale: 'ar' }).expect(401);
    await http().post(`/api/courses/${course.slug}/interest`).set('X-Forwarded-For', ip()).send({}).expect(401);
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses an account whose email is not confirmed yet, like applying', async () => {
    const course = await comingSoon();
    const student = await createUser(app, prisma, { verified: false });
    const res = await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(0);
  });

  it('joins a verified student in one click with their account email (never an email from the body), and lets them leave', async () => {
    const course = await comingSoon();
    const student = await createUser(app, prisma);
    const other = uniqueEmail('other');
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({ email: other, locale: 'ar' }).expect(200, { joined: true });
    // Twice is fine: one row, one confirmation.
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    const status = await http().get(`/api/courses/${course.slug}/my-status`).set('Cookie', student.cookie).expect(200);
    expect(status.body.interested).toBe(true);
    const rows = await prisma.courseInterest.findMany({ where: { courseId: course.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: student.email, userId: student.id, locale: 'ar' });
    expect(await prisma.courseInterest.count({ where: { email: other } })).toBe(0);
    expect(templates()).toEqual(['waitlistJoined']);
    expect(sendSpy.mock.calls[0]![0]).toBe(student.email);
    expect(sendSpy.mock.calls[0]![3]).toEqual({ bulk: true });

    await http().delete(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).expect(204);
    expect(await prisma.courseInterest.count({ where: { courseId: course.id } })).toBe(0);
    const after = await http().get(`/api/courses/${course.slug}/my-status`).set('Cookie', student.cookie).expect(200);
    expect(after.body.interested).toBe(false);
    await http().post('/api/courses/no-such-course/interest').set('Cookie', student.cookie).send({}).expect(404);
  });

  it('leaves through the signed link in the email; a GET alone changes nothing, and forged links fail', async () => {
    const course = await comingSoon();
    const student = await createUser(app, prisma);
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    const row = await prisma.courseInterest.findFirstOrThrow({ where: { courseId: course.id, email: student.email } });
    const token = links.token(row.id);
    // The confirmation email carries this link.
    const sent = sendSpy.mock.calls.find((c) => (c[2] as { name: string }).name === 'waitlistJoined')!;
    expect((sent[2] as { leaveUrl: string }).leaveUrl).toContain(encodeURIComponent(token));

    // No session needed: the link works from any mail client.
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

  it('still lets a guest entry (no account) leave by its link', async () => {
    const course = await comingSoon();
    const row = await guestEntry(course.id, uniqueEmail('guest'));
    await http().post('/api/waitlist/leave').send({ token: links.token(row.id) }).expect(200);
    expect(await prisma.courseInterest.count({ where: { id: row.id } })).toBe(0);
  });

  it('sends one confirmation per address per day, however many courses it joins', async () => {
    const [a, b] = [await comingSoon(), await comingSoon()];
    const student = await createUser(app, prisma);
    await http().post(`/api/courses/${a.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    await http().post(`/api/courses/${b.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    expect(await prisma.courseInterest.count({ where: { email: student.email } })).toBe(2);
    expect(templates()).toEqual(['waitlistJoined']);
  });

  it('rate-limits joins from one account', async () => {
    const student = await createUser(app, prisma);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const course = await comingSoon();
      const r = await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({});
      codes.push(r.status);
    }
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.at(-1)).toBe(429);
  });

  it('links a guest entry to the account that confirms the same address', async () => {
    const [a, b] = [await comingSoon(), await comingSoon()];
    const student = await createUser(app, prisma, { verified: false });
    // Guest entries were stored lower-cased; one for this address and one for someone else.
    const mine = await guestEntry(a.id, student.email);
    const theirs = await guestEntry(b.id, uniqueEmail('someone'));

    // Signing in before confirming proves nothing: not linked yet.
    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: mine.id } })).userId).toBeNull();

    const token = randomToken();
    await prisma.emailVerificationToken.create({
      data: { userId: student.id, email: student.email, tokenHash: sha256(token), returnTo: `/en/courses/${a.slug}/notify`, expiresAt: new Date(Date.now() + 60_000) },
    });
    const res = await http().post('/api/auth/verify-email').set('Cookie', student.cookie).send({ token }).expect(200);
    expect(res.body.returnTo).toBe(`/en/courses/${a.slug}/notify`);

    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: mine.id } })).userId).toBe(student.id);
    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: theirs.id } })).userId).toBeNull();
    const status = await http().get(`/api/courses/${a.slug}/my-status`).set('Cookie', student.cookie).expect(200);
    expect(status.body.interested).toBe(true);
    // Joining again from the account keeps the one row.
    await http().post(`/api/courses/${a.slug}/interest`).set('Cookie', student.cookie).send({}).expect(200);
    expect(await prisma.courseInterest.count({ where: { courseId: a.id } })).toBe(1);
  });

  it('links guest entries when a verified account signs in, never for an unconfirmed one', async () => {
    const course = await comingSoon();
    const password = 'waitlist-e2e-password';
    const hash = await app.get(AuthService).hashPassword(password);
    const verified = await createUser(app, prisma);
    const pending = await createUser(app, prisma, { verified: false });
    await prisma.user.updateMany({ where: { id: { in: [verified.id, pending.id] } }, data: { passwordHash: hash } });
    const [v, p] = [await guestEntry(course.id, verified.email), await guestEntry(course.id, pending.email)];

    for (const u of [verified, pending]) {
      await http().post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email: u.email, password }).expect(200);
    }
    // Claiming at sign-in is not awaited by the request.
    for (let i = 0; i < 20 && !(await prisma.courseInterest.findUniqueOrThrow({ where: { id: v.id } })).userId; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: v.id } })).userId).toBe(verified.id);
    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: p.id } })).userId).toBeNull();
    // An unconfirmed account can neither see nor remove an entry for its address.
    const status = await http().get(`/api/courses/${course.slug}/my-status`).set('Cookie', pending.cookie).expect(200);
    expect(status.body.interested).toBe(false);
    await http().delete(`/api/courses/${course.slug}/interest`).set('Cookie', pending.cookie).expect(204);
    expect(await prisma.courseInterest.count({ where: { id: p.id } })).toBe(1);
  });

  it('gives a guest entry whose address has a verified account the usual email and notification', async () => {
    const course = await comingSoon();
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const row = await guestEntry(course.id, student.email);
    await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN' } });
    sendSpy.mockClear();
    await http()
      .post(`/api/admin/courses/${course.id}/waitlist/notify`)
      .set('Cookie', admin.cookie)
      .send({ subjectEn: 'Open', bodyEn: 'Apply now.', idempotencyKey: `wl-linked-${Date.now()}-abcdef` })
      .expect(201);
    await app.get(AnnouncementDelivery).process();
    expect((await prisma.courseInterest.findUniqueOrThrow({ where: { id: row.id } })).userId).toBe(student.id);
    expect(sendSpy.mock.calls.find((c) => c[0] === student.email)![2]).toMatchObject({ name: 'waitlistOpen' });
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'course.waitlist' } })).toBe(1);
  });

  it('sends guests a "create your account to apply" email and students the usual one', async () => {
    const course = await comingSoon();
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const guest = uniqueEmail('guest');
    await guestEntry(course.id, guest, 'ar');
    await http().post(`/api/courses/${course.slug}/interest`).set('Cookie', student.cookie).send({ locale: 'en' }).expect(200);

    const list = await http().get(`/api/admin/courses/${course.id}/waitlist`).set('Cookie', admin.cookie).expect(200);
    const byEmail = Object.fromEntries(list.body.entries.map((e: { email: string; student: boolean }) => [e.email, e.student]));
    expect(byEmail).toEqual({ [guest]: false, [student.email]: true });

    await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN' } });
    sendSpy.mockClear();
    const body = { subjectEn: 'Applications are open', bodyEn: 'Apply now.', idempotencyKey: `wl-guest-${Date.now()}-abcdef` };
    await http().post(`/api/admin/courses/${course.id}/waitlist/notify`).set('Cookie', admin.cookie).send(body).expect(201);
    await app.get(AnnouncementDelivery).process();

    const mails = sendSpy.mock.calls.filter((c) => (c[2] as { name: string }).name.startsWith('waitlistOpen'));
    const toGuest = mails.find((c) => c[0] === guest)!;
    const toStudent = mails.find((c) => c[0] === student.email)!;
    expect(toGuest[2]).toMatchObject({
      name: 'waitlistOpenGuest',
      hasAccount: false,
      // Sign-up, back to the course; the address only in the fragment (prefills the form, stays out of logs).
      url: expect.stringContaining(`/ar/register?returnTo=${encodeURIComponent(`/ar/courses/${course.slug}`)}#email=${encodeURIComponent(guest)}`),
      leaveUrl: expect.stringContaining('/waitlist/leave?token='),
    });
    expect(toStudent[2]).toMatchObject({ name: 'waitlistOpen', url: expect.stringContaining(`/en/courses/${course.slug}`) });
    // Only accounts get the in-app notification.
    expect(await prisma.notification.count({ where: { userId: student.id, type: 'course.waitlist' } })).toBe(1);
    expect((await prisma.courseInterest.findMany({ where: { courseId: course.id } })).every((r) => r.deliveryStatus === 'SENT')).toBe(true);
  });

  it('sends a guest whose address has an unconfirmed account to sign in instead', async () => {
    const course = await comingSoon();
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const pending = await createUser(app, prisma, { verified: false });
    await guestEntry(course.id, pending.email);
    await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN' } });
    sendSpy.mockClear();
    await http()
      .post(`/api/admin/courses/${course.id}/waitlist/notify`)
      .set('Cookie', admin.cookie)
      .send({ subjectEn: 'Open', bodyEn: 'Apply now.', idempotencyKey: `wl-guest2-${Date.now()}-abcdef` })
      .expect(201);
    await app.get(AnnouncementDelivery).process();
    const mail = sendSpy.mock.calls.find((c) => c[0] === pending.email)!;
    expect(mail[2]).toMatchObject({ name: 'waitlistOpenGuest', hasAccount: true, url: expect.stringMatching(/\/en\/login\?returnTo=[^#]+#email=/) });
  });

  it('shows admins the list, exports it as CSV and notifies everyone once, setting notifiedAt', async () => {
    const course = await comingSoon();
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const visitor = uniqueEmail('wl');
    await guestEntry(course.id, visitor);
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

    // OPEN but applications only open next week, or the deadline already passed: still refused
    // (the email says "it's open" and each person is only told once).
    for (const dates of [
      { applicationsOpenAt: new Date(Date.now() + 7 * 86_400_000), applicationDeadline: null },
      { applicationsOpenAt: null, applicationDeadline: new Date(Date.now() - 60_000) },
    ]) {
      await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN', ...dates } });
      const notYet = await http()
        .post(`/api/admin/courses/${course.id}/waitlist/notify`)
        .set('Cookie', admin.cookie)
        .send({ subjectEn: 'Open', bodyEn: 'Apply now.', idempotencyKey: `wl-dates-${Date.now()}-abcdef` })
        .expect(400);
      expect(notYet.body.code).toBe('COURSE_NOT_OPEN');
    }
    expect(await prisma.courseInterest.count({ where: { courseId: course.id, deliveryStatus: { not: null } } })).toBe(0);

    await prisma.course.update({ where: { id: course.id }, data: { status: 'OPEN', applicationsOpenAt: null, applicationDeadline: null } });
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
    const openEmails = sendSpy.mock.calls.filter((c) => (c[2] as { name: string }).name.startsWith('waitlistOpen'));
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
