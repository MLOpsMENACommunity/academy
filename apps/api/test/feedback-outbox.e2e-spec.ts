import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailSendError, EmailTransport, type EmailMessage, type SendOptions } from '../src/email/email.transport';
import { FeedbackPromptJobs } from '../src/learn/feedback-prompts.jobs';
import { EmailPreferenceLinks } from '../src/outbox/email-links';
import { nextUtcDay, OutboxProcessor } from '../src/outbox/outbox.processor';
import { Outbox } from '../src/outbox/outbox.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The durable email outbox (lease, idempotency key, error classes, retention) and the
 * "How was the session?" prompts that are its first user.
 */
describe('feedback prompts and the email outbox (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let processor: OutboxProcessor;
  let sent: { m: EmailMessage; o?: SendOptions }[] = [];
  let sendImpl: (m: EmailMessage, o?: SendOptions) => Promise<void>;
  const token = 'f'.repeat(40);
  const http = () => request(app.getHttpServer());
  const tick = () => http().post('/api/internal/jobs/tick').set('x-jobs-token', token).expect(200);
  /** The tick starts sending after it answers; this waits for that run (and joins it). */
  const drained = () => processor.process();
  const to = (email: string) => sent.filter((s) => s.m.to === email);

  beforeAll(async () => {
    process.env.JOBS_TOKEN = token;
    ({ app, prisma } = await createTestApp());
    processor = app.get(OutboxProcessor);
    await drained();
    jest.spyOn(app.get(EmailTransport), 'send').mockImplementation((m, o) => sendImpl(m, o));
  });
  beforeEach(() => {
    sent = [];
    sendImpl = async (m, o) => {
      sent.push({ m, o });
    };
  });
  afterAll(async () => {
    delete process.env.JOBS_TOKEN;
    await app.close();
  });

  /** A course whose session 1 ended 2 hours ago; session 2 (the last) is next week. */
  async function setup(opts: { lastEnded?: boolean } = {}) {
    const course = await createCourse(prisma);
    const now = Date.now();
    const s1 = await prisma.courseSession.create({
      data: { courseId: course.id, order: 1, titleEn: 'Feature stores', titleAr: 'مخازن الميزات', startsAt: new Date(now - 3.5 * HOUR), durationMin: 90 },
    });
    const s2 = await prisma.courseSession.create({
      data: {
        courseId: course.id,
        order: 2,
        titleEn: 'Serving',
        titleAr: 'الخدمة',
        startsAt: opts.lastEnded ? new Date(now - 2.5 * HOUR) : new Date(now + 7 * 24 * HOUR),
        durationMin: 90,
      },
    });
    const student = async (prefix: string, extra: { enrolledAt?: Date } = {}) => {
      const u = await createUser(app, prisma, { prefix });
      await prisma.enrollment.create({ data: { userId: u.id, courseId: course.id, ...(extra.enrolledAt ? { enrolledAt: extra.enrolledAt } : {}) } });
      return u;
    };
    return { course, s1, s2, student };
  }

  const rows = (sessionId: string) => prisma.outboundEmail.findMany({ where: { dedupeKey: { startsWith: `feedback:${sessionId}:` } }, orderBy: { createdAt: 'asc' } });
  const prompts = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'feedback.prompt' } });

  it('asks each eligible student once after a session: one outbox row (sent) and one notification, nothing more on the next tick', async () => {
    const { course, s1, student } = await setup();
    const [ana, ben] = [await student('fb-ana'), await student('fb-ben')];
    const late = await student('fb-late', { enrolledAt: new Date() }); // enrolled after it ended
    const rated = await student('fb-rated');
    await prisma.sessionFeedback.create({ data: { userId: rated.id, courseId: course.id, sessionId: s1.id, scopeKey: s1.id, rating: 5 } });
    const gone = await student('fb-gone');
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const staff = await createUser(app, prisma, { role: 'ADMIN', prefix: 'fb-admin' });
    await prisma.enrollment.create({ data: { userId: staff.id, courseId: course.id, enrolledAt: new Date(Date.now() - 5 * HOUR) } });
    await prisma.enrollment.updateMany({ where: { courseId: course.id, userId: { in: [ana.id, ben.id, rated.id, gone.id] } }, data: { enrolledAt: new Date(Date.now() - 24 * HOUR) } });

    const res = await tick();
    expect(res.body).toMatchObject({ feedbackPromptsQueued: expect.any(Number), outboxPending: expect.any(Number), outboxPurged: expect.any(Number) });
    await drained();

    const queued = await rows(s1.id);
    expect(queued.map((r) => r.userId).sort()).toEqual([ana.id, ben.id].sort());
    for (const r of queued) expect(r).toMatchObject({ status: 'SENT', attempts: 1, category: 'feedback', lane: 'bulk', courseId: course.id, sentAt: expect.any(Date) });
    for (const u of [ana, ben]) {
      expect(await prompts(u.id)).toEqual([expect.objectContaining({ titleEn: 'How was session 1?', link: `/learn/${course.slug}#session-1-feedback` })]);
      const mails = to(u.email);
      expect(mails).toHaveLength(1);
      const row = queued.find((r) => r.userId === u.id)!;
      // The row id is the provider's idempotency key; bulk mail carries one-click unsubscribe headers.
      expect(mails[0]!.o).toEqual({ idempotencyKey: `outbox/${row.id}` });
      expect(mails[0]!.m.subject).toBe('How was "Feature stores"? Rate it in 10 seconds');
      expect(mails[0]!.m.html).toContain(`/en/learn/${course.slug}#session-1-feedback`);
      expect(mails[0]!.m.html).not.toMatch(/today|tonight/i);
      expect(mails[0]!.m.headers).toEqual({
        'List-Unsubscribe': expect.stringMatching(/^<http:\/\/localhost:3000\/api\/email\/unsubscribe\?token=f\..+>$/),
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      });
    }
    for (const u of [late, rated, gone, staff]) {
      expect(await prompts(u.id)).toHaveLength(0);
      expect(to(u.email)).toHaveLength(0);
    }

    // The next tick (and a direct run) changes nothing.
    sent = [];
    await tick();
    await app.get(FeedbackPromptJobs).run();
    await drained();
    expect(await rows(s1.id)).toHaveLength(2);
    expect(await prompts(ana.id)).toHaveLength(1);
    expect(to(ana.email)).toHaveLength(0);
  });

  it('only asks inside the window: from 30 minutes to 72 hours after the session ends', async () => {
    const { s1, student } = await setup();
    const u = await student('fb-window', { enrolledAt: new Date(Date.now() - 48 * HOUR) });
    const jobs = app.get(FeedbackPromptJobs);
    const end = s1.startsAt.getTime() + 90 * MIN;
    expect(await jobs.run(new Date(end + 20 * MIN))).toBe(0);
    expect(await jobs.run(new Date(end + 73 * HOUR))).toBe(0);
    expect(await rows(s1.id)).toHaveLength(0);
    await jobs.run(new Date(end + 71 * HOUR));
    expect((await rows(s1.id)).map((r) => r.userId)).toEqual([u.id]);
  });

  it('asks for the session and the course in one email at the last session', async () => {
    const { course, s2, student } = await setup({ lastEnded: true });
    const u = await student('fb-last', { enrolledAt: new Date(Date.now() - 24 * HOUR) });
    await prisma.user.update({ where: { id: u.id }, data: { locale: 'ar' } });
    await app.get(FeedbackPromptJobs).run();
    await drained();
    const [row] = await rows(s2.id);
    expect(row).toMatchObject({ status: 'SENT', locale: 'ar' });
    expect(row!.template).toMatchObject({
      name: 'feedbackPrompt',
      sessionTitle: 'الخدمة',
      url: `http://localhost:3000/ar/learn/${course.slug}#session-2-feedback`,
      courseUrl: `http://localhost:3000/ar/learn/${course.slug}#course-feedback`,
    });
    // Session 1 ended too (its own prompt); the last session's email is the combined one.
    const mail = to(u.email).find((x) => x.m.subject.includes('الخدمة'));
    expect(mail!.m.subject).toBe('كيف كانت «الخدمة» ودورة دورة تجريبية؟');
    expect(mail!.m.html).toContain('#course-feedback');
    expect((await prompts(u.id)).find((n) => n.link?.endsWith('#session-2-feedback'))?.bodyEn).toContain('the last session');
  });

  it('turns feedback emails off with the tokened link, without signing in; in-app prompts continue', async () => {
    const { course, s1, s2, student } = await setup();
    const u = await student('fb-optout', { enrolledAt: new Date(Date.now() - 24 * HOUR) });
    const links = app.get(EmailPreferenceLinks);
    const t = links.token('feedback', u.id, course.id);

    // The footer link in the email is the page; peeking changes nothing (mail scanners open links).
    await app.get(FeedbackPromptJobs).run();
    await drained();
    const [first] = await rows(s1.id);
    expect((first!.template as { unsubscribeUrl: string }).unsubscribeUrl).toBe(`http://localhost:3000/en/unsubscribe?token=${encodeURIComponent(t)}`);
    expect((await http().get(`/api/email/unsubscribe?token=${encodeURIComponent(t)}`).expect(200)).body).toEqual({
      kind: 'feedback',
      course: { slug: course.slug, titleEn: 'Test course', titleAr: 'دورة تجريبية' },
      subscribed: true,
    });

    // Bad, tampered and other-kind tokens.
    await http().get('/api/email/unsubscribe?token=nope').expect(404);
    await http().post(`/api/email/unsubscribe?token=${encodeURIComponent(t.slice(0, -2) + 'xx')}`).expect(404);
    await http().post('/api/email/unsubscribe').send({ token: t.replace(course.id, s1.id) }).expect(404);

    // A mail app's one-click POST: token in the query, a form body that isn't parsed, no cookie, no Origin.
    const res = await http()
      .post(`/api/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('List-Unsubscribe=One-Click')
      .expect(200);
    expect(res.body.subscribed).toBe(false);
    expect(await prisma.reminderPreference.findUnique({ where: { userId_courseId: { userId: u.id, courseId: course.id } } })).toMatchObject({ feedbackEmails: false, emailReminders: true });

    // The next session: the in-app prompt still comes, the email is recorded as skipped.
    await prisma.courseSession.update({ where: { id: s2.id }, data: { startsAt: new Date(Date.now() - 2.5 * HOUR) } });
    sent = [];
    await app.get(FeedbackPromptJobs).run();
    await drained();
    expect(await rows(s2.id)).toEqual([expect.objectContaining({ userId: u.id, status: 'SKIPPED', lastError: 'opted_out' })]);
    expect(await prompts(u.id)).toHaveLength(2);
    expect(to(u.email)).toHaveLength(0);

    // Opting out after an email was queued stops it too (checked again at send time).
    const other = await setup();
    const v = await other.student('fb-late-optout', { enrolledAt: new Date(Date.now() - 24 * HOUR) });
    await prisma.$transaction(async (tx) => {
      await app.get(Outbox).enqueue(
        [{ userId: v.id, locale: 'en', category: 'feedback', courseId: other.course.id, dedupeKey: `test-optout:${v.id}`, template: { name: 'verifyEmail', url: 'http://x' } }],
        tx,
      );
      await tx.reminderPreference.create({ data: { userId: v.id, courseId: other.course.id, feedbackEmails: false } });
    });
    await drained();
    expect(await prisma.outboundEmail.findUnique({ where: { dedupeKey: `test-optout:${v.id}` } })).toMatchObject({ status: 'SKIPPED', lastError: 'opted_out' });

    // "Turn them back on" from the page.
    expect((await http().post('/api/email/unsubscribe/undo').send({ token: t }).expect(200)).body.subscribed).toBe(true);
    expect((await prisma.reminderPreference.findUniqueOrThrow({ where: { userId_courseId: { userId: u.id, courseId: course.id } } })).feedbackEmails).toBe(true);
  });

  // ------------------------------------------------------------------ outbox mechanics

  async function queued(prefix: string, extra: Record<string, unknown> = {}) {
    const u = await createUser(app, prisma, { prefix });
    const row = await prisma.outboundEmail.create({
      data: { userId: u.id, locale: 'en', category: 'test', dedupeKey: `test:${prefix}:${u.id}`, template: { name: 'verifyEmail', url: 'http://localhost:3000/x' }, ...extra },
    });
    return { u, row };
  }
  const reload = (id: string) => prisma.outboundEmail.findUniqueOrThrow({ where: { id } });

  it('recovers a row whose run died mid-send, and the provider sees the same idempotency key (no double send)', async () => {
    // An idempotent provider, like Resend: a second request with a key it has seen delivers nothing.
    const seen = new Set<string>();
    const inbox: EmailMessage[] = [];
    sendImpl = async (m, o) => {
      sent.push({ m, o });
      const key = o?.idempotencyKey;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      inbox.push(m);
    };
    // A run claimed this row, handed it to the provider, then the container died before marking it SENT.
    const { u, row } = await queued('lease-dead', { status: 'SENDING', attempts: 1, leaseUntil: new Date(Date.now() + 5 * MIN) });
    await app.get(EmailTransport).send({ to: u.email, subject: 's', html: 'h', text: 't' }, { idempotencyKey: `outbox/${row.id}` });
    // Another row is held by a run that is still alive (lease in the future).
    const { u: busy, row: held } = await queued('lease-live', { status: 'SENDING', attempts: 1, leaseUntil: new Date(Date.now() + 5 * MIN) });

    await drained();
    expect(await reload(row.id)).toMatchObject({ status: 'SENDING' }); // lease not expired yet: left alone
    expect(await reload(held.id)).toMatchObject({ status: 'SENDING' });

    await prisma.outboundEmail.update({ where: { id: row.id }, data: { leaseUntil: new Date(Date.now() - MIN) } });
    await drained();
    expect(await reload(row.id)).toMatchObject({ status: 'SENT', attempts: 2, leaseUntil: null });
    // Sent again after the crash, with the same key: the student still gets one email.
    expect(to(u.email).map((s) => s.o?.idempotencyKey)).toEqual([`outbox/${row.id}`, `outbox/${row.id}`]);
    expect(inbox.filter((m) => m.to === u.email)).toHaveLength(1);
    expect(to(busy.email)).toHaveLength(0);
    expect(await reload(held.id)).toMatchObject({ status: 'SENDING', attempts: 1 });
    await prisma.outboundEmail.delete({ where: { id: held.id } });
  });

  it('two runs at once never send a row twice (one claim each)', async () => {
    const items = await Promise.all([1, 2, 3].map((i) => queued(`race-${i}`)));
    await Promise.all([processor.process(), processor.process(), processor.process()]);
    for (const { u, row } of items) {
      expect(to(u.email)).toHaveLength(1);
      expect(await reload(row.id)).toMatchObject({ status: 'SENT', attempts: 1 });
    }
  });

  it('sorts failures: permanent → FAILED, quota → tomorrow, transient → retried with backoff, then FAILED', async () => {
    const perm = await queued('err-perm');
    sendImpl = async () => {
      throw new EmailSendError('validation_error', 422);
    };
    await drained();
    expect(await reload(perm.row.id)).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'validation_error' });

    const quota = await queued('err-quota');
    sendImpl = async () => {
      throw new EmailSendError('daily_quota_exceeded', 429);
    };
    await drained();
    const q = await reload(quota.row.id);
    expect(q).toMatchObject({ status: 'PENDING', attempts: 0, lastError: 'daily_quota_exceeded' });
    expect(q.notBefore.getTime()).toBe(nextUtcDay().getTime());

    await prisma.outboundEmail.update({ where: { id: quota.row.id }, data: { status: 'SKIPPED' } });
    const flaky = await queued('err-flaky');
    sendImpl = async () => {
      throw new EmailSendError('internal_server_error', 500);
    };
    await drained();
    const f1 = await reload(flaky.row.id);
    expect(f1).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(f1.notBefore.getTime()).toBeGreaterThan(Date.now() + 4 * MIN);
    // Due again (as if 5 minutes passed), still failing: third attempt is the last.
    for (const attempt of [2, 3]) {
      await prisma.outboundEmail.update({ where: { id: flaky.row.id }, data: { notBefore: new Date(Date.now() - 1000) } });
      await drained();
      expect(await reload(flaky.row.id)).toMatchObject({ attempts: attempt, status: attempt < 3 ? 'PENDING' : 'FAILED' });
    }
  });

  it('skips a deleted account at send time and never stores the address', async () => {
    const { u, row } = await queued('deleted');
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    await drained();
    expect(await reload(row.id)).toMatchObject({ status: 'SKIPPED', lastError: 'account_deleted' });
    expect(to(u.email)).toHaveLength(0);
    expect(JSON.stringify(await reload(row.id))).not.toContain(u.email);
  });

  it('enqueuing the same key twice is a no-op; old finished rows are purged', async () => {
    const u = await createUser(app, prisma, { prefix: 'dedupe' });
    const msg = { userId: u.id, locale: 'en' as const, category: 'feedback' as const, dedupeKey: `test-dupe:${u.id}`, template: { name: 'verifyEmail' as const, url: 'http://x' } };
    const outbox = app.get(Outbox);
    expect([...(await outbox.enqueue([msg]))]).toEqual([msg.dedupeKey]);
    expect([...(await outbox.enqueue([msg]))]).toEqual([]);
    await drained();
    expect(to(u.email)).toHaveLength(1);

    const old = new Date(Date.now() - 8 * 24 * HOUR);
    const veryOld = new Date(Date.now() - 31 * 24 * HOUR);
    const [a, b, c] = await Promise.all([
      queued('purge-sent', { status: 'SENT', createdAt: old }),
      queued('purge-failed-recent', { status: 'FAILED', createdAt: old }),
      queued('purge-failed-old', { status: 'FAILED', createdAt: veryOld }),
    ]);
    expect(await processor.purge()).toBeGreaterThanOrEqual(2);
    expect(await prisma.outboundEmail.findUnique({ where: { id: a.row.id } })).toBeNull();
    expect(await prisma.outboundEmail.findUnique({ where: { id: b.row.id } })).not.toBeNull();
    expect(await prisma.outboundEmail.findUnique({ where: { id: c.row.id } })).toBeNull();
  });

  // ------------------------------------------------------------------ dashboard card

  it('"Rate your last session": the latest ended, unrated session per course, computed on load', async () => {
    const { course, s1, s2, student } = await setup();
    const u = await student('fb-card', { enrolledAt: new Date(Date.now() - 24 * HOUR) });
    const card = async () => (await http().get('/api/me/feedback-due').set('Cookie', u.cookie).expect(200)).body;
    expect(await card()).toEqual([
      expect.objectContaining({ courseSlug: course.slug, sessionId: s1.id, order: 1, titleEn: 'Feature stores', courseFeedbackDue: false }),
    ]);
    await http().put(`/api/learn/${course.slug}/feedback`).set('Cookie', u.cookie).send({ sessionId: s1.id, rating: 4 }).expect(204);
    expect(await card()).toEqual([]);
    // The last session ends: rating it and the course is due.
    await prisma.courseSession.update({ where: { id: s2.id }, data: { startsAt: new Date(Date.now() - 2 * HOUR) } });
    expect(await card()).toEqual([expect.objectContaining({ sessionId: s2.id, courseFeedbackDue: true })]);
    await http().get('/api/me/feedback-due').expect(401);
  });
});
