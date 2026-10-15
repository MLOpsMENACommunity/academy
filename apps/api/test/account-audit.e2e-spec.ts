import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { RESET_MAX_PER_WINDOW } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
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
});
