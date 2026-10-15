import type { NestExpressApplication } from '@nestjs/platform-express';
import { computeCompleteness } from '@academy/shared';
import request from 'supertest';
import { randomToken, sha256 } from '../src/common/crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookieHeader, createTestApp, createUser, uniqueEmail } from './helpers';

describe('auth & profile (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const email = uniqueEmail();
  const password = 'correct-horse-battery';
  let cookies = '';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('registers, signs in, and sends a verification email', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email: email.toUpperCase(), password, locale: 'ar', returnTo: '/ar/courses/kubernetes' })
      .expect(201);
    expect(res.body).toMatchObject({ email, locale: 'ar', emailVerified: false, role: 'STUDENT' });
    const set = res.headers['set-cookie'] as unknown as string[];
    expect(set.find((c) => c.startsWith('access_token='))).toMatch(/HttpOnly/);
    expect(set.find((c) => c.startsWith('refresh_token='))).toMatch(/Path=\/api\/auth/);
    cookies = cookieHeader(set);
    const tokens = await prisma.emailVerificationToken.count({ where: { email } });
    expect(tokens).toBe(1);
  });

  it('rejects a duplicate registration with EMAIL_TAKEN', async () => {
    const res = await http().post('/api/auth/register').send({ email, password }).expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('rejects wrong passwords without revealing whether the email exists', async () => {
    const a = await http().post('/api/auth/login').send({ email, password: 'wrong-password!' }).expect(401);
    const b = await http().post('/api/auth/login').send({ email: uniqueEmail(), password }).expect(401);
    expect(a.body.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires auth for /me and private routes', async () => {
    await http().get('/api/auth/me').expect(401);
    await http().get('/api/me/profile').expect(401);
    await http().get('/api/auth/me').set('Cookie', cookies).expect(200);
  });

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const first = await http().post('/api/auth/refresh').set('Cookie', cookies).expect(200);
    const rotated = cookieHeader(first.headers['set-cookie'] as unknown as string[], cookies);
    // Simulate theft: the old refresh token is replayed after the grace window.
    const oldToken = /refresh_token=([^;]+)/.exec(cookies)![1]!;
    await prisma.refreshToken.update({
      where: { tokenHash: sha256(oldToken) },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });
    await http().post('/api/auth/refresh').set('Cookie', cookies).expect(401);
    // The legitimate (rotated) token is now revoked too.
    await http().post('/api/auth/refresh').set('Cookie', rotated).expect(401);
    const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
    cookies = cookieHeader(login.headers['set-cookie'] as unknown as string[]);
  });

  it('verifies the email with a single-use token', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = randomToken();
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, email, tokenHash: sha256(token), returnTo: '/ar/courses/kubernetes', expiresAt: new Date(Date.now() + 60_000) },
    });
    // Must be signed in to the same account.
    await http().post('/api/auth/verify-email').send({ token }).expect(401);
    const res = await http().post('/api/auth/verify-email').set('Cookie', cookies).send({ token }).expect(200);
    expect(res.body.returnTo).toBe('/ar/courses/kubernetes');
    // Clicking it again once verified is not an error (ACC-07); nobody else can use it.
    const again = await http().post('/api/auth/verify-email').set('Cookie', cookies).send({ token }).expect(200);
    expect(again.body.returnTo).toBe('/ar/courses/kubernetes');
    const me = await http().get('/api/auth/me').set('Cookie', cookies).expect(200);
    expect(me.body.emailVerified).toBe(true);
  });

  it('no longer lets a student change their login email', async () => {
    await http().post('/api/me/email').set('Cookie', cookies).send({ newEmail: uniqueEmail('new'), password }).expect(404);
    await http().delete('/api/me/email').set('Cookie', cookies).expect(404);
    const me = await http().get('/api/auth/me').set('Cookie', cookies).expect(200);
    expect(me.body.email).toBe(email);
    expect(me.body).not.toHaveProperty('pendingEmail');
  });

  it('ignores a confirmation link sent for a pending email change before it was removed', async () => {
    // State left by the old flow: a pending address and an unused link sent to it.
    const newAddress = uniqueEmail('pending');
    const user = await prisma.user.update({ where: { email }, data: { pendingEmail: newAddress } });
    const token = randomToken();
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, email: newAddress, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    const res = await http().post('/api/auth/verify-email').set('Cookie', cookies).send({ token }).expect(400);
    expect(res.body.code).toBe('TOKEN_INVALID');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(email);
    expect(await prisma.user.findUnique({ where: { email: newAddress } })).toBeNull();
    // The session still works: nothing was revoked by a change that did not happen.
    await http().get('/api/auth/me').set('Cookie', cookies).expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { pendingEmail: null } });
  });

  it('validates and saves the core profile, then computes completeness', async () => {
    const bad = await http().put('/api/me/profile/core').set('Cookie', cookies).send({ fullNameEn: 'A' }).expect(400);
    expect(bad.body.errors.length).toBeGreaterThan(3);
    const res = await http()
      .put('/api/me/profile/core')
      .set('Cookie', cookies)
      .send({
        fullNameEn: 'Test Student',
        // A local Egyptian number is stored in international format (QA L11).
        phone: '0100 123 4567',
        country: 'EG',
        city: 'Cairo',
        timezone: 'Africa/Cairo',
        employmentStatus: 'EMPLOYED_FULL_TIME',
        jobTitle: 'ML Engineer',
        experienceYears: 'Y3_5',
        primaryArea: 'MLOPS',
        googleEmail: 'student@gmail.com',
        preferredLanguage: 'ar',
        acceptTerms: true,
      })
      .expect(200);
    // The basics alone are no longer enough: professional background and education are required too.
    expect(res.body).toMatchObject({ coreComplete: false, phone: '+201001234567' });
    await http().put('/api/me/profile/professional').set('Cookie', cookies).send({ company: 'X' }).expect(400);
    // More ML/AI experience than total experience (3–5 years) is refused, on the ML field (QA L12).
    const tooMuch = await http()
      .put('/api/me/profile/professional')
      .set('Cookie', cookies)
      .send({ industry: 'TELECOM', mlExperienceYears: 'Y10_PLUS', seniority: 'MID', secondaryAreas: [] })
      .expect(400);
    expect(tooMuch.body.errors).toEqual([{ path: 'mlExperienceYears', message: expect.stringContaining('total professional experience') }]);
    // The primary area (MLOPS) is never also a secondary one.
    const pro = await http()
      .put('/api/me/profile/professional')
      .set('Cookie', cookies)
      .send({ industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: ['MLOPS', 'DATA_ENGINEERING'] })
      .expect(200);
    expect(pro.body.secondaryAreas).toEqual(['DATA_ENGINEERING']);
    const edu = await http()
      .put('/api/me/profile/education')
      .set('Cookie', cookies)
      .send({ educationLevel: 'BACHELORS', fieldOfStudy: 'Computer Science' })
      .expect(200);
    // Only the highest degree is asked now; fields no longer on the form are ignored, not saved.
    // Links and the community questions are required too.
    expect(edu.body).toMatchObject({ coreComplete: false, educationLevel: 'BACHELORS', fieldOfStudy: null, university: null });
    await http()
      .put('/api/me/profile/links')
      .set('Cookie', cookies)
      .send({ linkedinUrl: 'https://github.com/x', githubUrl: 'https://github.com/x' })
      .expect(400);
    await http()
      .put('/api/me/profile/links')
      .set('Cookie', cookies)
      .send({ linkedinUrl: 'https://www.linkedin.com/in/student', githubUrl: 'https://github.com/student', websiteUrl: 'https://me.dev' })
      .expect(200);
    // Every community question needs an explicit answer; nothing defaults to "no".
    // 67% = every required field (60%) plus the optional industry and secondary area given above (2 of 11 optional fields).
    await http().put('/api/me/profile/community').set('Cookie', cookies).send({ referralSource: 'LINKEDIN' }).expect(400);
    const community = await http()
      .put('/api/me/profile/community')
      .set('Cookie', cookies)
      .send({ referralSource: 'LINKEDIN', communityMember: true, openToOpportunities: false, shareWithPartners: false, marketingEmails: true, telegramUsername: '@test_student', discordUsername: 'Test.Student' })
      .expect(200);
    expect(community.body).toMatchObject({ coreComplete: true, completeness: 67, websiteUrl: null, marketingEmails: true, shareWithPartners: false, telegramUsername: 'test_student', discordUsername: 'test.student' });
    expect(community.body.communityAnsweredAt).toBeTruthy();
    const skills = await http()
      .put('/api/me/profile/skills')
      .set('Cookie', cookies)
      .send({ skills: { KUBERNETES: 3, PYTHON: 5 }, cloudPlatforms: ['AWS'], productionTools: ['MLflow'] })
      .expect(200);
    expect(skills.body.skills).toEqual({ KUBERNETES: 3, PYTHON: 5 });
    expect(skills.body.completeness).toBeGreaterThan(60);
  });

  it('keeps completeness right when two sections are saved at the same time (QA M5)', async () => {
    const u = await createUser(app, prisma);
    const put = (section: string, body: object) => http().put(`/api/me/profile/${section}`).set('Cookie', u.cookie).send(body);
    for (let i = 0; i < 3; i++) {
      const [a, b] = await Promise.all([
        put('goals', { learningGoals: [], interestedTopics: ['LLMOPS'], weeklyHours: 'H_2_5', preferredTimes: [], preferredFormat: 'LIVE' }),
        put('skills', { skills: { PYTHON: 4 }, cloudPlatforms: ['AWS'], productionTools: [`Tool ${i}`] }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
    }
    const p = await http().get('/api/me/profile').set('Cookie', u.cookie).expect(200);
    expect(p.body).toMatchObject({ weeklyHours: 'H_2_5', productionTools: ['Tool 2'], coreComplete: true });
    expect(p.body.completeness).toBe(computeCompleteness(p.body).percent);
  });

  it('rejects a CV that is not really a PDF', async () => {
    const res = await http()
      .post('/api/me/profile/cv')
      .set('Cookie', cookies)
      .attach('file', Buffer.from('<html>not a pdf</html>'), { filename: 'cv.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(res.body.code).toBe('FILE_TYPE');
  });

  it('lets the owner, and only the owner, open their CV, and points the export to it (QA L23)', async () => {
    await http().get('/api/me/profile/cv').set('Cookie', cookies).expect(404);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    await http()
      .post('/api/me/profile/cv')
      .set('Cookie', cookies)
      .attach('file', pdf, { filename: 'cv.pdf', contentType: 'application/pdf' })
      .expect(201);
    const res = await http().get('/api/me/profile/cv').set('Cookie', cookies).expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.url).toMatch(/^https?:\/\//);
    expect(res.body.expiresIn).toBeLessThanOrEqual(300);
    const other = await createUser(app, prisma);
    await http().get('/api/me/profile/cv').set('Cookie', other.cookie).expect(404);
    await http().get('/api/me/profile/cv').expect(401);
    const exported = await http().get('/api/me/export').set('Cookie', cookies).expect(200);
    expect(exported.body.cv).toMatchObject({ download: expect.stringMatching(/\/profile\?tab=links$/), uploadedAt: expect.any(String) });
  });

  it('exports the student data as JSON', async () => {
    const res = await http().get('/api/me/export').set('Cookie', cookies).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.account.email).toBe(email);
    expect(res.body.profile.fullNameEn).toBe('Test Student');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash/);
  });

  it('soft-deletes the account, blocks login, and anonymises it later', async () => {
    await http().post('/api/me/delete').set('Cookie', cookies).send({ confirm: 'DELETE', password: 'nope' }).expect(401);
    await http().post('/api/me/delete').set('Cookie', cookies).send({ confirm: 'DELETE', password }).expect(200);
    await http().post('/api/auth/login').send({ email, password }).expect(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const { AccountService } = await import('../src/users/account.service');
    await app.get(AccountService).anonymizeDue();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toMatch(/@anonymised\.invalid$/);
    expect(after.anonymizedAt).not.toBeNull();
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
  });
});
