import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TalentInsightsDto } from '@academy/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Admin → Talents: the figures cover the matching students only, with their academy record. */
describe('admin talents (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { cookie: string };
  // Every student here has this job title, so a search isolates them from other tests' data.
  const tag = `talent${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const insights = async (query: string) =>
    (await http().get(`/api/admin/talents?q=${tag}${query}`).set('Cookie', admin.cookie).expect(200)).body as TalentInsightsDto;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['SUPER'], prefix: 'talent-admin' });
    const course = await createCourse(prisma);
    const session = await prisma.courseSession.create({ data: { courseId: course.id, titleEn: 'S1', titleAr: 'S1', order: 1, startsAt: new Date(), durationMin: 60 } });

    const strong = await createUser(app, prisma, { prefix: 'talent-strong' });
    const junior = await createUser(app, prisma, { prefix: 'talent-junior' });
    const gone = await createUser(app, prisma, { prefix: 'talent-gone' });
    const rate = (userId: string, skills: Record<string, number>, data: object = {}) =>
      prisma.profile.update({
        where: { userId },
        data: { jobTitle: `${tag} engineer`, ...data, skills: { create: Object.entries(skills).map(([skill, level]) => ({ skill: skill as never, level })) } },
      });
    await rate(strong.id, { PYTHON: 4, DOCKER: 5, KUBERNETES: 4, CI_CD: 4, MLOPS_TOOLING: 4 }, { seniority: 'SENIOR', employmentStatus: 'FREELANCER', productionTools: ['MLflow'] });
    await rate(junior.id, { PYTHON: 3, SQL: 2 }, { seniority: 'JUNIOR', productionTools: ['mlflow', 'Airflow'] });
    await rate(gone.id, { KUBERNETES: 5 });
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    await prisma.enrollment.create({ data: { userId: strong.id, courseId: course.id } });
    await prisma.sessionAttendance.create({ data: { sessionId: session.id, userId: strong.id, status: 'PRESENT', percent: 100, minutes: 60 } });
    await prisma.pointsEntry.create({ data: { userId: strong.id, courseId: course.id, points: 25, reason: 'MANUAL_OTHER' } });
    await prisma.pointsEntry.create({ data: { userId: strong.id, points: 100, reason: 'MANUAL_OTHER', voidedAt: new Date() } });
  });
  afterAll(async () => {
    await app.close();
  });

  it('summarises the matching students, leaving out deleted accounts', async () => {
    const d = await insights('');
    expect(d.totals).toMatchObject({ talents: 2, withSkills: 2, withStrongSkill: 1, available: 1, enrolled: 1 });
    expect(d.skills[0]).toMatchObject({ skill: 'DOCKER', strong: 1, expert: 1 });
    expect(d.skills.find((s) => s.skill === 'PYTHON')).toMatchObject({ rated: 2, average: 3.5 });
    // 4+ in Python, LLMs/RAG and agents: nobody here.
    expect(d.roles.find((r) => r.key === 'AI_ENGINEER')).toMatchObject({ total: 0 });
    expect(d.tools).toEqual([
      { key: 'MLflow', count: 2 },
      { key: 'Airflow', count: 1 },
    ]);
    // Voided points never count.
    expect(d.record).toMatchObject({ enrolled: 1, attendance: 100, graded: null, points: 25 });
    expect(d.bench.map((b) => b.jobTitle)).toEqual([`${tag} engineer`, `${tag} engineer`]);
    expect(d.bench[0]).toMatchObject({ attendance: 100, points: 25, available: true, topSkills: [{ skill: 'DOCKER', level: 5 }, { skill: 'PYTHON', level: 4 }, { skill: 'KUBERNETES', level: 4 }] });
  });

  it('follows the profile filters and the population', async () => {
    expect((await insights('&skills=KUBERNETES:4')).totals.talents).toBe(1);
    expect((await insights('&seniority=JUNIOR')).bench).toHaveLength(1);
    expect((await insights('&population=enrolled')).totals.talents).toBe(1);
    expect((await insights('&population=certified')).totals.talents).toBe(0);
  });

  it('is for super admins only: never students, speakers, signed-out visitors or other admin presets', async () => {
    await http().get('/api/admin/talents').expect(401);
    const student = await createUser(app, prisma, { prefix: 'talent-student' });
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'talent-speaker' });
    for (const who of [student, speaker]) {
      await http().get('/api/admin/talents').set('Cookie', who.cookie).expect(403);
      // Filters or a population never open it up.
      await http().get('/api/admin/talents?population=certified&skills=PYTHON:4').set('Cookie', who.cookie).expect(403);
    }
    for (const p of ['ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const) {
      const other = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: [p], prefix: `talent-${p.toLowerCase()}` });
      const res = await http().get('/api/admin/talents').set('Cookie', other.cookie).expect(403);
      expect(res.body.code).toBe('ADMIN_PERMISSION');
    }
    // Every preset but SUPER together still isn't enough.
    const many = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'], prefix: 'talent-many' });
    await http().get('/api/admin/talents').set('Cookie', many.cookie).expect(403);
    // The super admin does.
    await http().get('/api/admin/talents').set('Cookie', admin.cookie).expect(200);
  });

  it('rejects an unknown population', async () => {
    await http().get('/api/admin/talents?population=everyone').set('Cookie', admin.cookie).expect(400);
  });
});
