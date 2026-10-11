import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, uniqueEmail } from './helpers';

/** Admin → Students and Admin → Speakers: the team adds, edits and removes people's information. */
describe('admin edits students and speakers (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; template: EmailTemplate }[] = [];
  const http = () => request(app.getHttpServer());

  const core = {
    fullNameEn: 'Mona Edited',
    fullNameAr: 'منى',
    phone: '01001234567',
    country: 'EG',
    city: 'Alexandria',
    timezone: 'Africa/Cairo',
    employmentStatus: 'EMPLOYED_FULL_TIME',
    jobTitle: 'ML Engineer',
    experienceYears: 'Y3_5',
    primaryArea: 'MLOPS',
    googleEmail: 'mona.edited@gmail.com',
    preferredLanguage: 'en',
  };

  /** Audit metadata of the last entry with this action about this entity. */
  const lastAudit = (action: string, entityId: string) => prisma.auditLog.findFirstOrThrow({ where: { action, entityId }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'edit-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template) => {
      sent.push({ to, template });
      return true;
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  describe('students', () => {
    it("edits a student's profile with the student form's validation, and audits field names only", async () => {
      const s = await createUser(app, prisma, { prefix: 'edit-stu' });
      const before = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });

      const bad = await http().put(`/api/admin/students/${s.id}/profile/core`).set('Cookie', admin.cookie).send({ ...core, fullNameEn: 'M', city: '' }).expect(400);
      expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['city', 'fullNameEn']);
      // Same cross-checks as the student's: ML/AI experience (1-3 years saved) can't exceed the total.
      const cross = await http().put(`/api/admin/students/${s.id}/profile/core`).set('Cookie', admin.cookie).send({ ...core, experienceYears: 'LT1' }).expect(400);
      expect(cross.body.errors[0].path).toBe('experienceYears');
      await http().put(`/api/admin/students/${s.id}/profile/nope`).set('Cookie', admin.cookie).send({}).expect(400);
      await http().put(`/api/admin/students/${s.id}/profile/core`).set('Cookie', s.cookie).send(core).expect(403);

      const ok = await http().put(`/api/admin/students/${s.id}/profile/core`).set('Cookie', admin.cookie).send(core).expect(200);
      expect(ok.body).toMatchObject({ fullNameEn: 'Mona Edited', city: 'Alexandria', phone: '+201001234567', coreComplete: true });
      const after = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });
      // Only the student accepts the Terms: the stamp stays as it was.
      expect(after.acceptedTermsAt?.toISOString()).toBe(before.acceptedTermsAt?.toISOString());

      const audit = await lastAudit('profile.updated_by_admin', s.id);
      expect(audit.actorId).toBe(admin.id);
      expect(audit.metadata).toMatchObject({ section: 'core', fields: expect.arrayContaining(['fullNameEn', 'city', 'googleEmail']) });
      const meta = JSON.stringify(audit.metadata);
      for (const pii of ['Mona', 'Alexandria', '+20', 'gmail']) expect(meta).not.toContain(pii);

      // Clearing an optional field ("remove"): the Arabic name, a skill list, an old answer.
      await http().put(`/api/admin/students/${s.id}/profile/core`).set('Cookie', admin.cookie).send({ ...core, fullNameAr: '' }).expect(200);
      expect((await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } })).fullNameAr).toBeNull();
      await prisma.profile.update({ where: { userId: s.id }, data: { websiteUrl: 'https://mona.dev', university: 'Cairo University', openToOpportunities: true, shareWithPartners: true } });
      const other = { websiteUrl: '', kaggleUrl: '', huggingfaceUrl: '', fieldOfStudy: '', university: '', graduationYear: '', openToOpportunities: false, shareWithPartners: false };
      await http().put(`/api/admin/students/${s.id}/profile/other`).set('Cookie', admin.cookie).send(other).expect(200);
      expect(await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } })).toMatchObject({ websiteUrl: null, university: null, openToOpportunities: false, shareWithPartners: false });
    });

    it('never gives consent for the student: admins can only turn consents off', async () => {
      const s = await createUser(app, prisma, { prefix: 'consent' });
      const res = await http()
        .put(`/api/admin/students/${s.id}/profile/community`)
        .set('Cookie', admin.cookie)
        .send({ referralSource: 'EVENT', communityMember: true, marketingEmails: true })
        .expect(400);
      expect(res.body.code).toBe('CONSENT_STUDENT_ONLY');
      await http()
        .put(`/api/admin/students/${s.id}/profile/other`)
        .set('Cookie', admin.cookie)
        .send({ openToOpportunities: true, shareWithPartners: false })
        .expect(400);
      const answeredAt = (await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } })).communityAnsweredAt;
      await http().put(`/api/admin/students/${s.id}/profile/community`).set('Cookie', admin.cookie).send({ referralSource: 'EVENT', communityMember: true, marketingEmails: false }).expect(200);
      const p = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });
      expect(p).toMatchObject({ referralSource: 'EVENT', communityMember: true });
      // An admin's correction doesn't count as the student answering the step.
      expect(p.communityAnsweredAt?.toISOString()).toBe(answeredAt?.toISOString());
    });

    it("can't edit or delete an admin account", async () => {
      const other = await createUser(app, prisma, { role: 'ADMIN', prefix: 'other-admin' });
      const res = await http().put(`/api/admin/students/${other.id}/profile/core`).set('Cookie', admin.cookie).send(core).expect(403);
      expect(res.body.code).toBe('ADMIN_ACCOUNT');
      await http().post(`/api/admin/students/${other.id}/delete`).set('Cookie', admin.cookie).send({ confirm: other.email }).expect(403);
      await http().post(`/api/admin/students/${admin.id}/delete`).set('Cookie', admin.cookie).send({ confirm: 'x' }).expect(403);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).deletedAt).toBeNull();
    });

    it('deletes an account through the usual deletion flow, after a typed confirmation', async () => {
      const s = await createUser(app, prisma, { prefix: 'del-stu' });
      const wrong = await http().post(`/api/admin/students/${s.id}/delete`).set('Cookie', admin.cookie).send({ confirm: 'someone-else@example.test' }).expect(400);
      expect(wrong.body.code).toBe('CONFIRM_MISMATCH');
      await http().post(`/api/admin/students/${s.id}/delete`).set('Cookie', s.cookie).send({ confirm: s.email }).expect(403);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).deletedAt).toBeNull();

      await http().post(`/api/admin/students/${s.id}/delete`).set('Cookie', admin.cookie).send({ confirm: ` ${s.email.toUpperCase()} ` }).expect(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: s.id } });
      expect(user.deletedAt).not.toBeNull();
      // Anonymised later by the same job as self-deleted accounts; they can't sign in now.
      expect(user.anonymizedAt).toBeNull();
      await http().get('/api/me/profile').set('Cookie', s.cookie).expect(401);
      const audit = await lastAudit('account.deleted_by_admin', s.id);
      expect(audit.actorId).toBe(admin.id);
      expect(JSON.stringify(audit.metadata)).not.toContain(s.email);
      expect(sent).toEqual([expect.objectContaining({ to: s.email, template: { name: 'accountDeleted', byTeam: true } })]);
      // Gone from the directory, and can't be deleted twice.
      await http().get(`/api/admin/students/${s.id}`).set('Cookie', admin.cookie).expect(404);
      await http().post(`/api/admin/students/${s.id}/delete`).set('Cookie', admin.cookie).send({ confirm: s.email }).expect(404);
    });

    it('adds a student by email: no password is set for them, they choose it from the email', async () => {
      const email = uniqueEmail('added');
      await http().post('/api/admin/students').set('Cookie', admin.cookie).send({ email: 'not-an-email' }).expect(400);
      const res = await http().post('/api/admin/students').set('Cookie', admin.cookie).send({ email: email.toUpperCase(), locale: 'ar', fullNameEn: 'Added Person' }).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id }, include: { profile: true } });
      expect(user).toMatchObject({ email, role: 'STUDENT', passwordHash: null, emailVerifiedAt: null, locale: 'ar' });
      expect(user.profile?.fullNameEn).toBe('Added Person');
      expect((await lastAudit('user.created_by_admin', user.id)).actorId).toBe(admin.id);

      await new Promise((r) => setTimeout(r, 20));
      const mail = sent.find((m) => m.template.name === 'accountCreated');
      expect(mail?.to).toBe(email);
      const url = (mail!.template as { url: string }).url;
      expect(url).toMatch(/\/ar\/reset-password\?token=[^&]+&welcome=1$/);
      const token = new URL(url).searchParams.get('token')!;

      const dup = await http().post('/api/admin/students').set('Cookie', admin.cookie).send({ email }).expect(409);
      expect(dup.body).toMatchObject({ code: 'EMAIL_TAKEN', userId: user.id });

      // They set their own password (which also confirms the address), then sign in.
      await http().post('/api/auth/reset-password').send({ token, password: 'their-own-password-1' }).expect((r) => expect(r.status).toBeLessThan(300));
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
      await http().post('/api/auth/login').send({ email, password: 'their-own-password-1' }).expect((r) => expect(r.status).toBeLessThan(300));
    });

    it('saving the community step keeps the stored answers it no longer asks', async () => {
      const s = await createUser(app, prisma, { prefix: 'keep' });
      await prisma.profile.update({ where: { userId: s.id }, data: { openToOpportunities: true, shareWithPartners: true } });
      const res = await http()
        .put('/api/me/profile/community')
        .set('Cookie', s.cookie)
        // An old client may still send them: ignored either way.
        .send({ referralSource: 'YOUTUBE', communityMember: false, marketingEmails: false, openToOpportunities: false, shareWithPartners: false })
        .expect(200);
      expect(res.body).toMatchObject({ referralSource: 'YOUTUBE', coreComplete: true });
      const p = await prisma.profile.findUniqueOrThrow({ where: { userId: s.id } });
      expect(p).toMatchObject({ openToOpportunities: true, shareWithPartners: true, referralSource: 'YOUTUBE' });
      // Without them: the step is still complete.
      await http().put('/api/me/profile/community').set('Cookie', s.cookie).send({ referralSource: 'YOUTUBE', communityMember: true, marketingEmails: true }).expect(200);
      expect((await http().get('/api/me/profile').set('Cookie', s.cookie).expect(200)).body.coreComplete).toBe(true);
    });
  });

  describe('speakers', () => {
    it("deleting a speaker account's profile sends its approved application back for review", async () => {
      const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'reopen', coreComplete: false });
      const appRow = await prisma.speakerApplication.create({
        data: { userId: s.id, status: 'APPROVED', fullName: 'Re Open', phone: '+201001234567', linkedinUrl: 'https://www.linkedin.com/in/re-open', title: 'Engineer', country: 'EG', bio: 'x'.repeat(40), areas: ['MLOPS'], sessionTitle: 'A talk', abstract: 'y'.repeat(60), format: 'TALK', language: 'EN', preferredMonths: ['2026-12'], reviewedAt: new Date() },
      });
      const profile = await prisma.instructor.create({ data: { slug: `re-open-${Date.now()}`, name: 'Re Open', titleEn: '', bioEn: '', userId: s.id, source: 'speaker-portal' } });
      const detail = await http().get(`/api/admin/instructors/${profile.id}`).set('Cookie', admin.cookie).expect(200);
      expect(detail.body).toMatchObject({ userId: s.id, applicationId: appRow.id });
      await http().post(`/api/admin/instructors/${profile.id}/delete`).set('Cookie', admin.cookie).send({ confirm: 'Re Open' }).expect(200);
      expect((await prisma.speakerApplication.findUniqueOrThrow({ where: { id: appRow.id } })).status).toBe('SUBMITTED');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).deletedAt).toBeNull();
      expect((await lastAudit('instructor.deleted', profile.id)).metadata).toMatchObject({ hadAccount: true, applicationReopened: true });
    });

    const profile = (over: Record<string, unknown> = {}) => ({
      name: 'Sara Speaker',
      nameAr: 'سارة',
      titleEn: 'Staff Engineer',
      bioEn: 'Builds platforms.',
      linkedinUrl: 'https://www.linkedin.com/in/sara-speaker',
      githubUrl: '',
      photoUrl: '',
      ...over,
    });

    it('edits every profile field; a new slug keeps the old address working', async () => {
      const slug = `sara-${Date.now()}`;
      const created = await http().post('/api/admin/instructors').set('Cookie', admin.cookie).send(profile({ slug })).expect(201);
      const id = created.body.id;
      // Public once it has a published session.
      await prisma.liveEvent.create({ data: { slug: `talk-${slug}`, status: 'PUBLISHED', titleEn: 'Talk', titleAr: 'محاضرة', startsAt: new Date(Date.now() - 86_400_000), speakerId: id } });
      await http().put(`/api/admin/instructors/${id}`).set('Cookie', admin.cookie).send(profile({ slug, linkedinUrl: 'https://twitter.com/sara' })).expect(400);

      const moved = `${slug}-new`;
      const res = await http()
        .put(`/api/admin/instructors/${id}`)
        .set('Cookie', admin.cookie)
        .send(profile({ slug: moved, name: 'Sara S.', titleAr: 'مهندسة', bioAr: 'تبني المنصات', githubUrl: 'https://github.com/sara', photoUrl: 'https://example.com/sara.jpg' }))
        .expect(200);
      expect(res.body).toMatchObject({ slug: moved, name: 'Sara S.', githubUrl: 'https://github.com/sara' });
      const detail = await http().get(`/api/admin/instructors/${id}`).set('Cookie', admin.cookie).expect(200);
      expect(detail.body).toMatchObject({ previousSlugs: [slug], userId: null, applicationId: null });
      // The old address finds the speaker under the new slug (the page redirects).
      expect((await http().get(`/api/speakers/${slug}`).expect(200)).body.slug).toBe(moved);
      expect((await http().get(`/api/speakers/${moved}`).expect(200)).body.slug).toBe(moved);
      expect((await lastAudit('instructor.updated', id)).metadata).toEqual({ slugChanged: true });

      // Another speaker taking the old slug wins it: the redirect stops.
      const other = await http().post('/api/admin/instructors').set('Cookie', admin.cookie).send(profile({ slug, name: 'Other Sara' })).expect(201);
      expect((await http().get(`/api/admin/instructors/${id}`).set('Cookie', admin.cookie).expect(200)).body.previousSlugs).toEqual([]);
      await http().get(`/api/speakers/${slug}`).expect(404); // the new owner has no public session yet
      await http().post(`/api/admin/instructors/${other.body.id}/delete`).set('Cookie', admin.cookie).send({ confirm: 'Other Sara' }).expect(200);
    });

    it('deletes a speaker profile after a typed confirmation; their sessions stay without the link', async () => {
      const created = await http().post('/api/admin/instructors').set('Cookie', admin.cookie).send(profile({ name: `Gone ${Date.now()}` })).expect(201);
      const id = created.body.id;
      const event = await prisma.liveEvent.create({ data: { slug: `gone-${Date.now()}`, status: 'PUBLISHED', titleEn: 'Talk', titleAr: 'محاضرة', startsAt: new Date(Date.now() - 86_400_000), speakerId: id } });
      await http().post(`/api/admin/instructors/${id}/delete`).set('Cookie', admin.cookie).send({ confirm: 'wrong' }).expect(400);
      const s = await createUser(app, prisma, { prefix: 'not-admin' });
      await http().post(`/api/admin/instructors/${id}/delete`).set('Cookie', s.cookie).send({ confirm: created.body.name }).expect(403);

      const res = await http().post(`/api/admin/instructors/${id}/delete`).set('Cookie', admin.cookie).send({ confirm: created.body.name.toLowerCase() }).expect(200);
      expect(res.body).toEqual({ events: 1, courses: 0 });
      expect(await prisma.instructor.findUnique({ where: { id } })).toBeNull();
      expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: event.id } })).speakerId).toBeNull();
      await http().get(`/api/events/${event.slug}`).expect(200);
      const audit = await lastAudit('instructor.deleted', id);
      expect(audit.metadata).toEqual({ events: 1, courses: 0, guestOf: 0, hadAccount: false, applicationReopened: false });
      await http().post(`/api/admin/instructors/${id}/delete`).set('Cookie', admin.cookie).send({ confirm: created.body.name }).expect(404);
    });
  });
});
