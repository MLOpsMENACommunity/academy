import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EventReminderJobs } from '../src/jobs/event-reminders.jobs';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

describe('live sessions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'ev-admin' });
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
    startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    durationMin: 60,
    language: 'BILINGUAL',
    platform: 'YOUTUBE_LIVE',
    liveUrl: 'https://youtube.com/live/SECRET',
    capacity: 1,
    ...over,
  });

  it('lets admins publish a session that the public can see, without the live link', async () => {
    const slug = `ama-${Date.now()}`;
    const created = await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(slug)).expect(201);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(slug)).expect(409);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(`x-${slug}`, { titleAr: '' })).expect(400);
    const list = await http().get('/api/events').expect(200);
    expect(list.body.upcoming.map((e: { slug: string }) => e.slug)).toContain(slug);
    expect(JSON.stringify(list.body)).not.toContain('SECRET');
    const detail = await http().get(`/api/events/${slug}`).expect(200);
    expect(detail.body.me).toBeUndefined();
    await http().get(`/api/events/${slug}/calendar.ics`).expect(200).expect('Content-Type', /text\/calendar/);

    // Drafts stay private.
    await http().put(`/api/admin/events/${created.body.id}`).set('Cookie', admin.cookie).send(input(slug, { status: 'DRAFT' })).expect(200);
    await http().get(`/api/events/${slug}`).expect(404);
  });

  it('registers signed-in people up to capacity, reveals the link near the start, and reminds them once', async () => {
    const slug = `reg-${Date.now()}`;
    const ev = await http().post('/api/admin/events').set('Cookie', admin.cookie).send(input(slug)).expect(201);
    const a = await createUser(app, prisma, { prefix: 'ev-a' });
    const b = await createUser(app, prisma, { prefix: 'ev-b' });
    const unverified = await createUser(app, prisma, { prefix: 'ev-u', verified: false });

    await http().post(`/api/events/${slug}/registration`).expect(401);
    await http().post(`/api/events/${slug}/registration`).set('Cookie', unverified.cookie).expect(403);
    const r = await http().post(`/api/events/${slug}/registration`).set('Cookie', a.cookie).expect(201);
    // Starts in 30 minutes: inside the default 60-minute reveal window.
    expect(r.body.me).toMatchObject({ registered: true, liveUrl: 'https://youtube.com/live/SECRET' });
    await http().post(`/api/events/${slug}/registration`).set('Cookie', a.cookie).expect(201); // idempotent
    const mine = await http().get('/api/me/events').set('Cookie', a.cookie).expect(200);
    expect(mine.body.map((e: { slug: string }) => e.slug)).toContain(slug);
    expect((await http().get('/api/me/events').set('Cookie', b.cookie).expect(200)).body).toEqual([]);
    await http().get('/api/me/events').expect(401);
    const full = await http().post(`/api/events/${slug}/registration`).set('Cookie', b.cookie).expect(409);
    expect(full.body.code).toBe('EVENT_FULL');

    const regs = await http().get(`/api/admin/events/${ev.body.id}/registrations`).set('Cookie', admin.cookie).expect(200);
    expect(regs.body.map((x: { email: string }) => x.email)).toEqual([a.email]);
    await http().get(`/api/admin/events/${ev.body.id}/registrations`).set('Cookie', a.cookie).expect(403);

    const jobs = app.get(EventReminderJobs);
    expect(await jobs.run()).toBeGreaterThanOrEqual(1);
    await jobs.run();
    expect(await prisma.eventReminderLog.count({ where: { eventId: ev.body.id } })).toBe(1);

    await http().delete(`/api/events/${slug}/registration`).set('Cookie', a.cookie).expect(200);
    await http().post(`/api/events/${slug}/registration`).set('Cookie', b.cookie).expect(201);
    await http().delete(`/api/admin/events/${ev.body.id}`).set('Cookie', admin.cookie).expect(204);
    await http().get(`/api/events/${slug}`).expect(404);
  });
});
