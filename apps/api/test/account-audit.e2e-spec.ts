import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { RESET_MAX_PER_WINDOW } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { randomToken, sha256 } from '../src/common/crypto';
import { cookieHeader, createTestApp, uniqueEmail } from './helpers';

/** Regressions from the accounts / public site audit (October 2026). */
describe('accounts audit (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function register(email = uniqueEmail('audit')): Promise<{ email: string; cookie: string; id: string }> {
    const res = await http().post('/api/auth/register').send({ email, password }).expect(201);
    return { email, cookie: cookieHeader(res.headers['set-cookie'] as unknown as string[]), id: res.body.id as string };
  }

  it('sends at most one password reset email a minute per account, whatever the IP (ACC-01)', async () => {
    const { email, id } = await register();
    for (let i = 0; i < 3; i++) {
      // Same answer every time: the response never says whether an email went out.
      await http().post('/api/auth/forgot-password').send({ email, locale: 'en' }).expect(200, { ok: true });
    }
    expect(await prisma.passwordResetToken.count({ where: { userId: id } })).toBe(1);
  });

  it('caps password reset emails per account per hour (ACC-01)', async () => {
    const { email, id } = await register();
    // Earlier requests this hour, each more than a minute apart.
    await prisma.passwordResetToken.createMany({
      data: Array.from({ length: RESET_MAX_PER_WINDOW }, (_, i) => ({
        userId: id,
        tokenHash: `audit-${id}-${i}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(Date.now() - (i + 2) * 5 * 60_000),
      })),
    });
    await http().post('/api/auth/forgot-password').send({ email, locale: 'en' }).expect(200, { ok: true });
    expect(await prisma.passwordResetToken.count({ where: { userId: id } })).toBe(RESET_MAX_PER_WINDOW);
  });

  it('a used verification link opened again by its own, verified account succeeds; anyone else gets TOKEN_INVALID (ACC-07)', async () => {
    const owner = await register();
    const other = await register();
    const token = randomToken();
    await prisma.emailVerificationToken.create({
      data: { userId: owner.id, email: owner.email, tokenHash: sha256(token), returnTo: '/en/courses/x', expiresAt: new Date(Date.now() + 60_000) },
    });
    await http().post('/api/auth/verify-email').set('Cookie', owner.cookie).send({ token }).expect(200);
    const again = await http().post('/api/auth/verify-email').set('Cookie', owner.cookie).send({ token }).expect(200);
    expect(again.body).toEqual({ ok: true, returnTo: '/en/courses/x' });
    const res = await http().post('/api/auth/verify-email').set('Cookie', other.cookie).send({ token }).expect(400);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('signing in over an existing session revokes that session\'s refresh token (ACC-08)', async () => {
    const a = await register();
    const oldRefresh = /refresh_token=([^;]+)/.exec(a.cookie)![1]!;
    const b = await register();
    // Same browser: a's cookies are still there when b signs in.
    const login = await http().post('/api/auth/login').set('Cookie', a.cookie).send({ email: b.email, password }).expect(200);
    expect(cookieHeader(login.headers['set-cookie'] as unknown as string[])).toMatch(/refresh_token=/);
    const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(oldRefresh) } });
    expect(row.revokedAt).not.toBeNull();
    await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${oldRefresh}`).expect(401);
  });

  it('registering with the address of a recently deleted account says so, instead of "try logging in" (ACC-10)', async () => {
    const { email, cookie } = await register();
    await http().post('/api/me/delete').set('Cookie', cookie).send({ confirm: 'DELETE', password }).expect(200);
    const res = await http().post('/api/auth/register').send({ email, password }).expect(409);
    expect(res.body.code).toBe('ACCOUNT_DELETED');
    // Login still doesn't tell a deleted account from a wrong password.
    const login = await http().post('/api/auth/login').send({ email, password }).expect(401);
    expect(login.body.code).toBe('INVALID_CREDENTIALS');
  });
});
