import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AdminPermission } from '@academy/shared';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 2)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PDF = Buffer.from('%PDF-1.7\n%stuff');

/** Admin presets: who reaches what, the team page, and image uploads. */
describe('admin permissions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let course: { id: string; slug: string };
  let instructorId: string;
  let eventId: string;
  const sent: { to: string; template: EmailTemplate }[] = [];
  const http = () => request(app.getHttpServer());
  const admins = {} as Record<AdminPermission, { id: string; email: string; cookie: string }>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template) => {
      sent.push({ to, template });
      return true;
    });
    for (const p of ['SUPER', 'ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'] as const) {
      admins[p] = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: [p], prefix: `perm-${p.toLowerCase()}` });
    }
    course = await createCourse(prisma);
    const ins = await prisma.instructor.create({ data: { name: 'Perm Speaker', slug: `perm-speaker-${Date.now()}`, titleEn: '', bioEn: '' } });
    instructorId = ins.id;
    const ev = await prisma.liveEvent.create({ data: { slug: `perm-ev-${Date.now()}`, titleEn: 'Perm session', startsAt: new Date(Date.now() + 86_400_000) } });
    eventId = ev.id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('each preset reaches exactly its routes', () => {
    // [route, presets that may use it besides SUPER]
    const matrix: [string, AdminPermission[]][] = [
      ['/api/admin/dashboard', ['ACADEMIC', 'ADMISSIONS', 'FINANCE']],
      ['/api/admin/students', ['ADMISSIONS']],
      ['/api/admin/applications', ['ADMISSIONS']],
      ['/api/admin/payments', ['FINANCE']],
      ['/api/admin/courses', ['ACADEMIC', 'ADMISSIONS']],
      ['/api/admin/courses/:course', ['ACADEMIC', 'ADMISSIONS']],
      ['/api/admin/courses/:course/enrollments', ['ACADEMIC', 'ADMISSIONS']],
      ['/api/admin/courses/:course/assessments', ['ACADEMIC']],
      ['/api/admin/courses/:course/certificates', ['ACADEMIC']],
      ['/api/admin/courses/:course/leaderboard', ['ACADEMIC']],
      ['/api/admin/courses/:course/feedback', ['ACADEMIC']],
      ['/api/admin/courses/:course/invites', ['ADMISSIONS']],
      ['/api/admin/courses/:course/waitlist', ['ADMISSIONS']],
      ['/api/admin/badges', ['ACADEMIC']],
      ['/api/admin/events', ['ACADEMIC']],
      ['/api/admin/instructors', ['ACADEMIC', 'SPEAKERS']],
      ['/api/admin/speaker-applications', ['SPEAKERS']],
      ['/api/admin/speaking-slots', ['SPEAKERS']],
      ['/api/admin/instructors/:instructor/courses', ['SPEAKERS']],
      ['/api/admin/media/library', ['CONTENT']],
      ['/api/admin/settings', []],
      ['/api/admin/audit', []],
      ['/api/admin/team', []],
    ];
    it.each(matrix)('%s', async (route, allowed) => {
      const url = route.replace(':course', course.id).replace(':instructor', instructorId);
      for (const p of Object.keys(admins) as AdminPermission[]) {
        const res = await http().get(url).set('Cookie', admins[p].cookie);
        const ok = p === 'SUPER' || allowed.includes(p);
        expect([p, res.status]).toEqual([p, ok ? 200 : 403]);
        if (!ok) expect(res.body.code).toBe('ADMIN_PERMISSION');
      }
    });

    it('a content admin cannot use the full editors or see personal data', async () => {
      const c = admins.CONTENT.cookie;
      const someone = await createUser(app, prisma, { prefix: 'perm-victim' });
      await http().get(`/api/admin/students/${someone.id}`).set('Cookie', c).expect(403);
      await http().get(`/api/admin/students.csv`).set('Cookie', c).expect(403);
      await http().get(`/api/admin/events/${eventId}/registrations`).set('Cookie', c).expect(403);
      await http().put(`/api/admin/courses/${course.id}`).set('Cookie', c).send({}).expect(403);
      await http().put(`/api/admin/events/${eventId}`).set('Cookie', c).send({}).expect(403);
      await http().put(`/api/admin/instructors/${instructorId}`).set('Cookie', c).send({}).expect(403);
      await http().put('/api/admin/settings').set('Cookie', c).send({}).expect(403);
      await http().post(`/api/admin/applications/x/transition`).set('Cookie', c).send({ event: 'SHORTLIST' }).expect(403);
      // Previewing a course's learn page (live links, materials, announcements) is for the academic preset.
      await http().get(`/api/learn/${course.slug}`).set('Cookie', c).expect(403);
      await http().get(`/api/learn/${course.slug}/leaderboard`).set('Cookie', c).expect(403);
      await http().get(`/api/learn/${course.slug}`).set('Cookie', admins.ACADEMIC.cookie).expect(200);
    });

    it('/auth/me says what the admin may do', async () => {
      const me = await http().get('/api/auth/me').set('Cookie', admins.CONTENT.cookie).expect(200);
      expect(me.body.adminPermissions).toEqual(['CONTENT']);
      const student = await createUser(app, prisma, { prefix: 'perm-me' });
      expect((await http().get('/api/auth/me').set('Cookie', student.cookie).expect(200)).body.adminPermissions).toEqual([]);
    });

    it('a change of presets applies on the next request, without signing out', async () => {
      const a = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'perm-live' });
      await http().get('/api/admin/students').set('Cookie', a.cookie).expect(403);
      await http().put(`/api/admin/team/${a.id}`).set('Cookie', admins.SUPER.cookie).send({ permissions: ['ADMISSIONS'] }).expect(200);
      await http().get('/api/admin/students').set('Cookie', a.cookie).expect(200);
      await http().get('/api/admin/media/library').set('Cookie', a.cookie).expect(403);
      // Removed from the team: a student account, the same session, no admin route.
      await http().post(`/api/admin/team/${a.id}/remove`).set('Cookie', admins.SUPER.cookie).expect(200);
      await http().get('/api/admin/students').set('Cookie', a.cookie).expect(403);
      expect((await http().get('/api/auth/me').set('Cookie', a.cookie).expect(200)).body).toMatchObject({ role: 'STUDENT', adminPermissions: [] });
    });

    it('an admin with no presets reaches no admin route', async () => {
      const a = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: [], prefix: 'perm-none' });
      for (const url of ['/api/admin/dashboard', '/api/admin/courses', '/api/admin/media/library', '/api/admin/team']) {
        await http().get(url).set('Cookie', a.cookie).expect(403);
      }
    });

    it('notifies only the admins whose presets cover it', async () => {
      const list = await app.get(NotificationsService).notifyAdmins({ type: 'test', titleEn: 'x', titleAr: 'x', bodyEn: 'x', bodyAr: 'x' }, ['SPEAKERS']);
      const ids = list.map((a) => a.id);
      expect(ids).toEqual(expect.arrayContaining([admins.SUPER.id, admins.SPEAKERS.id]));
      for (const p of ['ACADEMIC', 'CONTENT', 'ADMISSIONS', 'FINANCE'] as const) expect(ids).not.toContain(admins[p].id);
    });
  });

  describe('team', () => {
    it('validates presets', async () => {
      const s = admins.SUPER.cookie;
      await http().post('/api/admin/team').set('Cookie', s).send({ email: uniqueEmail('perm-x'), permissions: [] }).expect(400);
      await http().post('/api/admin/team').set('Cookie', s).send({ email: uniqueEmail('perm-x'), permissions: ['ROOT'] }).expect(400);
      await http().put(`/api/admin/team/${admins.FINANCE.id}`).set('Cookie', s).send({ permissions: [] }).expect(400);
      // Each once, in order.
      const r = await http().put(`/api/admin/team/${admins.FINANCE.id}`).set('Cookie', s).send({ permissions: ['FINANCE', 'ACADEMIC', 'FINANCE'] }).expect(200);
      expect(r.body.permissions).toEqual(['ACADEMIC', 'FINANCE']);
      await http().put(`/api/admin/team/${admins.FINANCE.id}`).set('Cookie', s).send({ permissions: ['FINANCE'] }).expect(200);
    });

    it('invites a new address: an admin account with no password, and a choose-your-password email', async () => {
      sent.length = 0;
      const email = uniqueEmail('perm-new');
      const r = await http().post('/api/admin/team').set('Cookie', admins.SUPER.cookie).send({ email, permissions: ['CONTENT'], locale: 'ar', fullNameEn: 'New Admin' }).expect(201);
      expect(r.body).toMatchObject({ outcome: 'invited', member: { email, permissions: ['CONTENT'], pending: true, name: 'New Admin' } });
      const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { passwordResetTokens: true } });
      expect(u).toMatchObject({ role: 'ADMIN', adminPermissions: ['CONTENT'], passwordHash: null, locale: 'ar' });
      expect(u.passwordResetTokens).toHaveLength(1);
      expect(sent).toEqual([expect.objectContaining({ to: email, template: expect.objectContaining({ name: 'accountCreated' }) })]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.invited', entityId: u.id } });
      expect(audit).toMatchObject({ actorId: admins.SUPER.id, metadata: { permissions: ['CONTENT'] } });
      // Listed on the team.
      const team = await http().get('/api/admin/team').set('Cookie', admins.SUPER.cookie).expect(200);
      expect(team.body.map((m: { email: string }) => m.email)).toContain(email);
    });

    it('promotes an existing account (any letter case), refuses admins and deleted accounts', async () => {
      const s = admins.SUPER.cookie;
      const student = await createUser(app, prisma, { prefix: 'perm-promote' });
      const r = await http().post('/api/admin/team').set('Cookie', s).send({ email: student.email.toUpperCase(), permissions: ['ADMISSIONS', 'FINANCE'] }).expect(201);
      expect(r.body).toMatchObject({ outcome: 'promoted', member: { id: student.id, permissions: ['ADMISSIONS', 'FINANCE'] } });
      await http().get('/api/admin/payments').set('Cookie', student.cookie).expect(200);
      expect(await prisma.notification.count({ where: { userId: student.id, type: 'admin.added' } })).toBe(1);
      expect((await http().post('/api/admin/team').set('Cookie', s).send({ email: student.email, permissions: ['CONTENT'] }).expect(409)).body.code).toBe('ALREADY_ADMIN');
      const gone = await createUser(app, prisma, { prefix: 'perm-gone' });
      await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      expect((await http().post('/api/admin/team').set('Cookie', s).send({ email: gone.email, permissions: ['CONTENT'] }).expect(409)).body.code).toBe('EMAIL_TAKEN');
      await http().put(`/api/admin/team/${gone.id}`).set('Cookie', s).send({ permissions: ['CONTENT'] }).expect(404);
      // An account that never confirmed its address can't be promoted (anyone can register any address).
      const squatter = await createUser(app, prisma, { prefix: 'perm-squat', verified: false });
      expect((await http().post('/api/admin/team').set('Cookie', s).send({ email: squatter.email, permissions: ['SUPER'] }).expect(409)).body.code).toBe('EMAIL_UNVERIFIED');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } })).role).toBe('STUDENT');
      // Only admins are edited here.
      const other = await createUser(app, prisma, { prefix: 'perm-not-admin' });
      await http().put(`/api/admin/team/${other.id}`).set('Cookie', s).send({ permissions: ['SUPER'] }).expect(404);
      await http().post(`/api/admin/team/${other.id}/remove`).set('Cookie', s).expect(404);
    });

    describe('the last super admin', () => {
      let others: string[] = [];
      let a: { id: string; email: string; cookie: string };
      let b: { id: string; email: string; cookie: string };

      // Every other super admin in the test database steps aside for these tests, then comes back.
      beforeEach(async () => {
        a = await createUser(app, prisma, { role: 'ADMIN', prefix: 'perm-sa' });
        b = await createUser(app, prisma, { role: 'ADMIN', prefix: 'perm-sb' });
        others = (await prisma.user.findMany({ where: { role: 'ADMIN', adminPermissions: { has: 'SUPER' }, id: { notIn: [a.id, b.id] } }, select: { id: true } })).map((x) => x.id);
        await prisma.user.updateMany({ where: { id: { in: others } }, data: { adminPermissions: ['ACADEMIC'] } });
      });
      afterEach(async () => {
        await prisma.user.updateMany({ where: { id: { in: others } }, data: { adminPermissions: ['SUPER'] } });
        await prisma.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { role: 'STUDENT', adminPermissions: [] } });
      });

      it("can't be demoted or removed", async () => {
        await http().put(`/api/admin/team/${b.id}`).set('Cookie', a.cookie).send({ permissions: ['ACADEMIC'] }).expect(200);
        expect((await http().put(`/api/admin/team/${a.id}`).set('Cookie', a.cookie).send({ permissions: ['ACADEMIC'] }).expect(409)).body.code).toBe('LAST_SUPER');
        expect((await http().post(`/api/admin/team/${a.id}/remove`).set('Cookie', a.cookie).expect(409)).body.code).toBe('LAST_SUPER');
        // Keeping SUPER while adding others is fine.
        await http().put(`/api/admin/team/${a.id}`).set('Cookie', a.cookie).send({ permissions: ['SUPER', 'FINANCE'] }).expect(200);
        // And a super admin can't delete their own account while they are the last one.
        const accounts = app.get(AccountService);
        await expect(accounts.deleteAccount({ id: a.id, role: 'ADMIN', amr: 'google', authTime: new Date() }, undefined)).rejects.toMatchObject({ status: 409 });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).toBeNull();
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.permissions_changed', entityId: b.id }, orderBy: { createdAt: 'desc' } });
        expect(audit.metadata).toEqual({ from: ['SUPER'], to: ['ACADEMIC'] });
      });

      it('two super admins removing each other at once: one wins, one super admin is left', async () => {
        const [r1, r2] = await Promise.all([
          http().post(`/api/admin/team/${b.id}/remove`).set('Cookie', a.cookie),
          http().post(`/api/admin/team/${a.id}/remove`).set('Cookie', b.cookie),
        ]);
        // The loser is refused (409), or finds it was removed first (403: no longer an admin).
        expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
        expect([403, 409]).toContain([r1.status, r2.status].find((s) => s !== 200));
        expect(await prisma.user.count({ where: { id: { in: [a.id, b.id] }, role: 'ADMIN', adminPermissions: { has: 'SUPER' } } })).toBe(1);
      });

      it('two super admins demoting themselves at once: one super admin is left', async () => {
        const [r1, r2] = await Promise.all([
          http().put(`/api/admin/team/${a.id}`).set('Cookie', a.cookie).send({ permissions: ['CONTENT'] }),
          http().put(`/api/admin/team/${b.id}`).set('Cookie', b.cookie).send({ permissions: ['CONTENT'] }),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        expect(await prisma.user.count({ where: { id: { in: [a.id, b.id] }, adminPermissions: { has: 'SUPER' } } })).toBe(1);
      });
    });
  });

  describe('media', () => {
    const upload = (cookie: string, body: Buffer, name = 'cover.png') => http().post('/api/admin/media/upload').set('Cookie', cookie).attach('file', body, name);

    it('a content admin uploads a cover; everyone gets it from /api/media, cached for a year', async () => {
      const r = await upload(admins.CONTENT.cookie, PNG).expect(201);
      expect(r.body.url).toMatch(/^\/api\/media\/[0-9a-f-]{36}\.png$/);
      const img = await http().get(r.body.url).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(img.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect(img.headers['set-cookie']).toBeUndefined();
      expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

      const saved = await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', admins.CONTENT.cookie).send({ coverImageUrl: r.body.url }).expect(200);
      expect(saved.body).toEqual({ id: course.id, coverImageUrl: r.body.url, youtubePlaylistUrl: null });
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).coverImageUrl).toBe(r.body.url);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'media.updated', entityId: course.id }, orderBy: { createdAt: 'desc' } });
      expect(audit.metadata).toEqual({ fields: ['coverImageUrl'] });
      // The full course form accepts the uploaded image too (academic editors).
      const full = await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admins.ACADEMIC.cookie).expect(200);
      expect(full.body.coverImageUrl).toBe(r.body.url);
    });

    it('accepts WebP; refuses SVG, PDF, empty and oversized files, whatever their name', async () => {
      const w = await upload(admins.CONTENT.cookie, WEBP, 'a.webp').expect(201);
      expect(w.body.url).toMatch(/\.webp$/);
      expect((await http().get(w.body.url).expect(200)).headers['content-type']).toBe('image/webp');
      expect((await upload(admins.CONTENT.cookie, SVG, 'evil.png').expect(400)).body.code).toBe('FILE_TYPE');
      expect((await upload(admins.CONTENT.cookie, PDF, 'doc.jpg').expect(400)).body.code).toBe('FILE_TYPE');
      await http().post('/api/admin/media/upload').set('Cookie', admins.CONTENT.cookie).expect(400);
      await upload(admins.CONTENT.cookie, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])).expect(413);
    });

    it('lets academic and speakers editors upload, nobody else', async () => {
      await upload(admins.ACADEMIC.cookie, PNG).expect(201);
      await upload(admins.SPEAKERS.cookie, PNG).expect(201);
      await upload(admins.FINANCE.cookie, PNG).expect(403);
      await upload(admins.ADMISSIONS.cookie, PNG).expect(403);
      const student = await createUser(app, prisma, { prefix: 'perm-up' });
      await upload(student.cookie, PNG).expect(403);
      await http().post('/api/admin/media/upload').attach('file', PNG, 'a.png').expect(401);
    });

    it('serves only uploaded images by their random name', async () => {
      await http().get('/api/media/0f8fad5b-d9cb-469f-a165-70867728950e.png').expect(404);
      await http().get('/api/media/0f8fad5b-d9cb-469f-a165-70867728950e.svg').expect(404);
      await http().get('/api/media/..%2Fpayments%2Fx.png').expect(404);
      await http().get('/api/media/x.png').expect(404);
    });

    it('changes only media fields, validated', async () => {
      const c = admins.CONTENT.cookie;
      await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', c).send({ titleEn: 'Hacked' }).expect(400);
      await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', c).send({ coverImageUrl: 'javascript:alert(1)' }).expect(400);
      await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', c).send({ coverImageUrl: '/api/media/../../etc.png' }).expect(400);
      await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', c).send({}).expect(400);
      await http().patch(`/api/admin/media/courses/${course.id}`).set('Cookie', c).send({ youtubePlaylistUrl: 'https://www.youtube.com/playlist?list=PL1' }).expect(200);
      const after = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(after.titleEn).toBe('Test course');
      expect(after.youtubePlaylistUrl).toBe('https://www.youtube.com/playlist?list=PL1');

      const session = await prisma.courseSession.create({ data: { courseId: course.id, order: 1, titleEn: 'S1', titleAr: 'S1', startsAt: new Date() } });
      await http().patch(`/api/admin/media/courses/${course.id}/sessions/${session.id}`).set('Cookie', c).send({ recordingUrl: 'https://youtu.be/abc' }).expect(200);
      await http().patch(`/api/admin/media/courses/${course.id}/sessions/${session.id}`).set('Cookie', c).send({ liveUrl: 'https://meet.google.com/x' }).expect(400);
      const other = await createCourse(prisma);
      await http().patch(`/api/admin/media/courses/${other.id}/sessions/${session.id}`).set('Cookie', c).send({ recordingUrl: 'https://youtu.be/abc' }).expect(404);

      const ev = await http().patch(`/api/admin/media/events/${eventId}`).set('Cookie', c).send({ speakerPhotoUrl: 'https://example.com/p.jpg', recordingUrl: '' }).expect(200);
      expect(ev.body).toMatchObject({ speakerPhotoUrl: 'https://example.com/p.jpg', recordingUrl: null });
      await http().patch(`/api/admin/media/events/${eventId}`).set('Cookie', c).send({ status: 'PUBLISHED' }).expect(400);
      await http().patch(`/api/admin/media/instructors/${instructorId}`).set('Cookie', c).send({ photoUrl: '' }).expect(200);
      await http().patch(`/api/admin/media/instructors/${instructorId}`).set('Cookie', c).send({ name: 'x' }).expect(400);
      await http().patch(`/api/admin/media/instructors/nope`).set('Cookie', c).send({ photoUrl: '' }).expect(404);
    });

    it('lists names, dates and media fields only', async () => {
      const r = await http().get('/api/admin/media/library').set('Cookie', admins.CONTENT.cookie).expect(200);
      const mine = r.body.courses.find((x: { id: string }) => x.id === course.id);
      expect(Object.keys(mine).sort()).toEqual(['coverImageUrl', 'id', 'sessions', 'slug', 'status', 'titleAr', 'titleEn', 'youtubePlaylistUrl']);
      expect(Object.keys(mine.sessions[0]).sort()).toEqual(['id', 'order', 'recordingUrl', 'startsAt', 'titleAr', 'titleEn']);
      expect(Object.keys(r.body.events[0]).sort()).toEqual(['coverImageUrl', 'id', 'recordingUrl', 'slug', 'speakerName', 'speakerPhotoUrl', 'startsAt', 'status', 'titleAr', 'titleEn']);
      expect(Object.keys(r.body.speakers[0]).sort()).toEqual(['id', 'name', 'nameAr', 'photoUrl', 'slug']);
    });
  });
});
