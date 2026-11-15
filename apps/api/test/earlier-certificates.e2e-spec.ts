import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('certificates issued before the academy (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof createUser>>;
  let student: Awaited<ReturnType<typeof createUser>>;
  let unconfirmed: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'earlier-admin' });
    student = await createUser(app, prisma, { prefix: 'earlier-student' });
    unconfirmed = await createUser(app, prisma, { prefix: 'earlier-unconfirmed', verified: false });
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (csv: string, dryRun: boolean, cookie = admin.cookie) => http().post('/api/admin/certificates/earlier/import').set('Cookie', cookie).send({ csv, dryRun });
  const sheet = (rows: string[]) => ['code,holder_name,course,issued_on,status,email', ...rows].join('\n');
  const rows = () => [
    `EARL-01-2026-00011,Sara Ahmed,The MLOps Practitioner Course,2026/11/02,valid,${student.email.toUpperCase()}`,
    `EARL-01-2026-00012,Not Confirmed,The MLOps Practitioner Course,2026/11/02,valid,${unconfirmed.email}`,
    'EARL-01-2026-00208,Later Signup,The MLOps Practitioner Course,2026/11/03,valid,later.signup@example.com',
    'EARL-01-2026-00100,Revoked Person,The MLOps Practitioner Course,2026/11/03,revoked,',
  ];

  it('is for ACADEMIC admins only', async () => {
    await send(sheet(rows()), true, student.cookie).expect(403);
  });

  it('checks the file first (nothing saved), then imports, links by confirmed email only, and a re-import changes nothing', async () => {
    const dry = (await send(sheet(rows()), true).expect(200)).body;
    expect(dry).toMatchObject({ dryRun: true, rows: 4, created: 4, updated: 0, unchanged: 0, linked: 1, errors: [] });
    expect(await prisma.externalCertificate.count({ where: { code: { startsWith: 'EARL-' } } })).toBe(0);

    const saved = (await send(sheet(rows()), false).expect(200)).body;
    expect(saved).toMatchObject({ dryRun: false, created: 4, linked: 1 });
    const sara = await prisma.externalCertificate.findUniqueOrThrow({ where: { code: 'EARL-01-2026-00011' } });
    expect(sara).toMatchObject({ userId: student.id, email: student.email.toLowerCase(), kind: 'ATTENDANCE', importedById: admin.id });
    expect((await prisma.externalCertificate.findUniqueOrThrow({ where: { code: 'EARL-01-2026-00012' } })).userId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'certificates.earlier_imported', actorId: admin.id } })).toBe(1);

    expect((await send(sheet(rows()), false).expect(200)).body).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
  });

  it('saves nothing when any line is wrong, and refuses a code issued by the academy', async () => {
    const course = await createCourse(prisma);
    const holder = await createUser(app, prisma, { prefix: 'earlier-holder' });
    const e = await prisma.enrollment.create({ data: { userId: holder.id, courseId: course.id } });
    await prisma.certificate.create({ data: { enrollmentId: e.id, serial: 'EARL-09-2026-00001', nameOnCertificate: 'Holder', courseTitleEn: 'C', courseTitleAr: 'C' } });
    const body = (await send(sheet(['EARL-09-2026-00002,Fine Row,Course,2026/01/01,valid,', 'EARL-09-2026-00001,Clash,Course,2026/01/01,valid,', 'bad code,X Y,Course,2026/01/01,valid,']), false).expect(200)).body;
    expect(body.errors.map((x: { line: number }) => x.line)).toEqual([3, 4]);
    expect(await prisma.externalCertificate.count({ where: { code: 'EARL-09-2026-00002' } })).toBe(0);
  });

  it('verifies earlier codes publicly (any case), without a PDF; revoked ones say so', async () => {
    const valid = (await http().get('/api/certificates/earl-01-2026-00011').expect(200)).body;
    expect(valid).toMatchObject({ status: 'VALID', serial: 'EARL-01-2026-00011', name: 'Sara Ahmed', courseSlug: null, courseTitleEn: 'The MLOps Practitioner Course', pdf: false });
    expect(valid.issuedAt.slice(0, 10)).toBe('2026-11-02');
    expect(JSON.stringify(valid)).not.toContain('@');
    expect((await http().get('/api/certificates/EARL-01-2026-00100').expect(200)).body).toMatchObject({ status: 'REVOKED' });
    await http().get('/api/certificates/EARL-01-2026-99999').expect(404);
    await http().get('/api/certificates/EARL-01-2026-00011/pdf').expect(404);
  });

  it("shows linked ones in the student's certificates, and links a student who confirms the email later", async () => {
    const mine = (await http().get('/api/me/certificates').set('Cookie', student.cookie).expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ serial: 'EARL-01-2026-00011', courseSlug: null, pdf: false, status: 'VALID' })]);

    await prisma.user.update({ where: { id: unconfirmed.id }, data: { emailVerifiedAt: new Date() } });
    const later = (await http().get('/api/me/certificates').set('Cookie', unconfirmed.cookie).expect(200)).body;
    expect(later.map((c: { serial: string }) => c.serial)).toEqual(['EARL-01-2026-00012']);
  });

  it('continues the prefix numbering after the highest imported number', async () => {
    const course = await createCourse(prisma);
    await http().put(`/api/admin/courses/${course.id}/certificate-rule`).set('Cookie', admin.cookie).send({ minSessionsPercent: null, requireAssessments: false, codePrefix: 'EARL' }).expect(200);
    const u = await createUser(app, prisma, { prefix: 'earlier-new' });
    await prisma.profile.update({ where: { userId: u.id }, data: { fullNameEn: 'New Student' } });
    await prisma.enrollment.create({ data: { userId: u.id, courseId: course.id } });
    await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [u.id], force: true }).expect(201);
    const c = await prisma.certificate.findFirstOrThrow({ where: { enrollment: { userId: u.id } } });
    expect(c.serial).toMatch(/^EARL-01-\d{4}-00209$/);
  });

  it('a deleted account hides the certificate; anonymisation removes the name and email, and a re-import does not bring them back', async () => {
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
    expect((await http().get('/api/certificates/EARL-01-2026-00011').expect(200)).body).toEqual({ status: 'UNAVAILABLE', serial: 'EARL-01-2026-00011' });
    await app.get(AccountService).anonymize(student.id);
    expect(await prisma.externalCertificate.findUniqueOrThrow({ where: { code: 'EARL-01-2026-00011' } })).toMatchObject({ holderName: '', email: null });
    await send(sheet(rows()), false).expect(200);
    expect(await prisma.externalCertificate.findUniqueOrThrow({ where: { code: 'EARL-01-2026-00011' } })).toMatchObject({ holderName: '', email: null });
  });
});
