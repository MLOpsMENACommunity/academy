import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { FEED_MISSES_PER_MIN, FEED_POLLS_PER_MIN } from '../src/calendar/calendar-feed.controller';
import { AccountService } from '../src/users/account.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const DAY = 24 * 3600_000;

describe('calendar feed (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  /** The feed path as the API sees it (WEB_URL + /api/calendar/<token>.ics). */
  const pathOf = (url: string) => new URL(url).pathname;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  async function courseWithSession(title: string, liveUrl: string) {
    const course = await createCourse(prisma);
    const session = await prisma.courseSession.create({
      data: { courseId: course.id, order: 1, titleEn: title, titleAr: `${title} ع`, startsAt: new Date(Date.now() + 3 * DAY), durationMin: 60, liveUrl, recordingUrl: 'https://youtu.be/dQw4w9WgXcQ', materials: [{ labelEn: 'Slides', labelAr: 'شرائح', url: 'https://drive.google.com/private-slides' }] },
    });
    return { course, session };
  }

  it('requires a session to manage the link', async () => {
    await http().get('/api/me/calendar-feed').expect(401);
    await http().post('/api/me/calendar-feed').expect(401);
  });

  it('creates a link once, shows it again, and rotation kills the old URL', async () => {
    const student = await createUser(app, prisma);
    expect((await http().get('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body).toMatchObject({ exists: false, url: null });

    const created = await http().post('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const url: string = created.body.url;
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    // Idempotent: a second create (e.g. a double click) keeps the same link.
    expect((await http().post('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body.url).toBe(url);
    expect((await http().get('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body).toMatchObject({ exists: true, url });

    // Only the hash is stored.
    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { userId: student.id } });
    const token = url.split('/').pop()!.replace('.ics', '');
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    await http().get(pathOf(url)).expect(200);
    const rotated = await http().post('/api/me/calendar-feed?rotate=1').set('Cookie', student.cookie).expect(200);
    expect(rotated.body.url).not.toBe(url);
    await http().get(pathOf(url)).expect(404);
    await http().get(pathOf(rotated.body.url)).expect(200);
  });

  it('serves enrolled courses only, without join links or private material', async () => {
    const student = await createUser(app, prisma);
    const mine = await courseWithSession('Mine', 'https://meet.google.com/mine-secret');
    const other = await courseWithSession('NotMine', 'https://meet.google.com/other-secret');
    const draft = await courseWithSession('Draft', 'https://youtube.com/live/draft-secret');
    await prisma.course.update({ where: { id: draft.course.id }, data: { status: 'DRAFT' } });
    await prisma.enrollment.createMany({ data: [{ userId: student.id, courseId: mine.course.id }, { userId: student.id, courseId: draft.course.id }] });

    const { url } = (await http().post('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body as { url: string };
    // Calendar apps fetch without cookies.
    const res = await http().get(pathOf(url)).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    expect(res.headers['cache-control']).toBe('private, max-age=900');
    const ics = res.text.replace(/\r\n /g, '');
    expect(ics).toContain('X-WR-CALNAME:MLOps MENA Academy');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
    expect(ics).toContain('X-PUBLISHED-TTL:PT6H');
    expect(ics).toContain(`UID:${mine.session.id}@academy.mlopsmena.com`);
    expect(ics).toMatch(/SEQUENCE:\d+/);
    expect(ics).toMatch(/LAST-MODIFIED:\d{8}T\d{6}Z/);
    expect(ics).toContain(`URL:http://localhost:3000/en/learn/${mine.course.slug}#session-1`);
    expect(ics).toContain('Mine');
    expect(ics).not.toContain('NotMine');
    expect(ics).not.toContain(other.session.id);
    expect(ics).not.toContain(draft.session.id);
    expect(ics).not.toContain('Draft');
    for (const secret of ['meet.google.com', 'youtube.com/live', 'youtu.be', 'private-slides', 'secret']) expect(ics).not.toContain(secret);

    // A reschedule shows up with a newer SEQUENCE; a deleted session disappears.
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)![1]);
    await new Promise((r) => setTimeout(r, 1100));
    await prisma.courseSession.update({ where: { id: mine.session.id }, data: { startsAt: new Date(Date.now() + 4 * DAY) } });
    const after = (await http().get(pathOf(url)).expect(200)).text;
    expect(seq(after)).toBeGreaterThan(seq(ics));
    await prisma.courseSession.delete({ where: { id: mine.session.id } });
    expect((await http().get(pathOf(url)).expect(200)).text).not.toContain(mine.session.id);
    expect((await prisma.calendarFeed.findUniqueOrThrow({ where: { userId: student.id } })).lastFetchedAt).not.toBeNull();
  });

  it('returns 404 for unknown or malformed tokens', async () => {
    await http().get(`/api/calendar/${'A'.repeat(43)}.ics`).expect(404);
    await http().get('/api/calendar/short.ics').expect(404);
    await http().get(`/api/calendar/${'A'.repeat(43)}`).expect(404);
  });

  it('removes the link when the account is deleted, and leaves it out of the export', async () => {
    const student = await createUser(app, prisma);
    const { url } = (await http().post('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body as { url: string };
    const exported = await http().get('/api/me/export').set('Cookie', student.cookie).expect(200);
    const dump = JSON.stringify(exported.body);
    expect(exported.body.calendarFeed).toMatchObject({ createdAt: expect.any(String) });
    expect(dump).not.toContain(url.split('/').pop()!.replace('.ics', ''));
    expect(dump).not.toContain('tokenHash');

    // Users created by the helper have no password; a fresh Google session passes re-auth.
    await app.get(AccountService).deleteAccount({ id: student.id, role: 'STUDENT', amr: 'google', authTime: new Date() }, undefined);
    expect(await prisma.calendarFeed.findUnique({ where: { userId: student.id } })).toBeNull();
    await http().get(pathOf(url)).expect(404);
  });

  it('a new server key revokes every existing link at once', async () => {
    const student = await createUser(app, prisma);
    const { url } = (await http().post('/api/me/calendar-feed').set('Cookie', student.cookie).expect(200)).body as { url: string };
    await http().get(pathOf(url)).expect(200);

    const previous = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = 'rotated-key-for-the-calendar-feed-e2e-0123456789';
    const rotated = await createTestApp();
    try {
      const http2 = () => request(rotated.app.getHttpServer());
      // The stored hash still matches the old token, but its HMAC no longer verifies.
      await http2().get(pathOf(url)).expect(404);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
      const cookie = `access_token=${await rotated.app.get(TokensService).signAccess(user)}`;
      const fresh = (await http2().get('/api/me/calendar-feed').set('Cookie', cookie).expect(200)).body as { url: string };
      expect(fresh.url).not.toBe(url);
      await http2().get(pathOf(fresh.url)).expect(200);
      await http2().get(pathOf(url)).expect(404);
    } finally {
      await rotated.app.close();
      if (previous === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previous;
    }
  });

  // Last: these use up the rate-limit windows of this app instance.
  it('limits polls per token, not per IP', async () => {
    const [a, b] = await Promise.all([createUser(app, prisma), createUser(app, prisma)]);
    const urlA = (await http().post('/api/me/calendar-feed').set('Cookie', a.cookie).expect(200)).body.url as string;
    const urlB = (await http().post('/api/me/calendar-feed').set('Cookie', b.cookie).expect(200)).body.url as string;
    for (let i = 0; i < FEED_POLLS_PER_MIN; i++) await http().get(pathOf(urlA)).expect(200);
    await http().get(pathOf(urlA)).expect(429);
    // Same IP, other feed: unaffected.
    await http().get(pathOf(urlB)).expect(200);
  });

  it('limits unknown tokens per IP', async () => {
    let last = 0;
    for (let i = 0; i <= FEED_MISSES_PER_MIN; i++) last = (await http().get(`/api/calendar/${'B'.repeat(42)}${i % 10}.ics`)).status;
    expect(last).toBe(429);
  });
});
