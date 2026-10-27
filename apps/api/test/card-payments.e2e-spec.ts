import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CARD_PAYMENT_NEEDS_REFUND } from '@academy/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PAYMOB_FETCH, paymobHmac, type PaymobFetch } from '../src/payments/paymob';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';
import { createCourse, createUser } from './helpers';

const HMAC = 'e2e-paymob-hmac-secret';
const PAYMOB_ENV = {
  PAYMOB_SECRET_KEY: 'egy_sk_test_e2e',
  PAYMOB_PUBLIC_KEY: 'egy_pk_test_e2e',
  PAYMOB_HMAC_SECRET: HMAC,
  PAYMOB_CARD_INTEGRATION_ID: '4560001',
};

describe('card payments through Paymob (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  /** What the fake Paymob was asked to create, newest last. */
  const intentions: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  let order = 900_000;
  let txnId = 5_000_000;

  const fakeFetch: PaymobFetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    intentions.push({
      url,
      body,
      auth: String((init.headers as Record<string, string>).Authorization),
    });
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: `pi_test_${order}`,
        client_secret: `egy_csk_test_${order}`,
        intention_order_id: ++order,
      }),
    };
  };

  beforeAll(async () => {
    Object.assign(process.env, PAYMOB_ENV, { EMAIL_PROVIDER: 'log', JOBS_ENABLED: 'false' });
    process.env.PUBLIC_CACHE_TTL_S ??= '0';
    process.env.SIGNED_IN_CACHE_TTL_S ??= '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMOB_FETCH)
      .useValue(fakeFetch)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: ['error'],
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    for (const k of Object.keys(PAYMOB_ENV)) delete process.env[k];
    await app.close();
  });

  async function awaitingPayment(price = 2500) {
    const course = await createCourse(prisma, { type: 'PAID', price });
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const student = await createUser(app, prisma);
    const res = await http()
      .post('/api/applications')
      .set('Cookie', student.cookie)
      .send({ courseSlug: course.slug, answers: { [course.questionId]: true } })
      .expect(201);
    await http()
      .post(`/api/admin/applications/${res.body.id}/transition`)
      .set('Cookie', admin.cookie)
      .send({ event: 'ACCEPT' })
      .expect(200);
    return { course, admin, student, applicationId: res.body.id as string };
  }

  const checkout = (cookie: string, applicationId: string) =>
    http().post(`/api/me/applications/${applicationId}/card-checkout`).set('Cookie', cookie).send({ locale: 'ar' });

  /** A signed "transaction processed" callback for the latest checkout. */
  function callback(over: Record<string, unknown> = {}) {
    const last = intentions.at(-1)!;
    const obj: Record<string, unknown> = {
      id: ++txnId,
      amount_cents: last.body.amount,
      created_at: new Date().toISOString(),
      currency: last.body.currency,
      error_occured: false,
      has_parent_transaction: false,
      integration_id: 4560001,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: order, merchant_order_id: last.body.special_reference },
      owner: 1,
      pending: false,
      source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
      success: true,
      ...over,
    };
    return { obj, hmac: paymobHmac(obj, HMAC) };
  }
  const deliver = ({ obj, hmac }: { obj: Record<string, unknown>; hmac: string }) =>
    http().post(`/api/payments/paymob/webhook?hmac=${hmac}`).send({ type: 'TRANSACTION', obj });

  it('offers card payment and creates a Paymob checkout for the course price', async () => {
    const { student, applicationId } = await awaitingPayment(2500);
    const ins = await http().get(`/api/me/applications/${applicationId}/payment-instructions`).set('Cookie', student.cookie).expect(200);
    expect(ins.body.cardEnabled).toBe(true);

    const res = await checkout(student.cookie, applicationId).expect(200);
    expect(res.body.url).toBe(
      `https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_e2e&clientSecret=egy_csk_test_${order - 1}`,
    );
    const sent = intentions.at(-1)!;
    expect(sent.url).toBe('https://accept.paymob.com/v1/intention/');
    expect(sent.auth).toBe('Token egy_sk_test_e2e');
    expect(sent.body).toMatchObject({
      amount: 250000,
      currency: 'EGP',
      payment_methods: [4560001],
    });
    expect(sent.body.redirection_url).toMatch(new RegExp(`/ar/dashboard/applications/${applicationId}\\?card=return$`));
    expect(sent.body.notification_url).toMatch(/\/api\/payments\/paymob\/webhook$/);
    const row = await prisma.cardCheckout.findUniqueOrThrow({
      where: { id: String(sent.body.special_reference) },
    });
    expect(row).toMatchObject({
      applicationId,
      amount: 2500,
      currency: 'EGP',
      providerOrderId: String(order),
      completedAt: null,
    });
  });

  it('refuses a checkout for someone else, or when nothing is due', async () => {
    const { student, applicationId } = await awaitingPayment();
    const other = await createUser(app, prisma);
    await checkout(other.cookie, applicationId).expect(404);
    await checkout(student.cookie, applicationId).expect(200);
    await deliver(callback()).expect(200);
    expect((await checkout(student.cookie, applicationId).expect(409)).body.code).toBe('NOT_AWAITING_PAYMENT');
  });

  it('enrols on a signed successful payment, once, with an approved card payment on record', async () => {
    const { student, course, applicationId } = await awaitingPayment();
    await checkout(student.cookie, applicationId).expect(200);
    const cb = callback();
    await deliver(cb).expect(200);

    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('ENROLLED');
    expect(await prisma.enrollment.count({ where: { courseId: course.id, userId: student.id } })).toBe(1);
    const payments = await prisma.payment.findMany({ where: { applicationId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: 'CARD',
      status: 'APPROVED',
      amount: 2500,
      transactionRef: String(cb.obj.id),
      screenshotKey: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { entityId: payments[0]!.id, action: 'payment.card_paid' },
      }),
    ).toBe(1);

    // Paymob retries callbacks: a replay changes nothing.
    await deliver(cb).expect(200);
    expect(await prisma.payment.count({ where: { applicationId } })).toBe(1);
  });

  it('rejects unsigned or tampered callbacks and ignores declined payments', async () => {
    const { student, applicationId } = await awaitingPayment();
    await checkout(student.cookie, applicationId).expect(200);
    const cb = callback();
    await http().post('/api/payments/paymob/webhook').send({ type: 'TRANSACTION', obj: cb.obj }).expect(401);
    await deliver({ obj: { ...cb.obj, amount_cents: 100 }, hmac: cb.hmac }).expect(401);

    await deliver(callback({ success: false })).expect(200);
    await deliver(callback({ pending: true })).expect(200);
    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('AWAITING_PAYMENT');
    expect(await prisma.payment.count({ where: { applicationId } })).toBe(0);
  });

  it('records a payment it cannot enrol with as needing a refund and tells the finance team', async () => {
    const { student, admin, applicationId } = await awaitingPayment();
    await checkout(student.cookie, applicationId).expect(200);
    // The student withdraws while Paymob's page is still open, then pays.
    await http().post(`/api/me/applications/${applicationId}/withdraw`).set('Cookie', student.cookie).send({}).expect(200);
    await deliver(callback()).expect(200);

    const p = await prisma.payment.findFirstOrThrow({ where: { applicationId } });
    expect(p).toMatchObject({
      method: 'CARD',
      status: 'REJECTED',
      rejectionReason: CARD_PAYMENT_NEEDS_REFUND,
    });
    expect(
      await prisma.auditLog.count({
        where: { entityId: p.id, action: 'payment.card_needs_refund' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: admin.id, type: 'admin.card_payment_refund' },
      }),
    ).toBe(1);
    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('WITHDRAWN');
  });

  it('does not enrol when the amount paid differs from the checkout', async () => {
    const { student, applicationId } = await awaitingPayment(2500);
    await checkout(student.cookie, applicationId).expect(200);
    await deliver(callback({ amount_cents: 100 })).expect(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { applicationId } });
    expect(p).toMatchObject({ status: 'REJECTED', amount: 1 });
    const mine = await http().get(`/api/me/applications/${applicationId}`).set('Cookie', student.cookie).expect(200);
    expect(mine.body.status).toBe('AWAITING_PAYMENT');
  });
});
