import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('session feedback in the Teaching area (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(() => app.close());

  it('shows staff with See session feedback the ratings and comments without names; admins keep the names', async () => {
    const c = await createCourse(prisma);
    const session = await prisma.courseSession.create({ data: { courseId: c.id, order: 1, titleEn: 'S1', titleAr: 'ج1', startsAt: new Date(Date.now() - 86_400_000) } });
    const student = await createUser(app, prisma);
    await prisma.sessionFeedback.create({ data: { userId: student.id, courseId: c.id, sessionId: session.id, scopeKey: session.id, rating: 2, comment: 'Too fast' } });

    const staff = await createUser(app, prisma, { prefix: 'mod' });
    const role = await prisma.courseRole.create({ data: { courseId: c.id, name: 'Moderator', permissions: ['VIEW_ROSTER'] } });
    await prisma.courseStaff.create({ data: { courseId: c.id, roleId: role.id, userId: staff.id } });
    await http().get(`/api/teach/courses/${c.id}/feedback`).set('Cookie', staff.cookie).expect(403);

    await prisma.courseRole.update({ where: { id: role.id }, data: { permissions: ['VIEW_ROSTER', 'VIEW_FEEDBACK'] } });
    const mine = await http().get(`/api/teach/courses/${c.id}/feedback`).set('Cookie', staff.cookie).expect(200);
    expect(mine.body.sessions[0]).toMatchObject({ id: session.id, count: 1, average: 2, comments: [{ rating: 2, comment: 'Too fast', by: null }] });
    expect(JSON.stringify(mine.body)).not.toContain('Test Person');
    // Another course's feedback stays closed.
    const other = await createCourse(prisma);
    await http().get(`/api/teach/courses/${other.id}/feedback`).set('Cookie', staff.cookie).expect(403);

    const admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'acad' });
    const full = await http().get(`/api/admin/courses/${c.id}/feedback`).set('Cookie', admin.cookie).expect(200);
    expect(full.body.sessions[0].comments[0].by).toBe('Test Person');
  });
});
