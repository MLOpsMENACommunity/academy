import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { randomToken, sha256 } from '../src/common/crypto';
import { EmailService } from '../src/email/email.service';
import { InvitesService } from '../src/invites/invites.service';
import { RetentionJobs } from '../src/jobs/retention.jobs';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { cookieHeader, createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

describe('enrol by email (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sendSpy: jest.SpyInstance;
  let claimSpy: jest.SpyInstance;
  let admin: { id: string; email: string; cookie: string };
  const http = () => request(app.getHttpServer());
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sendSpy = jest.spyOn(app.get(EmailService), 'send');
    claimSpy = jest.spyOn(app.get(InvitesService), 'claimFor');
  });
  afterAll(async () => {
    sendSpy.mockRestore();
    claimSpy.mockRestore();
    await app.close();
  });
  // A fresh admin per test: enrolling is rate-limited per account (10 a minute).
  beforeEach(async () => {
    sendSpy.mockClear();
    claimSpy.mockClear();
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'inv-admin' });
  });

  const sent = (name: string) => sendSpy.mock.calls.filter((c) => (c[2] as { name: string }).name === name);
  const enrol = (courseId: string, emails: string[], extra: Record<string, unknown> = {}) =>
    http()
      .post(`/api/admin/courses/${courseId}/invites`)
      .set('Cookie', admin.cookie)
      .send({ entries: emails.map((email) => ({ email })), ...extra });

  /** Registers through the API (unverified) and returns the session cookie. */
  async function register(email: string): Promise<{ id: string; cookie: string }> {
    const res = await http().post('/api/auth/register').send({ email, password, locale: 'en' }).expect(201);
    return { id: res.body.id as string, cookie: cookieHeader(res.headers['set-cookie'] as unknown as string[]) };
  }

  /** Confirms the address the way the emailed link does. */
  async function verify(userId: string, email: string, cookie: string) {
    const token = randomToken();
    await prisma.emailVerificationToken.create({ data: { userId, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) } });
    await http().post('/api/auth/verify-email').set('Cookie', cookie).send({ token }).expect(200);
  }

  /** Sign-in claims run in the background (not awaited by login): wait for the ones started so far. */
  const claimsSettled = () => Promise.all(claimSpy.mock.results.map((r) => r.value as Promise<unknown>));
  const funnelEnrolled = (courseId: string, userId: string) => prisma.funnelEventLog.count({ where: { courseId, userId, event: 'ENROLLED' } });

  const enrolled = (userId: string, courseId: string) => prisma.enrollment.count({ where: { userId, courseId } });

  it('enrols an existing student at once, with an application history entry, an email, a notification and audit', async () => {
    const course = await createCourse(prisma);
    // No complete profile needed: direct enrolment skips the form and the profile gate.
    const student = await createUser(app, prisma, { coreComplete: false, prefix: 'inv-existing' });

    const res = await enrol(course.id, [student.email.toUpperCase()]).expect(200);
    expect(res.body).toMatchObject({ enrolled: 1, invited: 0, counts: { ENROL: 1 } });
    expect(res.body.rows[0]).toMatchObject({ email: student.email, outcome: 'ENROL' });

    const application = await prisma.application.findUniqueOrThrow({
      where: { userId_courseId: { userId: student.id, courseId: course.id } },
      include: { history: true, enrollment: true },
    });
    expect(application.status).toBe('ENROLLED');
    expect(application.source).toEqual({ via: 'admin' });
    expect(application.enrollment).not.toBeNull();
    expect(await funnelEnrolled(course.id, student.id)).toBe(1);
    expect(application.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'ENROLLED', actorId: admin.id, reason: 'Enrolled directly by the course team' }),
    ]);
    const invite = await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email: student.email } } });
    expect(invite).toMatchObject({ status: 'ENROLLED', enrolledUserId: student.id, invitedById: admin.id });

    const mail = sent('courseAdded');
    expect(mail).toHaveLength(1);
    expect(mail[0]![0]).toBe(student.email);
    // Incomplete profile: a gentle nudge in the email, never a requirement.
    expect(mail[0]![2]).toMatchObject({ courseUrl: expect.stringContaining(`/learn/${course.slug}`), profileUrl: expect.stringContaining('/profile') });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: student.id, type: 'course.added' } });
    expect(note.link).toBe(`/learn/${course.slug}`);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Course', entityId: course.id, action: 'course.enrolled_by_admin' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: admin.id, metadata: expect.objectContaining({ trigger: 'direct', inviteId: invite.id }) });

    // The student sees it: learn page access and the dashboard's applications list.
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200);
    const mine = await http().get('/api/me/applications').set('Cookie', student.cookie).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ status: 'ENROLLED', enrolled: true, course: expect.objectContaining({ slug: course.slug }) })]);
  });

  it('moves an existing application (e.g. rejected) to enrolled through the workflow', async () => {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma, { prefix: 'inv-applied' });
    await http().post('/api/applications').set('Cookie', student.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    const app0 = await prisma.application.findUniqueOrThrow({ where: { userId_courseId: { userId: student.id, courseId: course.id } } });
    await http().post('/api/admin/applications/bulk').set('Cookie', admin.cookie).send({ ids: [app0.id], event: 'REJECT' }).expect(200);

    await enrol(course.id, [student.email]).expect(200);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app0.id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
    expect(after.status).toBe('ENROLLED');
    expect(after.history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, 'SUBMITTED'],
      ['SUBMITTED', 'REJECTED'],
      ['REJECTED', 'ENROLLED'],
    ]);
    expect(await enrolled(student.id, course.id)).toBe(1);
  });

  it('invites an unregistered address; it is enrolled only once the new account confirms the email', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-new');

    const res = await enrol(course.id, [email], { locale: 'ar' }).expect(200);
    expect(res.body).toMatchObject({ enrolled: 0, invited: 1, emailed: 1 });
    const mail = sent('courseInvite');
    expect(mail).toHaveLength(1);
    expect(mail[0]![1]).toBe('ar');
    expect(mail[0]![2]).toMatchObject({
      email,
      hasAccount: false,
      // The address rides in the fragment, never in the query string (server logs, Referer).
      url: expect.stringContaining(`/ar/register?returnTo=${encodeURIComponent(`/ar/learn/${course.slug}`)}#email=${encodeURIComponent(email)}`),
    });
    expect(await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } })).toMatchObject({ status: 'PENDING', lastEmailedAt: expect.any(Date) });
    expect(await prisma.auditLog.count({ where: { entityId: course.id, action: 'course.invited' } })).toBe(1);

    // Registering with the address proves nothing yet: not enrolled.
    const user = await register(email);
    expect(await enrolled(user.id, course.id)).toBe(0);
    await http().get(`/api/learn/${course.slug}`).set('Cookie', user.cookie).expect(403);
    // Signing in again while unverified doesn't claim it either.
    await http().post('/api/auth/login').send({ email, password }).expect(200);
    await claimsSettled();
    expect(await enrolled(user.id, course.id)).toBe(0);

    sendSpy.mockClear();
    await verify(user.id, email, user.cookie);
    expect(await enrolled(user.id, course.id)).toBe(1);
    const invite = await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } });
    expect(invite).toMatchObject({ status: 'ENROLLED', enrolledUserId: user.id });
    const history = await prisma.applicationStatusHistory.findMany({ where: { application: { userId: user.id, courseId: course.id } } });
    expect(history).toEqual([expect.objectContaining({ toStatus: 'ENROLLED', actorId: admin.id })]);
    expect(sent('courseAdded')).toHaveLength(1);
    expect(await funnelEnrolled(course.id, user.id)).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: course.id, action: 'course.enrolled_by_admin', metadata: { path: ['trigger'], equals: 'invite_claimed' } } })).toBe(1);
    await http().get(`/api/learn/${course.slug}`).set('Cookie', user.cookie).expect(200);

    // Idempotent: signing in again claims nothing more.
    sendSpy.mockClear();
    await http().post('/api/auth/login').send({ email, password }).expect(200);
    await claimsSettled();
    expect(sent('courseAdded')).toHaveLength(0);
    expect(await funnelEnrolled(course.id, user.id)).toBe(1);
    expect(await prisma.application.count({ where: { userId: user.id } })).toBe(1);
  });

  it('enrols on Google sign-in (Google-verified address), including several courses at once', async () => {
    const [a, b] = [await createCourse(prisma), await createCourse(prisma, { type: 'PAID', price: 500 })];
    const email = uniqueEmail('inv-google');
    await enrol(a.id, [email]).expect(200);
    await enrol(b.id, [email], { skipPayment: true, sendEmail: false }).expect(200);

    const { user } = await app.get(AuthService).loginWithGoogle({ sub: `g-${Date.now()}`, email, emailVerified: true, name: 'Google Person' }, 'en');
    await claimsSettled();
    expect(await enrolled(user.id, a.id)).toBe(1);
    expect(await enrolled(user.id, b.id)).toBe(1);
    expect(await prisma.courseInvite.count({ where: { email, status: 'ENROLLED' } })).toBe(2);
    // Paid course, enrolled without payment.
    const paid = await prisma.application.findUniqueOrThrow({ where: { userId_courseId: { userId: user.id, courseId: b.id } }, include: { payments: true } });
    expect(paid).toMatchObject({ status: 'ENROLLED', payments: [] });
  });

  it('claims an invite for an existing unverified account once it verifies', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-unverified');
    const user = await register(email);

    const preview = await http().post(`/api/admin/courses/${course.id}/invites/preview`).set('Cookie', admin.cookie).send({ entries: [{ email }] }).expect(200);
    expect(preview.body.rows[0].outcome).toBe('INVITE_UNVERIFIED');
    await enrol(course.id, [email]).expect(200);
    expect(sent('courseInvite')[0]![2]).toMatchObject({ hasAccount: true, url: expect.stringMatching(/\/en\/login\?returnTo=[^#]+#email=/) });
    expect(await enrolled(user.id, course.id)).toBe(0);

    await verify(user.id, email, user.cookie);
    expect(await enrolled(user.id, course.id)).toBe(1);
  });

  it('does not enrol through a revoked invite; revoking and resending only work on pending invites', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-revoked');
    await enrol(course.id, [email], { sendEmail: false }).expect(200);
    expect(sent('courseInvite')).toHaveLength(0);
    const invite = await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } });
    expect(invite.lastEmailedAt).toBeNull();

    // Resend works on a pending invite, once a minute.
    await http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/resend`).set('Cookie', admin.cookie).expect(200);
    expect(sent('courseInvite')).toHaveLength(1);
    const again = await http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/resend`).set('Cookie', admin.cookie).expect(409);
    expect(again.body.code).toBe('INVITE_RECENTLY_SENT');

    const revoked = await http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/revoke`).set('Cookie', admin.cookie).expect(200);
    expect(revoked.body.status).toBe('REVOKED');
    expect(await prisma.auditLog.count({ where: { entityId: course.id, action: 'course.invite_revoked' } })).toBe(1);
    expect((await http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/revoke`).set('Cookie', admin.cookie).expect(409)).body.code).toBe('INVITE_NOT_PENDING');
    expect((await http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/resend`).set('Cookie', admin.cookie).expect(409)).body.code).toBe('INVITE_NOT_PENDING');
    await http().post(`/api/admin/courses/${course.id}/invites/nope/revoke`).set('Cookie', admin.cookie).expect(404);

    const user = await register(email);
    await verify(user.id, email, user.cookie);
    expect(await enrolled(user.id, course.id)).toBe(0);

    // Inviting the address again re-opens the same row; the now-verified account is enrolled at once.
    const res = await enrol(course.id, [email]).expect(200);
    expect(res.body.rows[0].outcome).toBe('ENROL');
    expect(await enrolled(user.id, course.id)).toBe(1);
    expect(await prisma.courseInvite.count({ where: { courseId: course.id } })).toBe(1);
  });

  it('closes a payment waiting for review when the student is enrolled without paying', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 800 });
    const student = await createUser(app, prisma, { prefix: 'inv-waive' });
    await http().post('/api/applications').set('Cookie', student.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    const application = await prisma.application.update({
      where: { userId_courseId: { userId: student.id, courseId: course.id } },
      data: { status: 'PAYMENT_SUBMITTED' },
    });
    const payment = await prisma.payment.create({
      data: { applicationId: application.id, method: 'INSTAPAY', amount: 800, transactionRef: `TX${Date.now()}`, senderName: 'Sender', senderPhone: '+201000000000', paidAt: new Date(), screenshotKey: `payments/${Date.now()}.png` },
    });

    await enrol(course.id, [student.email], { skipPayment: true }).expect(200);
    expect(await enrolled(student.id, course.id)).toBe(1);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Waived: enrolled by the course team',
      reviewedById: admin.id,
      reviewedAt: expect.any(Date),
    });
    expect(await prisma.auditLog.count({ where: { entityType: 'Payment', entityId: payment.id, action: 'payment.waived', actorId: admin.id } })).toBe(1);
    // Nothing is left for a reviewer: approving it now says it was already reviewed.
    const approve = await http().post(`/api/admin/payments/${payment.id}/approve`).set('Cookie', admin.cookie).send({ verifiedInHistory: true }).expect(409);
    expect(approve.body.code).toBe('ALREADY_REVIEWED');
  });

  it('caps resends at three per invite', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-cap');
    await enrol(course.id, [email]).expect(200);
    const invite = await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } });
    const resend = () => http().post(`/api/admin/courses/${course.id}/invites/${invite.id}/resend`).set('Cookie', admin.cookie);
    const aMinuteAgo = () => prisma.courseInvite.update({ where: { id: invite.id }, data: { lastEmailedAt: new Date(Date.now() - 61_000) } });
    for (let i = 1; i <= 3; i++) {
      await aMinuteAgo();
      expect((await resend().expect(200)).body.resendCount).toBe(i);
    }
    await aMinuteAgo();
    expect((await resend().expect(409)).body.code).toBe('INVITE_RESEND_LIMIT');
    // The first email plus three resends.
    expect(sent('courseInvite')).toHaveLength(4);
  });

  it('refuses draft and archived courses, and an archived course leaves the invite pending', async () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      const course = await createCourse(prisma);
      await prisma.course.update({ where: { id: course.id }, data: { status } });
      const email = uniqueEmail('inv-closed-course');
      expect((await enrol(course.id, [email]).expect(409)).body.code).toBe('COURSE_NOT_INVITABLE');
      await http().post(`/api/admin/courses/${course.id}/invites/preview`).set('Cookie', admin.cookie).send({ entries: [{ email }] }).expect(409);
      expect(await prisma.courseInvite.count({ where: { courseId: course.id } })).toBe(0);
    }

    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-archived');
    await enrol(course.id, [email]).expect(200);
    await prisma.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
    const user = await register(email);
    await verify(user.id, email, user.cookie);
    expect(await enrolled(user.id, course.id)).toBe(0);
    expect(await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } })).toMatchObject({ status: 'PENDING' });
  });

  it('spends the invite without a second audit entry when the account is already enrolled', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-already');
    await enrol(course.id, [email]).expect(200);
    const user = await register(email);
    // Enrolled some other way before confirming the address (here: directly, as the workflow would).
    await prisma.application.create({ data: { userId: user.id, courseId: course.id, status: 'ENROLLED', answers: {}, profileSnapshot: {}, source: {} } });
    const a = await prisma.application.findUniqueOrThrow({ where: { userId_courseId: { userId: user.id, courseId: course.id } } });
    await prisma.enrollment.create({ data: { userId: user.id, courseId: course.id, applicationId: a.id } });
    sendSpy.mockClear();

    await verify(user.id, email, user.cookie);
    expect(await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } })).toMatchObject({ status: 'ENROLLED' });
    expect(await prisma.auditLog.count({ where: { entityId: course.id, action: 'course.enrolled_by_admin' } })).toBe(0);
    expect(sent('courseAdded')).toHaveLength(0);
    expect(await funnelEnrolled(course.id, user.id)).toBe(0);
  });

  it('is idempotent: duplicates in a list and a repeated list change nothing more', async () => {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma, { prefix: 'inv-dup' });
    const fresh = uniqueEmail('inv-dup-new');

    const first = await enrol(course.id, [student.email, fresh, ` ${student.email.toUpperCase()} `, 'not-an-email']).expect(200);
    expect(first.body.counts).toEqual({ ENROL: 1, INVITE: 1, DUPLICATE: 1, INVALID: 1 });
    const second = await enrol(course.id, [student.email, fresh]).expect(200);
    expect(second.body).toMatchObject({ enrolled: 0, invited: 0, counts: { ALREADY_ENROLLED: 1, ALREADY_INVITED: 1 } });
    expect(await prisma.application.count({ where: { courseId: course.id } })).toBe(1);
    expect(await prisma.applicationStatusHistory.count({ where: { application: { courseId: course.id } } })).toBe(1);
    expect(await prisma.courseInvite.count({ where: { courseId: course.id } })).toBe(2);
    expect(sent('courseAdded')).toHaveLength(1);
    expect(sent('courseInvite')).toHaveLength(1);
  });

  it('enrols speaker accounts (speakers study too), skips admin and closed accounts', async () => {
    const course = await createCourse(prisma);
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'inv-speaker' });
    const otherAdmin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'inv-admin2' });
    const closed = await createUser(app, prisma, { prefix: 'inv-closed' });
    await prisma.user.update({ where: { id: closed.id }, data: { deletedAt: new Date() } });

    const res = await enrol(course.id, [speaker.email, otherAdmin.email, closed.email]).expect(200);
    expect(res.body.rows.map((r: { outcome: string }) => r.outcome)).toEqual(['ENROL', 'ADMIN', 'CLOSED']);
    expect(res.body).toMatchObject({ enrolled: 1, invited: 0 });
    expect(await enrolled(speaker.id, course.id)).toBe(1);
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(1);

    // A speaker who signs up with an invited address claims the invite once the address is confirmed.
    const email = uniqueEmail('inv-speaker-new');
    await enrol(course.id, [email]).expect(200);
    const s = await http().post('/api/auth/register').send({ email, password, role: 'SPEAKER' }).expect(201);
    await verify(s.body.id, email, cookieHeader(s.headers['set-cookie'] as unknown as string[]));
    expect(await enrolled(s.body.id as string, course.id)).toBe(1);
    expect(await prisma.courseInvite.findUniqueOrThrow({ where: { courseId_email: { courseId: course.id, email } } })).toMatchObject({ status: 'ENROLLED' });
  });

  it('requires the payment waiver for paid courses', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 1000 });
    const student = await createUser(app, prisma, { prefix: 'inv-paid' });
    const res = await enrol(course.id, [student.email]).expect(400);
    expect(res.body.code).toBe('PAYMENT_WAIVER_REQUIRED');
    expect(await enrolled(student.id, course.id)).toBe(0);
    await enrol(course.id, [student.email], { skipPayment: true }).expect(200);
    expect(await enrolled(student.id, course.id)).toBe(1);
  });

  it('previews without changing anything, and reports capacity', async () => {
    const course = await createCourse(prisma, { capacity: 1 });
    const student = await createUser(app, prisma, { prefix: 'inv-preview' });
    const res = await http()
      .post(`/api/admin/courses/${course.id}/invites/preview`)
      .set('Cookie', admin.cookie)
      .send({ entries: [{ email: student.email }, { email: uniqueEmail('inv-p') }, { email: 'x' }] })
      .expect(200);
    expect(res.body.counts).toEqual({ ENROL: 1, INVITE: 1, INVALID: 1 });
    expect(res.body.course).toEqual({ type: 'FREE', capacity: 1, seatsTaken: 0 });
    expect(await prisma.courseInvite.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.application.count({ where: { courseId: course.id } })).toBe(0);
  });

  it('is admin-only', async () => {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma, { prefix: 'inv-acl' });
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'inv-acl-s' });
    for (const cookie of [student.cookie, speaker.cookie]) {
      await http().get(`/api/admin/courses/${course.id}/invites`).set('Cookie', cookie).expect(403);
      await http().post(`/api/admin/courses/${course.id}/invites`).set('Cookie', cookie).send({ entries: [{ email: student.email }] }).expect(403);
      await http().post(`/api/admin/courses/${course.id}/invites/preview`).set('Cookie', cookie).send({ entries: [{ email: student.email }] }).expect(403);
      await http().get(`/api/admin/courses/${course.id}/invites/export.csv`).set('Cookie', cookie).expect(403);
    }
    await http().get(`/api/admin/courses/${course.id}/invites`).expect(401);
    await http().post(`/api/admin/courses/${course.id}/invites`).send({ entries: [{ email: student.email }] }).expect(401);
    await http().get('/api/admin/courses/no-such-course/invites').set('Cookie', admin.cookie).expect(404);
    await http().post(`/api/admin/courses/${course.id}/invites`).set('Cookie', admin.cookie).send({ entries: [] }).expect(400);
    expect(await prisma.courseInvite.count({ where: { courseId: course.id } })).toBe(0);
  });

  it('lists invites and exports them as CSV (audited)', async () => {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma, { prefix: 'inv-csv' });
    const fresh = uniqueEmail('inv-csv-new');
    await http()
      .post(`/api/admin/courses/${course.id}/invites`)
      .set('Cookie', admin.cookie)
      .send({ entries: [{ email: student.email }, { email: fresh, name: 'Mona', note: 'Sponsor seat, "VIP"' }] })
      .expect(200);

    const list = await http().get(`/api/admin/courses/${course.id}/invites`).set('Cookie', admin.cookie).expect(200);
    expect(list.body.counts).toEqual({ PENDING: 1, ENROLLED: 1, REVOKED: 0 });
    expect(list.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: student.email, status: 'ENROLLED', invitedBy: admin.email, name: 'Test Person' }),
        expect.objectContaining({ email: fresh, status: 'PENDING', note: 'Sponsor seat, "VIP"', invitedBy: admin.email }),
      ]),
    );

    const csv = await http().get(`/api/admin/courses/${course.id}/invites/export.csv`).set('Cookie', admin.cookie).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['cache-control']).toBe('private, no-store');
    expect(csv.text).toContain('"Email","Name","Status","Invited at","Invited by","Enrolled at","Last emailed at","Language","Note"');
    expect(csv.text).toContain(`"${fresh}","","PENDING",`);
    expect(csv.text).toContain(`"${student.email}","Test Person","ENROLLED",`);
    expect(csv.text).toContain('"Sponsor seat, ""VIP"""');
    expect(await prisma.auditLog.count({ where: { entityId: course.id, action: 'course.invites_exported', actorId: admin.id } })).toBe(1);
  });

  it('keeps invites private: in the data export, gone with the account, and purged after 180 days', async () => {
    const course = await createCourse(prisma);
    const email = uniqueEmail('inv-privacy');
    await enrol(course.id, [email]).expect(200);
    const user = await register(email);
    const exported = await app.get(AccountService).export(user.id);
    expect(exported.courseInvites).toEqual([expect.objectContaining({ email, status: 'PENDING', invitedBy: 'academy team', course: expect.objectContaining({ slug: course.slug }) })]);
    // The admin's note is internal and never in the student's export.
    expect((exported.courseInvites as unknown[])[0]).not.toHaveProperty('note');

    // Deleting the account drops the unused invite at once (before it could be claimed).
    await app.get(AccountService).deleteAccount({ id: user.id, role: 'STUDENT', amr: 'pwd', authTime: new Date() }, password);
    expect(await prisma.courseInvite.count({ where: { email } })).toBe(0);

    // Enrolled invites go at anonymisation.
    const student = await createUser(app, prisma, { prefix: 'inv-anon' });
    await enrol(course.id, [student.email]).expect(200);
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
    await app.get(AccountService).anonymize(student.id);
    expect(await prisma.courseInvite.count({ where: { OR: [{ email: student.email }, { enrolledUserId: student.id }] } })).toBe(0);

    // Retention: unused invites older than 180 days are deleted; recent and enrolled ones stay.
    const old = uniqueEmail('inv-old');
    const recent = uniqueEmail('inv-recent');
    await enrol(course.id, [old, recent], { sendEmail: false }).expect(200);
    await prisma.courseInvite.updateMany({ where: { email: old }, data: { createdAt: new Date(Date.now() - 181 * 86_400_000) } });
    const r = await app.get(RetentionJobs).run();
    expect(r.invites).toBeGreaterThanOrEqual(1);
    expect(await prisma.courseInvite.count({ where: { email: old } })).toBe(0);
    expect(await prisma.courseInvite.count({ where: { email: recent } })).toBe(1);
  });
});
