import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const png = (salt: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`withdraw-${salt}`)]);

/**
 * Students withdraw an application (the refund policy tells them to, so the seat goes to someone
 * on the waitlist), and deleting an account withdraws its open applications: seats come back
 * and a payment under review leaves the queue instead of enrolling a deleted account.
 */
describe('withdrawing applications (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sendSpy: jest.SpyInstance;
  const http = () => request(app.getHttpServer());
  let savedSettings: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sendSpy = jest.spyOn(app.get(EmailService), 'send');
    savedSettings = await prisma.setting.findMany({ where: { key: { in: ['instapayHandle', 'vodafoneCashNumber'] } } });
    for (const [key, value] of [['instapayHandle', 'academy@instapay'], ['vodafoneCashNumber', '01000000000']] as const) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
  });
  afterAll(async () => {
    for (const s of savedSettings) await prisma.setting.update({ where: { key: s.key }, data: { value: s.value as string } });
    sendSpy.mockRestore();
    await app.close();
  });

  const apply = (cookie: string, course: { slug: string; questionId: string }) =>
    http().post('/api/applications').set('Cookie', cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } });
  const seats = async (slug: string) => (await http().get(`/api/courses/${slug}`).expect(200)).body.seatsRemaining as number;
  const pay = (cookie: string, applicationId: string, salt: string) =>
    http()
      .post(`/api/me/applications/${applicationId}/payments`)
      .set('Cookie', cookie)
      .field('method', 'INSTAPAY')
      .field('amount', '1000')
      .field('transactionRef', `WD-${salt}`)
      .field('senderName', 'Test Sender')
      .field('senderPhone', '01001234567')
      .field('paidAt', new Date().toISOString())
      .attach('screenshot', png(salt), 'proof.png');

  it('lets a student withdraw, frees the seat for the waitlist, and lets them apply again', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 1000, capacity: 1 });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'wd-admin' });
    const leaver = await createUser(app, prisma, { prefix: 'wd-leaver' });
    const waiting = await createUser(app, prisma, { prefix: 'wd-waiting' });
    const other = await createUser(app, prisma, { prefix: 'wd-other' });

    const a = (await apply(leaver.cookie, course).expect(201)).body;
    const b = (await apply(waiting.cookie, course).expect(201)).body;
    await http().post(`/api/admin/applications/${a.id}/transition`).set('Cookie', admin.cookie).send({ event: 'ACCEPT' }).expect(200);
    expect((await http().post(`/api/admin/applications/${b.id}/transition`).set('Cookie', admin.cookie).send({ event: 'ACCEPT' }).expect(200)).body.status).toBe('WAITLISTED');
    expect(await seats(course.slug)).toBe(0);

    // Only the owner, and only through their own session.
    await http().post(`/api/me/applications/${a.id}/withdraw`).set('Cookie', other.cookie).expect(404);
    await http().post(`/api/me/applications/${a.id}/withdraw`).expect(401);

    sendSpy.mockClear();
    const res = await http().post(`/api/me/applications/${a.id}/withdraw`).set('Cookie', leaver.cookie).expect(200);
    expect(res.body.status).toBe('WITHDRAWN');
    expect(res.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['SUBMITTED', 'AWAITING_PAYMENT', 'WITHDRAWN']);
    expect(await seats(course.slug)).toBe(1);
    // Told by email and in the app.
    expect(sendSpy.mock.calls.some((c) => c[0] === leaver.email && (c[2] as { status?: string }).status === 'WITHDRAWN')).toBe(true);
    expect(await prisma.notification.count({ where: { userId: leaver.id, type: 'application.withdrawn' } })).toBe(1);
    // Twice is refused; nothing else to withdraw.
    expect((await http().post(`/api/me/applications/${a.id}/withdraw`).set('Cookie', leaver.cookie).expect(409)).body.code).toBe('NOT_WITHDRAWABLE');

    // The waitlisted student can now be accepted into the freed seat.
    expect((await http().post(`/api/admin/applications/${b.id}/transition`).set('Cookie', admin.cookie).send({ event: 'ACCEPT' }).expect(200)).body.status).toBe('AWAITING_PAYMENT');

    // Applying again reopens the same application, with its history.
    const again = await apply(leaver.cookie, course).expect(201);
    expect(again.body.id).toBe(a.id);
    expect(again.body.status).toBe('SUBMITTED');
    expect(again.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['SUBMITTED', 'AWAITING_PAYMENT', 'WITHDRAWN', 'SUBMITTED']);
    expect((await apply(leaver.cookie, course).expect(409)).body.code).toBe('ALREADY_APPLIED');
  });

  it('refuses withdrawing while a payment is under review or once enrolled', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 1000, requiresApproval: false });
    const s = await createUser(app, prisma, { prefix: 'wd-paying' });
    const a = (await apply(s.cookie, course).expect(201)).body;
    expect(a.status).toBe('AWAITING_PAYMENT');
    await pay(s.cookie, a.id, `review-${Date.now()}`).expect(201);
    expect((await http().post(`/api/me/applications/${a.id}/withdraw`).set('Cookie', s.cookie).expect(409)).body.code).toBe('PAYMENT_UNDER_REVIEW');

    const free = await createCourse(prisma, { requiresApproval: false });
    const e = (await apply(s.cookie, free).expect(201)).body;
    expect(e.status).toBe('ENROLLED');
    expect((await http().post(`/api/me/applications/${e.id}/withdraw`).set('Cookie', s.cookie).expect(409)).body.code).toBe('NOT_WITHDRAWABLE');
  });

  it('withdraws a deleted account\'s open applications: seats come back and its pending payment leaves the queue', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 1000, requiresApproval: false, capacity: 1 });
    const other = await createCourse(prisma, { requiresApproval: true });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'wd-admin2' });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'wd-finance' });
    const leaver = await createUser(app, prisma, { prefix: 'wd-deleted' });
    const next = await createUser(app, prisma, { prefix: 'wd-next' });

    const a = (await apply(leaver.cookie, course).expect(201)).body;
    const submitted = (await apply(leaver.cookie, other).expect(201)).body;
    await pay(leaver.cookie, a.id, `deleted-${Date.now()}`).expect(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { applicationId: a.id } });
    expect(await seats(course.slug)).toBe(0);

    await http().post(`/api/admin/students/${leaver.id}/delete`).set('Cookie', admin.cookie).send({ confirm: leaver.email }).expect(200);

    const rows = await prisma.application.findMany({ where: { userId: leaver.id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
    expect(rows.map((r) => r.status).sort()).toEqual(['WITHDRAWN', 'WITHDRAWN']);
    expect(rows.find((r) => r.id === submitted.id)!.history.at(-1)).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'WITHDRAWN', reason: 'Account deleted' });
    const closed = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(closed).toMatchObject({ status: 'REJECTED', rejectionReason: 'Closed: the student deleted their account' });
    expect(await prisma.auditLog.count({ where: { action: 'payment.closed', entityId: payment.id } })).toBe(1);
    // Whoever reviews payments hears about it (money may have to be refunded).
    expect(await prisma.notification.count({ where: { userId: finance.id, type: 'admin.payment_closed', link: `/admin/payments/${payment.id}` } })).toBe(1);

    // The seat is free: the next student gets it.
    expect(await seats(course.slug)).toBe(1);
    expect((await apply(next.cookie, course).expect(201)).body.status).toBe('AWAITING_PAYMENT');
    const queue = (await http().get('/api/admin/payments').set('Cookie', finance.cookie).expect(200)).body as { id: string }[];
    expect(queue.some((p) => p.id === payment.id)).toBe(false);
  });

  it('never enrols a deleted account from a payment left pending before deletion withdrew applications', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 1000, requiresApproval: false, capacity: 1 });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'wd-finance2' });
    const s = await createUser(app, prisma, { prefix: 'wd-legacy' });
    const a = (await apply(s.cookie, course).expect(201)).body;
    await pay(s.cookie, a.id, `legacy-${Date.now()}`).expect(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { applicationId: a.id } });
    // An account deleted before this release: the application and payment were left as they were.
    await prisma.user.update({ where: { id: s.id }, data: { deletedAt: new Date() } });

    // It no longer holds the seat.
    expect(await seats(course.slug)).toBe(1);
    const approve = await http().post(`/api/admin/payments/${payment.id}/approve`).set('Cookie', finance.cookie).send({ verifiedInHistory: true }).expect(409);
    expect(approve.body.code).toBe('ACCOUNT_DELETED');
    expect(await prisma.enrollment.count({ where: { userId: s.id } })).toBe(0);
    // Closing it (reject) still works.
    await http().post(`/api/admin/payments/${payment.id}/reject`).set('Cookie', finance.cookie).send({ reason: 'Account deleted' }).expect(200);
  });
});
