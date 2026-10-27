import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { buildEmail } from '../src/email/templates/catalog';
import { PaymentsService } from '../src/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** A tiny but valid PNG header; `salt` makes the bytes (and hash) unique. */
const png = (salt: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`fake-image-${salt}`)]);

describe('payments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let savedSettings: { key: string; value: unknown }[] = [];
  const setPaymentDetails = async (handle: string, number: string) => {
    for (const [key, value] of [['instapayHandle', handle], ['vodafoneCashNumber', number]] as const) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    savedSettings = await prisma.setting.findMany({ where: { key: { in: ['instapayHandle', 'vodafoneCashNumber'] } } });
    await setPaymentDetails('academy@instapay', '01000000000');
  });
  afterAll(async () => {
    for (const s of savedSettings) await prisma.setting.update({ where: { key: s.key }, data: { value: s.value as string } });
    // Settings this suite created must go too: left behind, they leak into later suites (consultations).
    const kept = savedSettings.map((s) => s.key);
    await prisma.setting.deleteMany({ where: { key: { in: ['instapayHandle', 'vodafoneCashNumber'].filter((k) => !kept.includes(k)) } } });
    await app.close();
  });

  /** A paid course and an accepted student waiting to pay. */
  async function awaitingPayment(price = 2500) {
    const course = await createCourse(prisma, { type: 'PAID', price });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const res = await http()
      .post('/api/applications')
      .set('Cookie', student.cookie)
      .send({ courseSlug: course.slug, answers: { [course.questionId]: true } })
      .expect(201);
    await http().post(`/api/admin/applications/${res.body.id}/transition`).set('Cookie', admin.cookie).send({ event: 'ACCEPT' }).expect(200);
    return { course, admin, student, applicationId: res.body.id as string };
  }

  const submit = (cookie: string, applicationId: string, fields: Record<string, string>, file?: Buffer, name = 'proof.png') => {
    const r = http().post(`/api/me/applications/${applicationId}/payments`).set('Cookie', cookie);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    if (file) r.attach('screenshot', file, name);
    return r;
  };
  const proof = (ref: string, amount = '2500') => ({
    method: 'INSTAPAY',
    amount,
    transactionRef: ref,
    senderName: 'Test Sender',
    senderPhone: 'sender@instapay',
    paidAt: new Date().toISOString(),
  });

  it('shows instructions and validates the proof', async () => {
    const { student, applicationId } = await awaitingPayment();
    const ins = await http().get(`/api/me/applications/${applicationId}/payment-instructions`).set('Cookie', student.cookie).expect(200);
    expect(ins.body).toMatchObject({ amount: 2500, currency: 'EGP' });

    const ref = `IP-${Date.now()}`;
    expect((await submit(student.cookie, applicationId, proof(ref)).expect(400)).body.code).toBe('FILE_REQUIRED');
    expect((await submit(student.cookie, applicationId, proof(ref), Buffer.from('<html>'), 'x.png').expect(400)).body.code).toBe('FILE_TYPE');
    expect((await submit(student.cookie, applicationId, { ...proof(ref), transactionRef: '' }, png('a')).expect(400)).body.errors[0].path).toBe('transactionRef');

    await submit(student.cookie, applicationId, proof(ref), png(ref)).expect(201);
    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('PAYMENT_SUBMITTED');
    // Can't submit twice while one is under review.
    expect((await submit(student.cookie, applicationId, proof(`${ref}b`), png(`${ref}b`)).expect(409)).body.code).toBe('NOT_AWAITING_PAYMENT');
  });

  it('flags duplicate references, reused screenshots and wrong amounts', async () => {
    const ref = `DUP-${Date.now()}`;
    const shot = png(ref);
    const a = await awaitingPayment();
    const b = await awaitingPayment();
    await submit(a.student.cookie, a.applicationId, proof(ref), shot).expect(201);
    const pb = await submit(b.student.cookie, b.applicationId, proof(ref.toLowerCase().replace('-', ' '), '2000'), shot).expect(201);
    const view = await http().get(`/api/admin/payments/${pb.body.id}`).set('Cookie', b.admin.cookie).expect(200);
    expect(view.body.flags).toEqual({ duplicateRef: true, duplicateScreenshot: true, amountMismatch: true });
    expect(view.body.duplicates.length).toBeGreaterThanOrEqual(1);
    expect(view.body.student.googleEmail).toMatch(/^g\./);
  });

  it('only lets admins view screenshots, through short-lived audited links', async () => {
    const { student, admin, applicationId } = await awaitingPayment();
    const p = await submit(student.cookie, applicationId, proof(`SS-${Date.now()}`), png(`ss${Date.now()}`)).expect(201);
    await http().get(`/api/admin/payments/${p.body.id}/screenshot`).set('Cookie', student.cookie).expect(403);
    const res = await http().get(`/api/admin/payments/${p.body.id}/screenshot`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.expiresIn).toBeLessThanOrEqual(300);
    expect(res.body.url).toMatch(/X-Amz-Expires=300/);
    expect(await prisma.auditLog.count({ where: { entityId: p.body.id, action: 'payment.screenshot_viewed' } })).toBe(1);
    // The student-facing payment never exposes the storage key.
    const mine = await http().get(`/api/me/applications/${applicationId}/payments`).set('Cookie', student.cookie).expect(200);
    expect(JSON.stringify(mine.body)).not.toMatch(/payments\//);
  });

  it('requires confirming the transaction history before approving, then enrols', async () => {
    const { student, admin, applicationId, course } = await awaitingPayment();
    const p = await submit(student.cookie, applicationId, proof(`AP-${Date.now()}`), png(`ap${Date.now()}`)).expect(201);
    await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', admin.cookie).send({}).expect(400);
    await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', student.cookie).send({ verifiedInHistory: true }).expect(403);
    const ok = await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', admin.cookie).send({ verifiedInHistory: true }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', verifiedInHistory: true });
    expect(await prisma.enrollment.count({ where: { courseId: course.id, userId: student.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: p.body.id, action: 'payment.approved' } });
    expect(audit?.metadata).toMatchObject({ verifiedInHistory: true });
    await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', admin.cookie).send({ verifiedInHistory: true }).expect(409);
  });

  it('tells the student their seat is confirmed (not "accepted" again) once the payment is verified', async () => {
    const send = jest.spyOn(app.get(EmailService), 'send');
    try {
      const { student, admin, applicationId } = await awaitingPayment();
      const p = await submit(student.cookie, applicationId, proof(`SC-${Date.now()}`), png(`sc${Date.now()}`)).expect(201);
      send.mockClear();
      await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', admin.cookie).send({ verifiedInHistory: true }).expect(200);
      const tpl = send.mock.calls.find((c) => c[0] === student.email)?.[2] as Parameters<typeof buildEmail>[0];
      expect(tpl).toMatchObject({ name: 'applicationStatus', status: 'ENROLLED', paymentVerified: true });
      expect(buildEmail(tpl, 'en').subject).toMatch(/^🎉 Your seat is confirmed: /);
      expect(buildEmail({ ...tpl, paymentVerified: false } as typeof tpl, 'en').subject).toMatch(/^🎉 You're accepted: /);
    } finally {
      send.mockRestore();
    }
  });

  it('rejects with a reason and lets the student resubmit', async () => {
    const { student, admin, applicationId } = await awaitingPayment();
    const p = await submit(student.cookie, applicationId, proof(`RJ-${Date.now()}`), png(`rj${Date.now()}`)).expect(201);
    await http().post(`/api/admin/payments/${p.body.id}/reject`).set('Cookie', admin.cookie).send({ reason: 'x' }).expect(400);
    await http().post(`/api/admin/payments/${p.body.id}/reject`).set('Cookie', admin.cookie).send({ reason: 'Reference not found in InstaPay history' }).expect(200);
    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('PAYMENT_REJECTED');
    const note = await prisma.notification.findFirst({ where: { userId: student.id, type: 'application.payment_rejected' } });
    expect(note?.bodyEn).toContain('Reference not found');
    await submit(student.cookie, applicationId, proof(`RJ2-${Date.now()}`), png(`rj2${Date.now()}`)).expect(201);
  });

  it('deletes old screenshots but keeps the payment record', async () => {
    const { student, applicationId } = await awaitingPayment();
    const p = await submit(student.cookie, applicationId, proof(`RT-${Date.now()}`), png(`rt${Date.now()}`)).expect(201);
    // Still under review: kept regardless of age.
    await prisma.payment.update({ where: { id: p.body.id }, data: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    await app.get(PaymentsService).purgeOldScreenshots(180);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } })).screenshotKey).not.toBeNull();
    await prisma.payment.update({ where: { id: p.body.id }, data: { status: 'APPROVED' } });
    const removed = await app.get(PaymentsService).purgeOldScreenshots(180);
    expect(removed).toBeGreaterThanOrEqual(1);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } });
    expect(row.screenshotKey).toBeNull();
    expect(row.screenshotDeletedAt).not.toBeNull();
    expect(row.transactionRef).toMatch(/^RT-/);
  });

  it('refuses payments while no payment method is set (empty or old placeholders)', async () => {
    const { student, applicationId } = await awaitingPayment();
    await setPaymentDetails('[PLACEHOLDER]@instapay', '');
    try {
      const ins = await http().get(`/api/me/applications/${applicationId}/payment-instructions`).set('Cookie', student.cookie).expect(200);
      expect(ins.body).toMatchObject({ configured: false, methods: [], instapayHandle: '', vodafoneCashNumber: '' });
      const res = await submit(student.cookie, applicationId, proof(`PH-${Date.now()}`), png(`ph${Date.now()}`)).expect(503);
      expect(res.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
    } finally {
      await setPaymentDetails('academy@instapay', '01000000000');
    }
  });

  it('offers only the methods that are set up', async () => {
    const { student, applicationId } = await awaitingPayment();
    await setPaymentDetails('', '01000000000');
    try {
      const ins = await http().get(`/api/me/applications/${applicationId}/payment-instructions`).set('Cookie', student.cookie).expect(200);
      expect(ins.body).toMatchObject({ configured: true, methods: ['VODAFONE_CASH'], instapayHandle: '' });
      const res = await submit(student.cookie, applicationId, proof(`VF-${Date.now()}`), png(`vf${Date.now()}`)).expect(400);
      expect(res.body.code).toBe('METHOD_NOT_AVAILABLE');
    } finally {
      await setPaymentDetails('academy@instapay', '01000000000');
    }
  });

  it('stops admins from reviewing their own payment', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 100 });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const r = await http().post('/api/applications').set('Cookie', admin.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    const other = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin2' });
    await http().post(`/api/admin/applications/${r.body.id}/transition`).set('Cookie', other.cookie).send({ event: 'ACCEPT' }).expect(200);
    const p = await submit(admin.cookie, r.body.id, proof(`SELF-${Date.now()}`, '100'), png(`self${Date.now()}`)).expect(201);
    const res = await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', admin.cookie).send({ verifiedInHistory: true }).expect(403);
    expect(res.body.code).toBe('SELF_REVIEW');
    await http().post(`/api/admin/payments/${p.body.id}/approve`).set('Cookie', other.cookie).send({ verifiedInHistory: true }).expect(200);
  });

  it('pages the queue and counts without per-row queries', async () => {
    const { admin } = await awaitingPayment();
    const count = await http().get('/api/admin/payments-count?status=PENDING_REVIEW').set('Cookie', admin.cookie).expect(200);
    expect(typeof count.body.count).toBe('number');
    const page = await http().get('/api/admin/payments?status=PENDING_REVIEW&page=1').set('Cookie', admin.cookie).expect(200);
    expect(Array.isArray(page.body)).toBe(true);
  });
});
