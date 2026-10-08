import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { EventReminderJobs } from '../src/jobs/event-reminders.jobs';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createTestApp, createUser } from './helpers';

describe('live sessions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; template: EmailTemplate; bulk: boolean }[] = [];
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const mails = (name: EmailTemplate['name'], to?: string) => sent.filter((m) => m.template.name === name && (!to || m.to === to));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'ev-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template, opts) => {
      sent.push({ to, template, bulk: Boolean(opts?.bulk) });
      return true;
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  const input = (slug: string, over: Record<string, unknown> = {}) => ({
    slug,
    status: 'PUBLISHED',
    titleEn: 'MLOps AMA',
    titleAr: 'جلسة أسئلة MLOps',
    descriptionEn: 'Ask anything.',
    startsAt: minutes(30),
    durationMin: 60,
    language: 'BILINGUAL',
    platform: 'YOUTUBE_LIVE',
    liveUrl: 'https://youtube.com/live/SECRET',
    recordingUrl: 'https://youtube.com/watch?v=REC',
    capacity: 1,
    ...over,
  });
  const create = async (slug: string, over: Record<string, unknown> = {}) =>
    (await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(slug, over)).expect(201)).body as { id: string };
  const update = (id: string, slug: string, over: Record<string, unknown>) =>
    http().put(`/api/admin/events/${id}`).set('Cookie', admin.cookie).send(input(slug, over));
  const register = (slug: string, cookie: string) => http().post(`/api/events/${slug}/registration`).set('Cookie', cookie);

  it('lets admins publish a session that the public can see, without the live link', async () => {
    const slug = `ama-${Date.now()}`;
    const created = await create(slug);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(slug)).expect(409);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(`x-${slug}`, { titleAr: '' })).expect(400);
    // Publishing needs a join link, or registered people would wait for nothing.
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(`y-${slug}`, { liveUrl: '' })).expect(400);

    const list = await http().get('/api/events').expect(200);
    expect(list.body.upcoming.map((e: { slug: string }) => e.slug)).toContain(slug);
    expect(JSON.stringify(list.body)).not.toContain('SECRET');
    const detail = await http().get(`/api/events/${slug}`).expect(200);
    expect(detail.body.me).toBeUndefined();
    // Recordings stay hidden until the session has ended.
    expect(detail.body.recordingUrl).toBeNull();
    const ics = await http().get(`/api/events/${slug}/calendar.ics`).expect(200).expect('Content-Type', /text\/calendar/);
    expect(ics.text).not.toContain('SECRET');
    expect(ics.text).toContain(`UID:event-${created.id}@academy.mlopsmena.com\r\n`);
    const icsAr = await http().get(`/api/events/${slug}/calendar.ics?locale=ar`).expect(200);
    expect(icsAr.text).toContain('/ar/sessions/');

    // Signed in but not registered: no link, and the response is never cached.
    const stranger = await createUser(app, prisma, { prefix: 'ev-s' });
    const seen = await http().get(`/api/events/${slug}`).set('Cookie', stranger.cookie).expect(200);
    expect(seen.body.me).toMatchObject({ registered: false, liveUrl: null });
    expect(seen.headers['cache-control']).toBe('private, no-store');

    // Drafts stay private.
    await update(created.id, slug, { status: 'DRAFT' }).expect(200);
    await http().get(`/api/events/${slug}`).expect(404);
  });

  it('registers people up to capacity, reveals the link near the start, reminds once and confirms once', async () => {
    const slug = `reg-${Date.now()}`;
    const ev = await create(slug);
    const a = await createUser(app, prisma, { prefix: 'ev-a' });
    const b = await createUser(app, prisma, { prefix: 'ev-b' });
    const unverified = await createUser(app, prisma, { prefix: 'ev-u', verified: false });

    await http().post(`/api/events/${slug}/registration`).expect(401);
    await register(slug, unverified.cookie).expect(403);
    const r = await register(slug, a.cookie).expect(201);
    // Starts in 30 minutes: inside the default 60-minute reveal window.
    expect(r.body.me).toMatchObject({ registered: true, liveUrl: 'https://youtube.com/live/SECRET' });
    await register(slug, a.cookie).expect(201); // idempotent
    const mine = await http().get('/api/me/events').set('Cookie', a.cookie).expect(200);
    expect(mine.body.map((e: { slug: string }) => e.slug)).toContain(slug);
    expect((await http().get('/api/me/events').set('Cookie', b.cookie).expect(200)).body).toEqual([]);
    await http().get('/api/me/events').expect(401);
    const full = await register(slug, b.cookie).expect(409);
    expect(full.body.code).toBe('EVENT_FULL');

    const regs = await http().get(`/api/admin/events/${ev.id}/registrations`).set('Cookie', admin.cookie).expect(200);
    expect(regs.body.map((x: { email: string }) => x.email)).toEqual([a.email]);
    await http().get(`/api/admin/events/${ev.id}/registrations`).set('Cookie', a.cookie).expect(403);
    const csv = await http().get(`/api/admin/events/${ev.id}/registrations.csv`).set('Cookie', admin.cookie).expect(200);
    expect(csv.headers['cache-control']).toBe('private, no-store');

    const jobs = app.get(EventReminderJobs);
    expect(await jobs.run()).toBeGreaterThanOrEqual(1);
    await jobs.run();
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.id } })).toBe(1);

    // Unregistering and registering again doesn't send a second confirmation.
    await http().delete(`/api/events/${slug}/registration`).set('Cookie', a.cookie).expect(200);
    await register(slug, a.cookie).expect(201);
    const confirmations = mails('eventRegistered', a.email);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.bulk).toBe(false);
    expect(JSON.stringify(confirmations[0]!.template)).not.toContain('SECRET');
    expect(confirmations[0]!.template).toMatchObject({
      calendarUrl: expect.stringContaining('calendar.google.com'),
      icsUrl: expect.stringContaining('.ics'),
    });
  });

  it('refuses to delete a session people registered for, until it is cancelled', async () => {
    const slug = `del-${Date.now()}`;
    const ev = await create(slug);
    const a = await createUser(app, prisma, { prefix: 'ev-d' });
    await register(slug, a.cookie).expect(201);

    const refused = await http().delete(`/api/admin/events/${ev.id}`).set('Cookie', admin.cookie).expect(409);
    expect(refused.body.code).toBe('EVENT_HAS_REGISTRATIONS');
    await update(ev.id, slug, { status: 'CANCELLED' }).expect(200);
    await http().delete(`/api/admin/events/${ev.id}`).set('Cookie', admin.cookie).expect(204);
    await http().get(`/api/events/${slug}`).expect(404);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'event.deleted', entityId: ev.id } });
    expect(audit?.metadata).toMatchObject({ slug, status: 'CANCELLED', registrations: 1 });

    // An empty session can be deleted straight away.
    const empty = await create(`del2-${Date.now()}`);
    await http().delete(`/api/admin/events/${empty.id}`).set('Cookie', admin.cookie).expect(204);
  });

  it('tells registrants when a session is cancelled, and closes it', async () => {
    const slug = `cancel-${Date.now()}`;
    const ev = await create(slug, { capacity: null });
    const a = await createUser(app, prisma, { prefix: 'ev-c' });
    const late = await createUser(app, prisma, { prefix: 'ev-cl' });
    await register(slug, a.cookie).expect(201);
    sent = [];

    await update(ev.id, slug, { status: 'CANCELLED' }).expect(200);
    const notices = mails('eventCancelled');
    expect(notices.map((m) => m.to)).toEqual([a.email]);
    expect(notices[0]!.bulk).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'event.updated', entityId: ev.id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ status: { from: 'PUBLISHED', to: 'CANCELLED' } });

    const list = await http().get('/api/events').expect(200);
    expect(list.body.upcoming.map((e: { slug: string }) => e.slug)).not.toContain(slug);
    expect((await register(slug, late.cookie).expect(409)).body.code).toBe('EVENT_CLOSED');
    expect((await http().get(`/api/events/${slug}/calendar.ics`).expect(200)).text).toContain('STATUS:CANCELLED');
    // No link and no reminders for a cancelled session.
    expect((await http().get(`/api/events/${slug}`).set('Cookie', a.cookie).expect(200)).body.me.liveUrl).toBeNull();
    await app.get(EventReminderJobs).run();
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.id } })).toBe(0);
  });

  it('resets reminders and emails the new time when a session is rescheduled', async () => {
    const slug = `move-${Date.now()}`;
    const ev = await create(slug, { capacity: null });
    const a = await createUser(app, prisma, { prefix: 'ev-m' });
    await register(slug, a.cookie).expect(201);
    const jobs = app.get(EventReminderJobs);
    await jobs.run();
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.id } })).toBe(1);
    sent = [];

    // Moved three days out: the old reminder is forgotten and registrants hear about it.
    await update(ev.id, slug, { startsAt: minutes(3 * 24 * 60) }).expect(200);
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.id } })).toBe(0);
    const notices = mails('eventRescheduled', a.email);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.bulk).toBe(true);
    expect(notices[0]!.template).toMatchObject({
      calendarUrl: expect.stringContaining('calendar.google.com'),
      icsUrl: expect.stringContaining(slug),
    });
    expect(JSON.stringify(notices[0]!.template)).not.toContain('SECRET');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'event.updated', entityId: ev.id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ startsAt: { from: expect.any(String), to: expect.any(String) } });

    // Registered, but far from the start: no link yet.
    expect((await http().get(`/api/events/${slug}`).set('Cookie', a.cookie).expect(200)).body.me).toMatchObject({ registered: true, liveUrl: null });

    // Back to 40 minutes away: the 1-hour reminder goes out again for the new time.
    await update(ev.id, slug, { startsAt: minutes(40) }).expect(200);
    await jobs.run();
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.id, userId: a.id, kind: 'H1' } })).toBe(1);

    // Saving without a new time sends nothing.
    sent = [];
    const { startsAt } = await prisma.liveEvent.findUniqueOrThrow({ where: { id: ev.id } });
    await update(ev.id, slug, { startsAt: startsAt.toISOString(), titleEn: 'Renamed' }).expect(200);
    expect(mails('eventRescheduled')).toHaveLength(0);
  });

  it('frees the seats of deleted accounts and removes their registrations', async () => {
    const slug = `gone-${Date.now()}`;
    await create(slug, { startsAt: minutes(3 * 24 * 60) });
    const leaving = await createUser(app, prisma, { prefix: 'ev-g' });
    const next = await createUser(app, prisma, { prefix: 'ev-n' });
    await register(slug, leaving.cookie).expect(201);

    const exported = await http().get('/api/me/export').set('Cookie', leaving.cookie).expect(200);
    expect(exported.body.liveSessionRegistrations).toEqual([expect.objectContaining({ session: expect.objectContaining({ slug }) })]);

    // Soft-deleted (the 30-day window before anonymisation): the seat no longer counts.
    await prisma.user.update({ where: { id: leaving.id }, data: { deletedAt: new Date() } });
    expect((await http().get(`/api/events/${slug}`).expect(200)).body).toMatchObject({ registered: 0, full: false });
    await register(slug, next.cookie).expect(201);

    await app.get(AccountService).anonymize(leaving.id);
    expect(await prisma.eventRegistration.count({ where: { userId: leaving.id } })).toBe(0);
    expect(await prisma.eventConfirmation.count({ where: { userId: leaving.id } })).toBe(0);
  });

  it('lists only my upcoming public sessions, and keeps ended registrations', async () => {
    const me = await createUser(app, prisma, { prefix: 'ev-me' });
    const upcoming = `mine-${Date.now()}`;
    const draft = `mine-d-${Date.now()}`;
    const ended = `mine-e-${Date.now()}`;
    await create(upcoming, { capacity: null, startsAt: minutes(2 * 24 * 60) });
    const d = await create(draft, { capacity: null, startsAt: minutes(2 * 24 * 60) });
    const e = await create(ended, { capacity: null, startsAt: minutes(-180), durationMin: 60 });
    await register(upcoming, me.cookie).expect(201);
    await register(draft, me.cookie).expect(201);
    await update(d.id, draft, { status: 'DRAFT' }).expect(200);
    await prisma.eventRegistration.create({ data: { eventId: e.id, userId: me.id } });

    const mine = await http().get('/api/me/events').set('Cookie', me.cookie).expect(200);
    expect(mine.body.map((x: { slug: string }) => x.slug)).toEqual([upcoming]);
    // An ended session keeps its attendance record, and now shows its recording.
    expect((await http().delete(`/api/events/${ended}/registration`).set('Cookie', me.cookie).expect(409)).body.code).toBe('EVENT_CLOSED');
    expect((await http().get(`/api/events/${ended}`).expect(200)).body.recordingUrl).toBe('https://youtube.com/watch?v=REC');
    expect((await register(ended, me.cookie).expect(409)).body.code).toBe('EVENT_CLOSED');
  });

  it('never oversells the last seat', async () => {
    const slug = `race-${Date.now()}`;
    await create(slug, { startsAt: minutes(3 * 24 * 60) });
    const a = await createUser(app, prisma, { prefix: 'ev-r1' });
    const b = await createUser(app, prisma, { prefix: 'ev-r2' });
    const results = await Promise.all([register(slug, a.cookie), register(slug, b.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
