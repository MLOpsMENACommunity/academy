import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CertificatesService, type CertificateIssuedEvent } from '../src/certificates/certificates.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

/** Supertest: collect a binary body as a Buffer. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('certificates (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof createUser>>;
  let ready: Awaited<ReturnType<typeof createUser>>;
  let behind: Awaited<ReturnType<typeof createUser>>;
  let outsider: Awaited<ReturnType<typeof createUser>>;
  let course: { id: string; slug: string };
  let quizId: string;
  const events: CertificateIssuedEvent[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    app.get(CertificatesService).onIssued((e) => {
      events.push(e);
    });
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'cert-admin' });
    ready = await createUser(app, prisma, { prefix: 'cert-ready' });
    behind = await createUser(app, prisma, { prefix: 'cert-behind' });
    outsider = await createUser(app, prisma, { prefix: 'cert-outsider' });
    await prisma.profile.update({ where: { userId: ready.id }, data: { fullNameEn: 'Ready Student', fullNameAr: 'طالب جاهز' } });
    course = await createCourse(prisma);
    const s1 = await prisma.courseSession.create({ data: { courseId: course.id, order: 1, titleEn: 'S1', titleAr: 'ج1', startsAt: new Date('2026-10-18T16:00:00Z') } });
    await prisma.courseSession.create({ data: { courseId: course.id, order: 2, titleEn: 'S2', titleAr: 'ج2', startsAt: new Date('2026-10-25T16:00:00Z') } });
    const quiz = await prisma.assessment.create({
      data: { courseId: course.id, type: 'QUIZ', status: 'PUBLISHED', titleEn: 'Midpoint', titleAr: 'منتصف', maxPoints: 10, passPercent: 70, countsForCertificate: true },
    });
    quizId = quiz.id;
    for (const u of [ready, behind]) await prisma.enrollment.create({ data: { userId: u.id, courseId: course.id } });
    // ready: attended half the sessions and a passing score; behind: nothing.
    await prisma.sessionAttendance.create({ data: { userId: ready.id, sessionId: s1.id, minutes: 60, percent: 100, status: 'PRESENT', source: 'MANUAL' } });
    await prisma.submission.create({ data: { assessmentId: quizId, userId: ready.id, attempt: 1, submittedAt: new Date(), score: 8, maxScore: 10 } });
  });

  afterAll(async () => {
    await app.close();
  });

  const roster = async () => (await http().get(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).expect(200)).body;
  const certOf = (userId: string) => prisma.certificate.findFirst({ where: { enrollment: { userId, courseId: course.id } } });

  it('only admins can see the roster, set the rule or issue', async () => {
    await http().get(`/api/admin/courses/${course.id}/certificates`).set('Cookie', ready.cookie).expect(403);
    await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', ready.cookie).send({ userIds: [ready.id] }).expect(403);
    await http().put(`/api/admin/courses/${course.id}/certificate-rule`).set('Cookie', ready.cookie).send({ minSessionsPercent: 10, requireAssessments: false }).expect(403);
    await http().post(`/api/admin/courses/${course.id}/certificates`).send({ userIds: [ready.id] }).expect(401);
  });

  it('the course rule drives eligibility in the roster', async () => {
    await http()
      .put(`/api/admin/courses/${course.id}/certificate-rule`)
      .set('Cookie', admin.cookie)
      .send({ minSessionsPercent: 50, requireAssessments: true, textEn: 'Pass the quiz and attend half.', textAr: '' })
      .expect(200);
    const r = await roster();
    expect(r.rule).toMatchObject({ minSessionsPercent: 50, requireAssessments: true, textEn: 'Pass the quiz and attend half.' });
    // Only enrolled students: not the admin, not the outsider.
    expect(r.rows.map((x: { userId: string }) => x.userId).sort()).toEqual([ready.id, behind.id].sort());
    const row = (id: string) => r.rows.find((x: { userId: string }) => x.userId === id);
    expect(row(ready.id).eligibility).toMatchObject({ eligible: true, sessions: { completed: 1, total: 2, percent: 50 }, assessments: { required: 1, passed: 1 }, averagePercent: 80 });
    expect(row(behind.id).eligibility).toMatchObject({ eligible: false, sessions: { percent: 0, ok: false }, assessments: { passed: 0, ok: false } });
    expect(r.counts).toEqual({ enrolled: 2, eligible: 1, issued: 0, revoked: 0 });
  });

  it('refuses students who are not eligible unless the admin confirms', async () => {
    const res = await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [ready.id, behind.id] }).expect(409);
    expect(res.body.code).toBe('NOT_ELIGIBLE');
    expect(res.body.userIds).toEqual([behind.id]);
    expect(await certOf(ready.id)).toBeNull();
  });

  it('bulk issue is idempotent: the same student twice gives one certificate', async () => {
    const first = await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [ready.id, ready.id, outsider.id] }).expect(201);
    expect(first.body.issued).toBe(1);
    expect(first.body.results).toEqual([
      { userId: ready.id, outcome: 'ISSUED', serial: expect.stringMatching(/^MMA-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/) },
      { userId: outsider.id, outcome: 'NOT_ENROLLED' },
    ]);
    const again = await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [ready.id] }).expect(201);
    expect(again.body).toEqual({ issued: 0, results: [{ userId: ready.id, outcome: 'ALREADY_ISSUED', serial: first.body.results[0].serial }] });
    expect(await prisma.certificate.count({ where: { enrollment: { userId: ready.id } } })).toBe(1);

    const c = (await certOf(ready.id))!;
    expect(c).toMatchObject({ nameOnCertificate: 'Ready Student', nameOnCertificateAr: 'طالب جاهز', courseTitleEn: 'Test course', issuedById: admin.id, revokedAt: null });
    expect(await prisma.auditLog.count({ where: { action: 'certificate.issued', entityId: c.id, actorId: admin.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ready.id, type: 'certificate.issued' } })).toBe(1);
    // Points and badges: the certificate bonus and the "Certified" badge for this course.
    const bonus = await prisma.pointsEntry.aggregate({ where: { userId: ready.id, sourceType: 'CERTIFICATE', sourceId: c.id }, _sum: { points: true } });
    expect(bonus._sum.points).toBeGreaterThan(0);
    expect(await prisma.userBadge.count({ where: { userId: ready.id, badge: { code: 'certified' } } })).toBe(1);
    // The onIssued hook ran once.
    expect(events.filter((e) => e.certificateId === c.id)).toEqual([expect.objectContaining({ userId: ready.id, courseId: course.id, serial: c.serial, reissued: false })]);
  });

  it('issues with confirmation and a grade to a student who is not eligible', async () => {
    const res = await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [behind.id], force: true, grade: 'Distinction' }).expect(201);
    expect(res.body.results[0].outcome).toBe('ISSUED');
    expect((await certOf(behind.id))!.grade).toBe('Distinction');
  });

  it('the public page shows a valid certificate; unknown serials are 404', async () => {
    const c = (await certOf(ready.id))!;
    const res = await http().get(`/api/certificates/${c.serial}`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ status: 'VALID', serial: c.serial, name: 'Ready Student', nameAr: 'طالب جاهز', courseSlug: course.slug, revokedAt: null });
    expect(res.body).not.toHaveProperty('email');
    await http().get(`/api/certificates/${c.serial.toLowerCase()}`).expect(200);
    await http().get('/api/certificates/MMA-2026-ZZZZZZZZ').expect(404);
    await http().get('/api/certificates/not-a-serial').expect(404);
  });

  it('serves the PDF to the owner and publicly, but never someone else’s through the owner route', async () => {
    const c = (await certOf(ready.id))!;
    const pub = await http().get(`/api/certificates/${c.serial}/pdf`).buffer(true).parse(binary).expect(200);
    expect(pub.headers['content-type']).toBe('application/pdf');
    expect(pub.headers['content-disposition']).toBe(`attachment; filename="${c.serial}.pdf"`);
    expect(pub.headers['cache-control']).toBe('private, no-store');
    expect((pub.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Cached in the bucket under certificates/.
    expect((await certOf(ready.id))!.pdfKey).toMatch(/^certificates\/[0-9a-f-]{36}\.pdf$/);

    const mine = await http().get(`/api/me/certificates/${c.serial}/pdf`).set('Cookie', ready.cookie).buffer(true).parse(binary).expect(200);
    expect(mine.headers['content-type']).toBe('application/pdf');
    expect((mine.body as Buffer).equals(pub.body as Buffer)).toBe(true);
    await http().get(`/api/me/certificates/${c.serial}/pdf`).set('Cookie', behind.cookie).expect(404);
    await http().get(`/api/me/certificates/${c.serial}/pdf`).set('Cookie', outsider.cookie).expect(404);
    await http().get(`/api/me/certificates/${c.serial}/pdf`).expect(401);
  });

  it('students see their certificates and the course card with their live status', async () => {
    const list = await http().get('/api/me/certificates').set('Cookie', ready.cookie).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ status: 'VALID', courseSlug: course.slug, nameOnCertificate: 'Ready Student' })]);
    const card = await http().get(`/api/learn/${course.slug}/certificate`).set('Cookie', ready.cookie).expect(200);
    expect(card.body).toMatchObject({ offered: true, rule: { minSessionsPercent: 50 }, eligibility: { eligible: true }, certificate: { status: 'VALID' } });
    await http().get(`/api/learn/${course.slug}/certificate`).set('Cookie', outsider.cookie).expect(403);
  });

  it('revoke: the public page says revoked and the PDF is gone; re-issue makes it valid again', async () => {
    const c = (await certOf(ready.id))!;
    await http().post(`/api/admin/certificates/${c.id}/revoke`).set('Cookie', ready.cookie).send({ reason: 'Plagiarised capstone' }).expect(403);
    await http().post(`/api/admin/certificates/${c.id}/revoke`).set('Cookie', admin.cookie).send({ reason: 'x' }).expect(400);
    await http().post(`/api/admin/certificates/${c.id}/revoke`).set('Cookie', admin.cookie).send({ reason: 'Plagiarised capstone' }).expect(204);
    await http().post(`/api/admin/certificates/${c.id}/revoke`).set('Cookie', admin.cookie).send({ reason: 'Plagiarised capstone' }).expect(409);

    const pub = await http().get(`/api/certificates/${c.serial}`).expect(200);
    expect(pub.body).toMatchObject({ status: 'REVOKED', revokedAt: expect.any(String) });
    await http().get(`/api/certificates/${c.serial}/pdf`).expect(410);
    await http().get(`/api/me/certificates/${c.serial}/pdf`).set('Cookie', ready.cookie).expect(410);
    const after = (await certOf(ready.id))!;
    expect(after).toMatchObject({ revokeReason: 'Plagiarised capstone', pdfKey: null });
    // The bonus and the badge are taken back.
    const net = await prisma.pointsEntry.aggregate({ where: { userId: ready.id, sourceType: 'CERTIFICATE', sourceId: c.id }, _sum: { points: true } });
    expect(net._sum.points).toBe(0);
    expect(await prisma.userBadge.count({ where: { userId: ready.id, badge: { code: 'certified' } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'certificate.revoked', entityId: c.id } })).toBe(1);
    // Bulk issue doesn't silently undo a revocation.
    const bulk = await http().post(`/api/admin/courses/${course.id}/certificates`).set('Cookie', admin.cookie).send({ userIds: [ready.id] }).expect(201);
    expect(bulk.body.results[0].outcome).toBe('REVOKED');

    await prisma.certificate.update({ where: { id: c.id }, data: { grade: 'Distinction' } });
    await http().post(`/api/admin/certificates/${c.id}/reissue`).set('Cookie', admin.cookie).send({}).expect(204);
    const back = await http().get(`/api/certificates/${c.serial}`).expect(200);
    // No grade sent: the grade stays.
    expect(back.body).toMatchObject({ status: 'VALID', serial: c.serial, revokedAt: null, grade: 'Distinction' });
    expect(await prisma.auditLog.count({ where: { action: 'certificate.reissued', entityId: c.id } })).toBe(1);
    expect(await prisma.userBadge.count({ where: { userId: ready.id, badge: { code: 'certified' } } })).toBe(1);
    expect(events.filter((e) => e.certificateId === c.id).map((e) => e.reissued)).toEqual([false, true]);
  });

  it('exports the roster as CSV', async () => {
    const c = (await certOf(ready.id))!;
    const res = await http().get(`/api/admin/courses/${course.id}/certificates.csv`).set('Cookie', admin.cookie).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(c.serial);
    expect(res.text).toContain('Distinction');
    await http().get(`/api/admin/courses/${course.id}/certificates.csv`).set('Cookie', ready.cookie).expect(403);
  });

  it('the data export includes the certificates', async () => {
    const c = (await certOf(ready.id))!;
    const res = await http().get('/api/me/export').set('Cookie', ready.cookie).expect(200);
    const body = typeof res.body === 'object' && Object.keys(res.body).length ? res.body : JSON.parse(res.text);
    expect(body.certificates).toEqual([expect.objectContaining({ serial: c.serial, name: 'Ready Student', status: 'valid', course: expect.objectContaining({ slug: course.slug }) })]);
  });

  it('two admins revoking at once: one revocation, one audit entry', async () => {
    const c = (await certOf(behind.id))!;
    const send = () => http().post(`/api/admin/certificates/${c.id}/revoke`).set('Cookie', admin.cookie).send({ reason: 'Duplicate account' });
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    expect(statuses).toEqual([204, 409]);
    expect(await prisma.auditLog.count({ where: { action: 'certificate.revoked', entityId: c.id } })).toBe(1);
    await http().post(`/api/admin/certificates/${c.id}/reissue`).set('Cookie', admin.cookie).send({}).expect(204);
  });

  it('account deletion keeps the certificate but hides the name; anonymisation removes it', async () => {
    const c = (await certOf(behind.id))!;
    await prisma.user.update({ where: { id: behind.id }, data: { deletedAt: new Date() } });
    const res = await http().get(`/api/certificates/${c.serial}`).expect(200);
    expect(res.body).toEqual({ status: 'UNAVAILABLE', serial: c.serial });
    await http().get(`/api/certificates/${c.serial}/pdf`).expect(404);

    await app.get(AccountService).anonymize(behind.id);
    const kept = (await certOf(behind.id))!;
    expect(kept).toMatchObject({ id: c.id, serial: c.serial, nameOnCertificate: '', nameOnCertificateAr: null, pdfKey: null, revokeReason: null });
    expect((await http().get(`/api/certificates/${c.serial}`).expect(200)).body).toEqual({ status: 'UNAVAILABLE', serial: c.serial });
    // The enrolment can't be deleted out from under an issued certificate.
    await expect(prisma.enrollment.delete({ where: { id: c.enrollmentId } })).rejects.toThrow();
  });
});
