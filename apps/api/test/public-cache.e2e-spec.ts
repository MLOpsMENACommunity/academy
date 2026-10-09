import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PERSONAL_KEYS, PUBLIC_CACHE_CONTROL, PublicCache, SIGNED_IN_CACHE_CONTROL } from '../src/common/public-cache';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

/** Every key in a JSON body, at any depth. */
function keys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keys(v, out);
    }
  }
  return out;
}

describe('public catalog caching (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cache: PublicCache;
  const http = () => request(app.getHttpServer());
  const saved = process.env.PUBLIC_CACHE_TTL_S;
  const eventSlug = `cache-ev-${Date.now()}`;

  beforeAll(async () => {
    process.env.PUBLIC_CACHE_TTL_S = '30';
    ({ app, prisma } = await createTestApp());
    cache = app.get(PublicCache);
    await prisma.liveEvent.create({
      data: {
        slug: eventSlug,
        titleEn: 'Cache test session',
        descriptionEn: 'A session for the cache tests.',
        startsAt: new Date(Date.now() + 30 * 60_000),
        durationMin: 60,
        status: 'PUBLISHED',
        liveUrl: 'https://youtube.com/live/SECRET-CACHE',
      },
    });
  });
  afterAll(async () => {
    await prisma.liveEvent.deleteMany({ where: { slug: eventSlug } });
    await app.close();
    if (saved === undefined) delete process.env.PUBLIC_CACHE_TTL_S;
    else process.env.PUBLIC_CACHE_TTL_S = saved;
  });

  const PUBLIC_PATHS = () => ['/api/courses', '/api/courses/slugs', '/api/events', `/api/events/${eventSlug}`, '/api/speakers', '/api/recordings', '/api/settings/public'];

  it('marks anonymous public reads shared-cacheable, with no personal field in them', async () => {
    for (const path of PUBLIC_PATHS()) {
      const res = await http().get(path).expect(200);
      expect([path, res.headers['cache-control']]).toEqual([path, PUBLIC_CACHE_CONTROL]);
      expect(res.headers['set-cookie']).toBeUndefined();
      const found = [...keys(res.body)].filter((k) => PERSONAL_KEYS.has(k));
      expect([path, found]).toEqual([path, []]);
    }
    const ev = await http().get(`/api/events/${eventSlug}`).expect(200);
    expect(JSON.stringify(ev.body)).not.toContain('SECRET-CACHE');
  });

  it('answers repeated anonymous reads from the process cache', async () => {
    cache.clear();
    const before = cache.hits;
    await http().get('/api/courses').expect(200);
    const again = await http().get('/api/courses').expect(200);
    expect(cache.hits).toBe(before + 1);
    expect(again.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
  });

  it('never caches or shares a request with a session cookie, even an expired or bare one', async () => {
    const user = await createUser(app, prisma, { prefix: 'pc' });
    await prisma.eventRegistration.create({ data: { event: { connect: { slug: eventSlug } }, user: { connect: { id: user.id } } } });
    cache.clear();
    const hits = cache.hits;

    // Signed in: the viewer's own registration and join link, never public, never cached.
    const mine = await http().get(`/api/events/${eventSlug}`).set('Cookie', user.cookie).expect(200);
    expect(mine.body.me).toMatchObject({ registered: true, liveUrl: 'https://youtube.com/live/SECRET-CACHE' });
    expect(mine.headers['cache-control']).toBe('private, no-store');
    const again = await http().get(`/api/events/${eventSlug}`).set('Cookie', user.cookie).expect(200);
    expect(again.body.me.registered).toBe(true);

    // Same-for-everyone endpoints with a cookie: private, and not from the shared cache.
    for (const cookie of [user.cookie, 'has_session=1', 'access_token=expired-or-garbage', 'refresh_token=x']) {
      const res = await http().get('/api/courses').set('Cookie', cookie).expect(200);
      expect([cookie, res.headers['cache-control']]).toEqual([cookie, SIGNED_IN_CACHE_CONTROL]);
    }
    expect(cache.hits).toBe(hits);

    // ...and an anonymous read afterwards never sees the signed-in answer.
    const anon = await http().get(`/api/events/${eventSlug}`).expect(200);
    expect(anon.body.me).toBeUndefined();
    expect(JSON.stringify(anon.body)).not.toContain('SECRET-CACHE');
    expect(anon.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
  });

  it('an admin edit clears the cache at once', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'pc-admin' });
    const email = `support-${Date.now()}@example.test`;
    await http().get('/api/settings/public').expect(200);
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ supportEmail: email }).expect(200);
    const after = await http().get('/api/settings/public').expect(200);
    expect(after.body.supportEmail).toBe(email);
  });

  it('does not cache errors', async () => {
    cache.clear();
    await http().get('/api/courses/no-such-course-xyz').expect(404);
    const res = await http().get('/api/courses/no-such-course-xyz').expect(404);
    expect(res.headers['cache-control'] ?? '').not.toContain('s-maxage');
    expect(cache.size).toBe(0);
  });

  it('health: liveness without the database, readiness with it', async () => {
    const live = await http().get('/api/health/live').expect(200);
    expect(live.body.status).toBe('ok');
    expect(live.headers['cache-control']).toBe('no-store');
    const ready = await http().get('/api/health').expect(200);
    expect(ready.body).toMatchObject({ status: 'ok', db: 'ok' });
  });
});

describe('database pool exhausted (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const saved = { size: process.env.DATABASE_POOL_SIZE, timeout: process.env.DATABASE_POOL_TIMEOUT };

  beforeAll(async () => {
    process.env.DATABASE_POOL_SIZE = '1';
    process.env.DATABASE_POOL_TIMEOUT = '1';
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
    for (const [k, v] of [['DATABASE_POOL_SIZE', saved.size], ['DATABASE_POOL_TIMEOUT', saved.timeout]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('answers a fast 503 BUSY with Retry-After instead of hanging, and liveness stays up', async () => {
    expect(prisma.pool.connectionLimit).toBe(1);
    expect(prisma.pool.poolTimeoutS).toBe(1);
    // Hold the only connection for 3 s.
    const hold = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_sleep(3)`;
    }, { timeout: 10_000, maxWait: 5_000 });
    await new Promise((r) => setTimeout(r, 200));

    const started = Date.now();
    const res = await http().get('/api/courses/slugs');
    const took = Date.now() - started;
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ statusCode: 503, code: 'BUSY' });
    expect(res.headers['retry-after']).toBe('5');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(took).toBeLessThan(2_500); // the 1 s pool timeout, not Prisma's 10 s default

    // Liveness never touches the database.
    const liveStarted = Date.now();
    await http().get('/api/health/live').expect(200);
    expect(Date.now() - liveStarted).toBeLessThan(500);

    await hold;
    await http().get('/api/courses/slugs').expect(200);
  });
});
