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

  async function sessionFor(userId: string, amr: 'pwd' | 'google' = 'pwd', authTime = new Date()): Promise<string> {
    const tokens = app.get(TokensService);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return `access_token=${await tokens.signAccess(user, { amr, authTime })}`;
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
    // The attacker's still-unexpired access token is dead too (token version bumped).
    await http().get('/api/auth/me').set('Cookie', attackerCookies).expect(401);
    await http()
      .post('/api/me/password')
      .set('Cookie', attackerCookies)
      .send({ newPassword: 'attacker-new-password' })
      .expect(401);
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: victim } })).id } });
    expect(profile.googleEmail).toBe(victim);
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

  it('requires this session to have signed in with Google recently before Google-only users change sensitive settings', async () => {
    const { user } = await auth.loginWithGoogle(
      { sub: `g4-${Date.now()}`, email: uniqueEmail('gonly'), emailVerified: true, name: null },
      'en',
    );
    // An old Google session: the account's fresh lastLoginAt (from another device) must not help.
    const old = await sessionFor(user.id, 'google', new Date(Date.now() - 60 * 60 * 1000));
    const res = await http().post('/api/me/delete').set('Cookie', old).send({ confirm: 'DELETE' }).expect(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    // A password-method session can't stand in for Google re-auth either.
    const pwd = await sessionFor(user.id, 'pwd');
    await http().post('/api/me/password').set('Cookie', pwd).send({ newPassword: 'brand-new-password' }).expect(403);

    const fresh = await sessionFor(user.id, 'google', new Date());
    await http().post('/api/me/password').set('Cookie', fresh).send({ newPassword: 'brand-new-password' }).expect(200);
    // Changing the password ended every session, including this one.
    await http().get('/api/auth/me').set('Cookie', fresh).expect(401);
  });

  it('refuses verification links opened in another account', async () => {
    const owner = await http().post('/api/auth/register').send({ email: uniqueEmail('own'), password: 'owner-password-12' }).expect(201);
    const ownerId = owner.body.id as string;
    const token = 'v'.repeat(43);
    const { sha256 } = await import('../src/common/crypto');
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    await prisma.emailVerificationToken.create({
      data: { userId: ownerId, email: ownerUser.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    const other = await http().post('/api/auth/register').send({ email: uniqueEmail('oth'), password: 'other-password-12' }).expect(201);
    const otherCookie = cookieHeader(other.headers['set-cookie'] as unknown as string[]);
    const res = await http().post('/api/auth/verify-email').set('Cookie', otherCookie).send({ token }).expect(403);
    expect(res.body.code).toBe('WRONG_ACCOUNT');
  });

  it('rate limits signed-in users per account, not per shared IP', async () => {
    const { AppThrottlerGuard } = await import('../src/common/throttler.guard');
    const guard = Object.create(AppThrottlerGuard.prototype) as { getTracker: (r: unknown) => Promise<string> };
    await expect(guard.getTracker({ ip: '1.2.3.4', user: { id: 'u1' } })).resolves.toBe('user:u1');
    await expect(guard.getTracker({ ip: '1.2.3.4' })).resolves.toBe('ip:1.2.3.4');
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
