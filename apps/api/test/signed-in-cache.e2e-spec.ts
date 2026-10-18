import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { SignedInCache } from '../src/common/signed-in-cache';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/**
 * The signed-in cache (common/signed-in-cache.ts) with its production setting on: reads reuse
 * the account check and the course for a few seconds, and any write request empties it, so
 * revoking access still applies on the very next request.
 */
describe('signed-in cache (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cache: SignedInCache;
  const http = () => request(app.getHttpServer());
  const saved = process.env.SIGNED_IN_CACHE_TTL_S;

  beforeAll(async () => {
    process.env.SIGNED_IN_CACHE_TTL_S = '15';
    ({ app, prisma } = await createTestApp());
    cache = app.get(SignedInCache);
  });
  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.SIGNED_IN_CACHE_TTL_S;
    else process.env.SIGNED_IN_CACHE_TTL_S = saved;
  });

  async function enrolled() {
    const course = await createCourse(prisma);
    const student = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    return { course, student };
  }

  it('reads reuse the course and the account check until a write', async () => {
    const { course, student } = await enrolled();
    expect((await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200)).body.titleEn).toBe('Test course');
    expect(cache.size).toBeGreaterThanOrEqual(2);

    // Changed behind the API's back (a script, psql): reads keep the cached course for now...
    await prisma.course.update({ where: { id: course.id }, data: { titleEn: 'Renamed' } });
    expect((await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200)).body.titleEn).toBe('Test course');

    // ...and any write request empties the cache: the next read sees the change.
    await http().put(`/api/learn/${course.slug}/reminders`).set('Cookie', student.cookie).send({ emailReminders: false }).expect(204);
    expect(cache.size).toBe(0);
    expect((await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200)).body.titleEn).toBe('Renamed');
  });

  it('a write always checks the account in the database', async () => {
    const { course, student } = await enrolled();
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200);
    // Deleted behind the API's back: a read may still pass for a few seconds, a write never does.
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
    await http().put(`/api/learn/${course.slug}/reminders`).set('Cookie', student.cookie).send({ emailReminders: false }).expect(401);
  });

  it('removing an admin applies on their next request', async () => {
    const boss = await createUser(app, prisma, { role: 'ADMIN', prefix: 'sic-boss' });
    const a = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'sic-admin' });
    await http().get('/api/admin/students').set('Cookie', a.cookie).expect(200);
    await http().get('/api/admin/students').set('Cookie', a.cookie).expect(200);
    await http().post(`/api/admin/team/${a.id}/remove`).set('Cookie', boss.cookie).expect(200);
    await http().get('/api/admin/students').set('Cookie', a.cookie).expect(403);
  });

  it('deleting an account ends its session on the next request', async () => {
    const boss = await createUser(app, prisma, { role: 'ADMIN', prefix: 'sic-boss' });
    const { course, student } = await enrolled();
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200);
    await http().post(`/api/admin/students/${student.id}/delete`).set('Cookie', boss.cookie).send({ confirm: student.email }).expect(200);
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(401);
  });

  it('a newer token than the cached account is checked against the database', async () => {
    const { course, student } = await enrolled();
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(200);
    // Sessions ended elsewhere (outside a request), then a fresh sign-in: the new token works at once.
    const user = await prisma.user.update({ where: { id: student.id }, data: { tokenVersion: { increment: 1 } } });
    const { TokensService } = await import('../src/auth/tokens.service');
    const fresh = `access_token=${await app.get(TokensService).signAccess(user)}`;
    await http().get(`/api/learn/${course.slug}`).set('Cookie', fresh).expect(200);
    // And the old one, now that the database was asked, no longer does.
    await http().get(`/api/learn/${course.slug}`).set('Cookie', student.cookie).expect(401);
  });
});
