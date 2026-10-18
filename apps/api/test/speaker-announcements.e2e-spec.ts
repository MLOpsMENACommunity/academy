import type { NestExpressApplication } from '@nestjs/platform-express';
import { SPEAKER_ANNOUNCEMENTS_PER_DAY, SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY } from '@academy/shared';
import request from 'supertest';
import { AnnouncementDelivery } from '../src/announcements/announcement-delivery.service';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

type Account = { id: string; email: string; cookie: string };
type Speaker = Account & { instructorId: string; name: string };

describe('speaker announcements (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  let sent: { to: string; template: EmailTemplate; bulk: boolean }[] = [];
  const http = () => request(app.getHttpServer());
  let n = 0;
  const key = () => `spk-ann-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  const message = (over: Record<string, unknown> = {}) => ({
    subjectEn: 'Slides from today',
    bodyEn: 'Thanks for joining!\n\nThe slides are here: https://example.test/slides',
    idempotencyKey: key(),
    ...over,
  });

  async function speaker(name: string): Promise<Speaker> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spk-ann', coreComplete: false });
    const i = await prisma.instructor.create({
      data: { slug: `spk-ann-${Date.now()}-${++n}`, name, nameAr: `${name} (ع)`, titleEn: 'Engineer', bioEn: '', userId: s.id },
    });
    return { ...s, instructorId: i.id, name };
  }
  async function student(courseId: string | null, status: 'ENROLLED' | 'SHORTLISTED' | 'SUBMITTED' = 'ENROLLED'): Promise<Account> {
    const s = await createUser(app, prisma, { prefix: 'spk-ann-stu' });
    if (courseId) await prisma.application.create({ data: { userId: s.id, courseId, status, answers: {}, profileSnapshot: {} } });
    if (courseId && status === 'ENROLLED') await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    return s;
  }
  async function session(speakerId: string | null, opts: { startsAt?: Date; status?: 'PUBLISHED' | 'DRAFT' } = {}) {
    return prisma.liveEvent.create({
      data: {
        slug: `spk-ann-ev-${Date.now()}-${++n}`,
        titleEn: 'Feature stores in practice',
        titleAr: 'مخازن الميزات عمليًا',
        status: opts.status ?? 'PUBLISHED',
        startsAt: opts.startsAt ?? new Date(Date.now() + 7 * 86_400_000),
        speakerId,
      },
    });
  }
  const assign = (instructorId: string, courseId: string) =>
    http().put(`/api/admin/instructors/${instructorId}/courses/${courseId}`).set('Cookie', admin.cookie);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'spk-ann-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template, opts) => {
      sent.push({ to, template, bulk: Boolean(opts?.bulk) });
      return true;
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  describe('admin: assigned courses', () => {
    it('assigns and unassigns courses (audited); archived courses cannot be assigned; admins only', async () => {
      const spk = await speaker('Assign Me');
      const course = await createCourse(prisma);
      const archived = await createCourse(prisma);
      await prisma.course.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });

      const before = await http().get(`/api/admin/instructors/${spk.instructorId}/courses`).set('Cookie', admin.cookie).expect(200);
      expect(before.body.account).toMatchObject({ email: spk.email, role: 'SPEAKER', active: true });
      expect(before.body.assigned).toEqual([]);
      expect(before.body.available.map((c: { id: string }) => c.id)).toContain(course.id);
      expect(before.body.available.map((c: { id: string }) => c.id)).not.toContain(archived.id);

      const res = await assign(spk.instructorId, course.id).expect(200);
      expect(res.body.assigned.map((c: { id: string }) => c.id)).toEqual([course.id]);
      expect(res.body.available.map((c: { id: string }) => c.id)).not.toContain(course.id);
      // Assigning twice is a no-op (one link, one audit row).
      await assign(spk.instructorId, course.id).expect(200);
      expect(await prisma.courseInstructor.count({ where: { instructorId: spk.instructorId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'instructor.course_assigned', entityId: spk.instructorId, actorId: admin.id } })).toBe(1);

      const bad = await assign(spk.instructorId, archived.id).expect(400);
      expect(bad.body.code).toBe('COURSE_ARCHIVED');
      await assign(spk.instructorId, 'nope').expect(404);
      await http().put(`/api/admin/instructors/nope/courses/${course.id}`).set('Cookie', admin.cookie).expect(404);
      // Not for speakers or students.
      await http().put(`/api/admin/instructors/${spk.instructorId}/courses/${course.id}`).set('Cookie', spk.cookie).expect(403);
      await http().get(`/api/admin/instructors/${spk.instructorId}/courses`).set('Cookie', spk.cookie).expect(403);

      const off = await http().delete(`/api/admin/instructors/${spk.instructorId}/courses/${course.id}`).set('Cookie', admin.cookie).expect(200);
      expect(off.body.assigned).toEqual([]);
      expect(await prisma.auditLog.count({ where: { action: 'instructor.course_unassigned', entityId: spk.instructorId } })).toBe(1);
    });
  });

  describe('course announcements', () => {
    let spk: Speaker;
    let course: { id: string; slug: string };
    let other: { id: string };
    let enrolled: Account[];
    let shortlisted: Account;
    let applicant: Account;

    beforeAll(async () => {
      spk = await speaker('Mona Speaker');
      course = await createCourse(prisma);
      other = await createCourse(prisma);
      await assign(spk.instructorId, course.id).expect(200);
      enrolled = [await student(course.id), await student(course.id)];
      shortlisted = await student(course.id, 'SHORTLISTED');
      applicant = await student(course.id, 'SUBMITTED');
      // A deleted enrolled student is never counted or messaged.
      const gone = await student(course.id);
      await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      await student(other.id); // enrolled elsewhere
    });

    it('lists only assigned courses, with the audience as a number', async () => {
      const res = await http().get('/api/speaker/announcements').set('Cookie', spk.cookie).expect(200);
      expect(res.body.hasProfile).toBe(true);
      expect(res.body.courses).toEqual([expect.objectContaining({ id: course.id, audience: 2, sentToday: 0 })]);
      expect(res.body.limits).toEqual({ perTargetPerDay: SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY, perDay: SPEAKER_ANNOUNCEMENTS_PER_DAY, sentToday: 0 });
      // Never who: no email addresses anywhere in the response.
      expect(JSON.stringify(res.body)).not.toMatch(/@example\.test/);
    });

    it('sends to enrolled students only: in-app now, email from the queue, "From" the speaker; audited', async () => {
      const res = await http()
        .post(`/api/speaker/courses/${course.id}/announcements`)
        .set('Cookie', spk.cookie)
        .send(message({ subjectAr: 'الشرائح', bodyAr: 'شكرًا لحضوركم' }))
        .expect(201);
      expect(res.body).toEqual({ id: expect.any(String), recipients: 2 });

      const recipients = await prisma.announcementRecipient.findMany({ where: { announcementId: res.body.id }, select: { userId: true } });
      expect(recipients.map((r) => r.userId).sort()).toEqual(enrolled.map((e) => e.id).sort());

      const notes = await prisma.notification.findMany({ where: { type: 'course.announcement', userId: { in: [...enrolled, shortlisted, applicant].map((u) => u.id) } } });
      expect(notes.map((x) => x.userId).sort()).toEqual(enrolled.map((e) => e.id).sort());
      expect(notes[0]).toMatchObject({ bodyEn: expect.stringMatching(/^From Mona Speaker\n/), bodyAr: expect.stringMatching(/^من Mona Speaker \(ع\)\n/), link: `/learn/${course.slug}#announcements` });

      await app.get(AnnouncementDelivery).process();
      const mails = sent.filter((m) => m.template.name === 'announcement');
      expect(mails.map((m) => m.to).sort()).toEqual(enrolled.map((e) => e.email).sort());
      expect(mails.every((m) => m.bulk)).toBe(true);
      expect(mails[0]!.template).toMatchObject({ from: 'Mona Speaker', session: false, subject: 'Slides from today' });

      const a = await prisma.announcement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(a).toMatchObject({ createdById: spk.id, courseId: course.id, eventId: null, fromName: 'Mona Speaker', statuses: ['ENROLLED'] });
      const audit = await prisma.auditLog.findFirst({ where: { action: 'announcement.sent_by_speaker', entityId: res.body.id } });
      expect(audit).toMatchObject({ actorId: spk.id, metadata: { courseId: course.id, recipients: 2, instructorId: spk.instructorId } });

      // Enrolled students see it on the learn page, from the speaker.
      const learn = await http().get(`/api/learn/${course.slug}`).set('Cookie', enrolled[0]!.cookie).expect(200);
      expect(learn.body.announcements[0]).toMatchObject({ id: res.body.id, subjectAr: 'الشرائح', fromEn: 'Mona Speaker', fromAr: 'Mona Speaker (ع)' });

      // Admins see it in the course's Announcements tab, labelled with the speaker.
      const history = await http().get(`/api/admin/courses/${course.id}/announcements`).set('Cookie', admin.cookie).expect(200);
      expect(history.body[0]).toMatchObject({ id: res.body.id, fromSpeaker: 'Mona Speaker', by: spk.email, sent: 2, recipients: 2 });

      // The speaker's own list shows delivery counts.
      const mine = await http().get('/api/speaker/announcements').set('Cookie', spk.cookie).expect(200);
      expect(mine.body.sent[0]).toMatchObject({ id: res.body.id, kind: 'course', targetId: course.id, recipients: 2, sent: 2, pending: 0, failed: 0 });
      expect(mine.body.courses[0].sentToday).toBe(1);
    });

    it('never sends twice for one idempotency key, and a key cannot be borrowed', async () => {
      const body = message();
      const first = await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(body).expect(201);
      const again = await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(body).expect(201);
      expect(again.body).toEqual(first.body);
      expect(await prisma.announcement.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
      // Another staff member of the same course can't reuse the key either.
      const thief = await speaker('Key Thief');
      await assign(thief.instructorId, course.id).expect(200);
      const res = await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', thief.cookie).send(body).expect(409);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    // Fresh speakers below keep each one under the per-route request throttle (10 a minute).
    it('403 for a course the speaker is not assigned to, or one that does not exist', async () => {
      const u = await speaker('Assigned Elsewhere');
      await assign(u.instructorId, course.id).expect(200);
      for (const id of [other.id, 'does-not-exist']) {
        const res = await http().post(`/api/speaker/courses/${id}/announcements`).set('Cookie', u.cookie).send(message()).expect(403);
        // The course routes answer for an unknown course the same as for someone else's.
        expect(res.body.code).toBe('NOT_YOUR_COURSE');
      }
      expect(await prisma.announcement.count({ where: { courseId: other.id } })).toBe(0);
    });

    it('validates length and strips control characters', async () => {
      const spk = await speaker('Careful Speaker');
      await assign(spk.instructorId, course.id).expect(200);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message({ subjectEn: 'x'.repeat(121) })).expect(400);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message({ bodyEn: 'x'.repeat(3001) })).expect(400);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message({ subjectEn: '\u0007' })).expect(400);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message({ idempotencyKey: 'short' })).expect(400);
      const res = await http()
        .post(`/api/speaker/courses/${course.id}/announcements`)
        .set('Cookie', spk.cookie)
        .send(message({ subjectEn: 'Room\u202Echange\u0000', bodyEn: 'Line one\r\n\r\n\r\n\r\nLine two' }))
        .expect(201);
      const a = await prisma.announcement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(a.subjectEn).toBe('Roomchange');
      expect(a.bodyEn).toBe('Line one\n\nLine two');
    });

    it('limits each course to 5 a day per speaker', async () => {
      const used = await prisma.announcement.count({ where: { createdById: spk.id, courseId: course.id } });
      for (let i = used; i < SPEAKER_ANNOUNCEMENTS_PER_TARGET_PER_DAY; i++) {
        await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message()).expect(201);
      }
      const res = await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message()).expect(429);
      expect(res.body.code).toBe('SPEAKER_TARGET_LIMIT');
      // Yesterday's messages don't count.
      await prisma.announcement.updateMany({ where: { createdById: spk.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', spk.cookie).send(message()).expect(201);
    });

    it('loses access when unassigned or deleted (switched to a student, they stay course staff)', async () => {
      const s = await speaker('Leaving Speaker');
      await assign(s.instructorId, course.id).expect(200);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(201);

      await http().delete(`/api/admin/instructors/${s.instructorId}/courses/${course.id}`).set('Cookie', admin.cookie).expect(200);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(403);
      expect((await http().get('/api/speaker/announcements').set('Cookie', s.cookie).expect(200)).body.courses).toEqual([]);

      await assign(s.instructorId, course.id).expect(200);
      await prisma.user.update({ where: { id: s.id }, data: { role: 'STUDENT' } });
      await http().post(`/api/teach/courses/${course.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(201);
      await prisma.user.update({ where: { id: s.id }, data: { role: 'SPEAKER', deletedAt: new Date() } });
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(401);

      // An archived course drops out, assignment or not.
      const t = await speaker('Archive Speaker');
      const old = await createCourse(prisma);
      await assign(t.instructorId, old.id).expect(200);
      await student(old.id);
      await prisma.course.update({ where: { id: old.id }, data: { status: 'ARCHIVED' } });
      await http().post(`/api/speaker/courses/${old.id}/announcements`).set('Cookie', t.cookie).send(message()).expect(403);
    });

    it('students and admins cannot use the speaker endpoints; a speaker without a profile has nothing', async () => {
      for (const who of [enrolled[0]!, admin]) {
        await http().get('/api/speaker/announcements').set('Cookie', who.cookie).expect(403);
      }
      // Course announcements: a student off the staff gets 403; an admin preset without courses too.
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', enrolled[0]!.cookie).send(message()).expect(403);
      const content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'spk-ann-content' });
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', content.cookie).send(message()).expect(403);
      await http().post(`/api/speaker/courses/${course.id}/announcements`).send(message()).expect(401);
      const bare = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spk-ann-bare', coreComplete: false });
      expect((await http().get('/api/speaker/announcements').set('Cookie', bare.cookie).expect(200)).body).toMatchObject({ hasProfile: false, courses: [], sessions: [] });
      await http().post(`/api/speaker/courses/${course.id}/announcements`).set('Cookie', bare.cookie).send(message()).expect(403);
    });

    it('refuses an empty audience', async () => {
      const s = await speaker('Empty Room');
      const empty = await createCourse(prisma);
      await assign(s.instructorId, empty.id).expect(200);
      const res = await http().post(`/api/speaker/courses/${empty.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(400);
      expect(res.body.code).toBe('NO_RECIPIENTS');
    });
  });

  describe('live session announcements', () => {
    it("reaches that session's registrants only; another speaker's session is 403; hosts and guests may send", async () => {
      const mine = await speaker('Session Speaker');
      const theirs = await speaker('Other Speaker');
      const host = await speaker('Session Host');
      const ev = await session(mine.instructorId);
      await prisma.liveEventSpeaker.create({ data: { eventId: ev.id, instructorId: host.instructorId, role: 'HOST' } });
      const otherEv = await session(theirs.instructorId);
      const draft = await session(mine.instructorId, { status: 'DRAFT' });
      const longAgo = await session(mine.instructorId, { startsAt: new Date(Date.now() - 40 * 86_400_000) });

      const r1 = await student(null);
      const r2 = await student(null);
      const elsewhere = await student(null);
      await prisma.eventRegistration.createMany({
        data: [
          { eventId: ev.id, userId: r1.id },
          { eventId: ev.id, userId: r2.id },
          { eventId: otherEv.id, userId: elsewhere.id },
        ],
      });

      const overview = await http().get('/api/speaker/announcements').set('Cookie', mine.cookie).expect(200);
      expect(overview.body.sessions).toEqual([expect.objectContaining({ id: ev.id, role: 'SPEAKER', audience: 2 })]);
      const hostView = await http().get('/api/speaker/announcements').set('Cookie', host.cookie).expect(200);
      expect(hostView.body.sessions).toEqual([expect.objectContaining({ id: ev.id, role: 'HOST', audience: 2 })]);

      const res = await http().post(`/api/speaker/sessions/${ev.id}/announcements`).set('Cookie', mine.cookie).send(message()).expect(201);
      expect(res.body.recipients).toBe(2);
      const recipients = await prisma.announcementRecipient.findMany({ where: { announcementId: res.body.id }, select: { userId: true } });
      expect(recipients.map((r) => r.userId).sort()).toEqual([r1.id, r2.id].sort());
      const notes = await prisma.notification.findMany({ where: { type: 'session.announcement', userId: { in: [r1.id, r2.id, elsewhere.id] } } });
      expect(notes.map((x) => x.userId).sort()).toEqual([r1.id, r2.id].sort());
      expect(notes[0]!.link).toBe(`/sessions/${ev.slug}`);
      const a = await prisma.announcement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(a).toMatchObject({ courseId: null, eventId: ev.id, fromName: 'Session Speaker' });
      expect(await prisma.auditLog.count({ where: { action: 'announcement.sent_by_speaker', entityId: res.body.id, actorId: mine.id } })).toBe(1);

      await app.get(AnnouncementDelivery).process();
      const mails = sent.filter((m) => m.template.name === 'announcement');
      expect(mails.map((m) => m.to).sort()).toEqual([r1.email, r2.email].sort());
      expect(mails[0]!.template).toMatchObject({ session: true, from: 'Session Speaker', courseTitle: 'Feature stores in practice', url: expect.stringContaining(`/sessions/${ev.slug}`) });

      // The co-host can send too.
      await http().post(`/api/speaker/sessions/${ev.id}/announcements`).set('Cookie', host.cookie).send(message()).expect(201);

      // Somebody else's session, a draft, one long past, a course id passed as a session: 403.
      for (const id of [otherEv.id, draft.id, longAgo.id, 'nope']) {
        await http().post(`/api/speaker/sessions/${id}/announcements`).set('Cookie', mine.cookie).send(message()).expect(403);
      }
      expect(await prisma.announcement.count({ where: { eventId: otherEv.id } })).toBe(0);
    });

    it('caps a speaker at 20 a day across all courses and sessions', async () => {
      const s = await speaker('Busy Speaker');
      const ev = await session(s.instructorId);
      const reg = await student(null);
      await prisma.eventRegistration.create({ data: { eventId: ev.id, userId: reg.id } });
      const elsewhere = await createCourse(prisma);
      await prisma.announcement.createMany({
        data: Array.from({ length: SPEAKER_ANNOUNCEMENTS_PER_DAY }, (_, i) => ({
          courseId: elsewhere.id,
          createdById: s.id,
          idempotencyKey: `${key()}-${i}`,
          subjectEn: 'x',
          subjectAr: '',
          bodyEn: 'x',
          bodyAr: '',
          statuses: ['ENROLLED'],
          fromName: s.name,
        })),
      });
      const res = await http().post(`/api/speaker/sessions/${ev.id}/announcements`).set('Cookie', s.cookie).send(message()).expect(429);
      expect(res.body.code).toBe('SPEAKER_DAILY_LIMIT');
      expect((await http().get('/api/speaker/announcements').set('Cookie', s.cookie).expect(200)).body.limits.sentToday).toBe(SPEAKER_ANNOUNCEMENTS_PER_DAY);
    });

    it('the database refuses an announcement with no target, or with both', async () => {
      const course = await createCourse(prisma);
      const ev = await session(null);
      const base = { createdById: admin.id, subjectEn: 'x', subjectAr: '', bodyEn: 'x', bodyAr: '', statuses: [] };
      await expect(prisma.announcement.create({ data: { ...base, idempotencyKey: key() } })).rejects.toThrow();
      await expect(prisma.announcement.create({ data: { ...base, idempotencyKey: key(), courseId: course.id, eventId: ev.id } })).rejects.toThrow();
    });
  });
});
