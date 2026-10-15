import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Telegram and Discord usernames: required in the community step and to apply; shown to admins. */
describe('community usernames (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const community = { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false };

  it('the community step needs both usernames and stores them normalised', async () => {
    const s = await createUser(app, prisma, { prefix: 'handles' });
    const bad = await http().put('/api/me/profile/community').set('Cookie', s.cookie).send(community).expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['discordUsername', 'telegramUsername']);
    await http().put('/api/me/profile/community').set('Cookie', s.cookie).send({ ...community, telegramUsername: 'abc', discordUsername: 'a..b' }).expect(400);
    const ok = await http()
      .put('/api/me/profile/community')
      .set('Cookie', s.cookie)
      .send({ ...community, telegramUsername: '@Layla_ML', discordUsername: 'Layla.ML' })
      .expect(200);
    expect(ok.body).toMatchObject({ telegramUsername: 'Layla_ML', discordUsername: 'layla.ml', coreComplete: true });
  });

  it('a student from before they were asked keeps everything, is told, and adds them before applying', async () => {
    const s = await createUser(app, prisma, { prefix: 'older' });
    await prisma.profile.update({ where: { userId: s.id }, data: { telegramUsername: null, discordUsername: null } });
    const course = await createCourse(prisma);

    const me = await http().get('/api/auth/me').set('Cookie', s.cookie).expect(200);
    // Their profile is still complete (nothing they have is taken away); the banner flag is on.
    expect(me.body.profile).toMatchObject({ coreComplete: true, needsCommunityHandles: true });

    const refused = await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(403);
    expect(refused.body.code).toBe('PROFILE_INCOMPLETE');

    await http()
      .put('/api/me/profile/community')
      .set('Cookie', s.cookie)
      .send({ ...community, telegramUsername: 'older_student', discordUsername: 'Older Student#1234' })
      .expect(200);
    expect((await http().get('/api/auth/me').set('Cookie', s.cookie).expect(200)).body.profile.needsCommunityHandles).toBe(false);
    const applied = await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);

    // The application's profile snapshot (what admins review) carries both.
    const app_ = await prisma.application.findUniqueOrThrow({ where: { id: applied.body.id } });
    expect(app_.profileSnapshot).toMatchObject({ telegramUsername: 'older_student', discordUsername: 'Older Student#1234' });
  });

  it('admins see them in Admin → Students (list, detail, CSV) and can correct or clear them', async () => {
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'adm-handles' });
    const s = await createUser(app, prisma, { prefix: 'listed' });
    const list = await http().get('/api/admin/students').query({ q: s.email }).set('Cookie', admin.cookie).expect(200);
    expect(list.body.items[0]).toMatchObject({ telegramUsername: 'test_person', discordUsername: 'test.person' });
    const detail = await http().get(`/api/admin/students/${s.id}`).set('Cookie', admin.cookie).expect(200);
    expect(JSON.stringify(detail.body)).toContain('test_person');
    const csv = await http().get('/api/admin/students.csv').query({ q: s.email }).set('Cookie', admin.cookie).expect(200);
    const [header, row] = csv.text.replace(/^\uFEFF/, '').split(/\r?\n/);
    expect(header).toContain('"Telegram","Discord"');
    expect(row).toContain('"test_person","test.person"');

    await http().put(`/api/admin/students/${s.id}/profile/community`).set('Cookie', admin.cookie).send({ ...community, telegramUsername: '@fixed_name' }).expect(200);
    let p = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });
    // Left out: kept. Given: normalised.
    expect(p).toMatchObject({ telegramUsername: 'fixed_name', discordUsername: 'test.person' });
    await http().put(`/api/admin/students/${s.id}/profile/community`).set('Cookie', admin.cookie).send({ ...community, discordUsername: '' }).expect(200);
    p = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });
    expect(p.discordUsername).toBeNull();
    await http().put(`/api/admin/students/${s.id}/profile/community`).set('Cookie', admin.cookie).send({ ...community, telegramUsername: 'x' }).expect(400);
  });

  it('are in the data export', async () => {
    const s = await createUser(app, prisma, { prefix: 'export' });
    const exp = await http().get('/api/me/export').set('Cookie', s.cookie).expect(200);
    expect(exp.body.profile).toMatchObject({ telegramUsername: 'test_person', discordUsername: 'test.person' });
  });
});
