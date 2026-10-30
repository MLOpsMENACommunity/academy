import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

describe('speaker accounts: invite and link (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; locale: string; template: EmailTemplate }[] = [];
  let n = 0;
  const http = () => request(app.getHttpServer());

  /** An archive-style public profile with no account, on a course's staff as Co-instructor. */
  async function profileOnCourse(): Promise<{ instructorId: string; courseId: string }> {
    const course = await createCourse(prisma);
    const instructor = await prisma.instructor.create({ data: { slug: `inv-${Date.now()}-${++n}`, name: 'Sameh Speaker', titleEn: 'ML Engineer', bioEn: 'Builds platforms.', source: 'import' } });
    const staff = (await http().get(`/api/admin/courses/${course.id}/staff`).set('Cookie', admin.cookie).expect(200)).body as { roles: { id: string; builtin: string | null }[] };
    const co = staff.roles.find((r) => r.builtin === 'CO')!.id;
    await http().post(`/api/admin/courses/${course.id}/staff`).set('Cookie', admin.cookie).send({ roleId: co, instructorId: instructor.id }).expect(201);
    return { instructorId: instructor.id, courseId: course.id };
  }
  const cookieOf = async (userId: string) => `access_token=${await app.get(TokensService).signAccess(await prisma.user.findUniqueOrThrow({ where: { id: userId } }))}`;
  const teaches = async (cookie: string) => ((await http().get('/api/teach/courses').set('Cookie', cookie).expect(200)).body as { id: string }[]).map((c) => c.id);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['SPEAKERS', 'ACADEMIC'], prefix: 'inv-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, locale, template) => {
      sent.push({ to, locale, template });
      return true;
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  it('invites a new address: a speaker account, linked, emailed, teaching the profile’s courses', async () => {
    const { instructorId, courseId } = await profileOnCourse();
    const email = uniqueEmail('inv-new');
    const res = await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: email.toUpperCase(), locale: 'ar' }).expect(201);
    expect(res.body).toMatchObject({ outcome: 'invited', account: { email, role: 'SPEAKER', pending: true } });

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { profile: true, speakerProfile: true } });
    expect(user).toMatchObject({ role: 'SPEAKER', locale: 'ar', emailVerifiedAt: null });
    expect(user.profile?.fullNameEn).toBe('Sameh Speaker');
    expect(user.speakerProfile?.id).toBe(instructorId);
    expect(sent).toEqual([expect.objectContaining({ to: email, locale: 'ar', template: expect.objectContaining({ name: 'speakerInvited', days: 7 }) })]);
    expect((sent[0]!.template as { url: string }).url).toMatch(/\/ar\/reset-password\?token=[^&]+&welcome=1$/);
    expect(await prisma.courseStaff.findFirst({ where: { courseId, instructorId } })).toMatchObject({ userId: user.id });
    expect(await teaches(await cookieOf(user.id))).toEqual([courseId]);
    expect(await prisma.auditLog.findFirst({ where: { action: 'instructor.account_linked', entityId: instructorId } })).toMatchObject({ actorId: admin.id, metadata: { userId: user.id, invited: true } });

    // The admin page shows the account; a second invite is refused until it's unlinked.
    const page = (await http().get(`/api/admin/instructors/${instructorId}`).set('Cookie', admin.cookie).expect(200)).body;
    expect(page.account).toEqual({ id: user.id, email, role: 'SPEAKER', pending: true });
    const again = await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: uniqueEmail('inv-2') }).expect(409);
    expect(again.body.code).toBe('PROFILE_HAS_ACCOUNT');
  });

  it('links an existing student (who becomes a speaker) only once the email is confirmed', async () => {
    const { instructorId, courseId } = await profileOnCourse();
    const unverified = await createUser(app, prisma, { prefix: 'inv-unv', verified: false });
    const r = await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: unverified.email }).expect(409);
    expect(r.body.code).toBe('EMAIL_UNVERIFIED');
    expect((await prisma.instructor.findUniqueOrThrow({ where: { id: instructorId } })).userId).toBeNull();

    const student = await createUser(app, prisma, { prefix: 'inv-stu' });
    const res = await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: student.email }).expect(201);
    expect(res.body).toMatchObject({ outcome: 'linked', account: { id: student.id, role: 'SPEAKER' } });
    expect(sent).toEqual([]);
    expect(await prisma.notification.findFirst({ where: { userId: student.id, type: 'speaker.linked' } })).toMatchObject({ link: '/teach' });
    expect(await teaches(student.cookie)).toEqual([courseId]);

    // One profile per account.
    const other = await profileOnCourse();
    const taken = await http().post(`/api/admin/instructors/${other.instructorId}/account`).set('Cookie', admin.cookie).send({ email: student.email }).expect(409);
    expect(taken.body.code).toBe('ACCOUNT_HAS_PROFILE');
  });

  it('links an admin without changing its role', async () => {
    const { instructorId } = await profileOnCourse();
    const other = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'inv-adm' });
    await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: other.email }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe('ADMIN');
  });

  it('unlinks: the account stays but stops teaching the profile’s courses', async () => {
    const { instructorId, courseId } = await profileOnCourse();
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'inv-unl' });
    await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).send({ email: speaker.email }).expect(201);
    expect(await teaches(speaker.cookie)).toEqual([courseId]);

    await http().delete(`/api/admin/instructors/${instructorId}/account`).set('Cookie', admin.cookie).expect(204);
    expect((await prisma.instructor.findUniqueOrThrow({ where: { id: instructorId } })).userId).toBeNull();
    expect(await prisma.courseStaff.findFirst({ where: { courseId, instructorId } })).toMatchObject({ userId: null });
    expect(await teaches(speaker.cookie)).toEqual([]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: speaker.id } })).toMatchObject({ role: 'SPEAKER', deletedAt: null });
    expect((await http().get(`/api/admin/instructors/${instructorId}`).set('Cookie', admin.cookie).expect(200)).body.account).toBeNull();
  });

  it('is for the speakers team only', async () => {
    const { instructorId } = await profileOnCourse();
    const content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'inv-cnt' });
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'inv-self' });
    await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', content.cookie).send({ email: uniqueEmail('inv-x') }).expect(403);
    await http().post(`/api/admin/instructors/${instructorId}/account`).set('Cookie', speaker.cookie).send({ email: speaker.email }).expect(403);
    await http().delete(`/api/admin/instructors/${instructorId}/account`).set('Cookie', content.cookie).expect(403);
    await http().post('/api/admin/instructors/nope/account').set('Cookie', admin.cookie).send({ email: uniqueEmail('inv-404') }).expect(404);
  });
});
