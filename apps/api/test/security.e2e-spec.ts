import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { TokensService } from '../src/auth/tokens.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookieHeader, createTestApp, uniqueEmail } from './helpers';

describe('auth security (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function sessionFor(userId: string): Promise<string> {
    const tokens = app.get(TokensService);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return `access_token=${await tokens.signAccess(user)}`;
  }

  it('Google sign-in on a never-verified account evicts the pre-registered password and sessions', async () => {
    const victim = uniqueEmail('victim');
    const attackerPassword = 'attacker-password-123';
    const reg = await http().post('/api/auth/register').send({ email: victim, password: attackerPassword }).expect(201);
    const attackerCookies = cookieHeader(reg.headers['set-cookie'] as unknown as string[]);

    // The real owner signs in with Google (verified address).
    await auth.loginWithGoogle({ sub: `g-${Date.now()}`, email: victim, emailVerified: true, name: 'Victim' }, 'en');

    await http().post('/api/auth/login').send({ email: victim, password: attackerPassword }).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', attackerCookies).expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('keeps the password when Google links to an already-verified account', async () => {
    const email = uniqueEmail('owner');
    await http().post('/api/auth/register').send({ email, password: 'owner-password-123' }).expect(201);
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    await auth.loginWithGoogle({ sub: `g2-${Date.now()}`, email, emailVerified: true, name: null }, 'en');
    await http().post('/api/auth/login').send({ email, password: 'owner-password-123' }).expect(200);
  });

  it('refuses Google identities whose email Google has not verified', async () => {
    await expect(
      auth.loginWithGoogle({ sub: `g3-${Date.now()}`, email: uniqueEmail(), emailVerified: false, name: null }, 'en'),
    ).rejects.toThrow(/not verified/);
  });

  it('ignores form-encoded bodies (no login CSRF via HTML forms)', async () => {
    const email = uniqueEmail();
    await http().post('/api/auth/register').send({ email, password: 'form-password-123' }).expect(201);
    await http()
      .post('/api/auth/login')
      .type('form')
      .send(`email=${encodeURIComponent(email)}&password=form-password-123`)
      .expect(400);
  });

  it('blocks state-changing requests from other origins', async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: uniqueEmail(), password: 'whatever-123' })
      .expect(403);
    expect(res.body.code).toBe('CROSS_SITE');
    await http().post('/api/auth/login').set('Sec-Fetch-Site', 'cross-site').send({}).expect(403);
    await http().get('/api/health').set('Origin', 'https://evil.example').expect(200);
  });

  it('requires a fresh Google sign-in before Google-only users change sensitive settings', async () => {
    const { user } = await auth.loginWithGoogle(
      { sub: `g4-${Date.now()}`, email: uniqueEmail('gonly'), emailVerified: true, name: null },
      'en',
    );
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const cookie = await sessionFor(user.id);
    const res = await http().post('/api/me/delete').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    await http().post('/api/me/password').set('Cookie', cookie).send({ newPassword: 'brand-new-password' }).expect(403);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await http().post('/api/me/password').set('Cookie', cookie).send({ newPassword: 'brand-new-password' }).expect(200);
  });

  it('locks an account after repeated failed logins', async () => {
    const email = uniqueEmail('brute');
    await http().post('/api/auth/register').send({ email, password: 'right-password-123' }).expect(201);
    // Spread across "IPs" is irrelevant: the lock is per account.
    for (let i = 0; i < 10; i++) {
      await http().post('/api/auth/login').send({ email, password: `wrong-${i}-password` }).expect(401);
    }
    const res = await http().post('/api/auth/login').send({ email, password: 'right-password-123' }).expect(429);
    expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
