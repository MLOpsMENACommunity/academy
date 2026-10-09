import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AnnouncementDelivery } from '../src/announcements/announcement-delivery.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('admin panel API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string) => http().post(url).set('Cookie', cookie),
    put: (url: string) => http().put(url).set('Cookie', cookie),
    del: (url: string) => http().delete(url).set('Cookie', cookie),
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('is admin-only', async () => {
    const student = await createUser(app, prisma);
    for (const url of ['/api/admin/dashboard', '/api/admin/applications', '/api/admin/students', '/api/admin/courses', '/api/admin/audit']) {
      await as(student.cookie).get(url).expect(403);
    }
    await http().get('/api/admin/dashboard').expect(401);
  });

  it('filters applications by profile fields, including skill levels', async () => {
    const course = await createCourse(prisma);
    const senior = await createUser(app, prisma, { prefix: 'senior' });
    const junior = await createUser(app, prisma, { prefix: 'junior' });
    await prisma.profile.update({
      where: { userId: senior.id },
      data: { country: 'SA', experienceYears: 'Y10_PLUS', seniority: 'SENIOR', openToOpportunities: true, skills: { create: [{ skill: 'KUBERNETES', level: 4 }] } },
    });
    await prisma.profile.update({
      where: { userId: junior.id },
      data: { country: 'EG', experienceYears: 'Y0_1', seniority: 'JUNIOR', skills: { create: [{ skill: 'KUBERNETES', level: 2 }] } },
    });
    for (const u of [senior, junior]) {
      await http().post('/api/applications').set('Cookie', u.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    }
    const q = (s: string) => as(admin.cookie).get(`/api/admin/applications?courseId=${course.id}&${s}`).expect(200);
    expect((await q('skills=KUBERNETES:3')).body.items.map((i: { student: { id: string } }) => i.student.id)).toEqual([senior.id]);
    expect((await q('country=EG')).body.items).toHaveLength(1);
    expect((await q('experienceMin=Y5_10')).body.total).toBe(1);
    expect((await q('openToOpportunities=true')).body.total).toBe(1);
    expect((await q('seniority=SENIOR,JUNIOR&sort=experience')).body.items[0].student.id).toBe(senior.id);
    await as(admin.cookie).get('/api/admin/applications?skills=KUBERNETES:9').expect(400);
    const first = (await q('')).body.items[0];
    expect(first.availableEvents).toContain('SHORTLIST');
  });

  it('exports CSV safely and audits the export', async () => {
    const course = await createCourse(prisma);
    const s = await createUser(app, prisma);
    await prisma.profile.update({ where: { userId: s.id }, data: { fullNameEn: '=cmd|calc' } });
    await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    const res = await as(admin.cookie).get(`/api/admin/applications.csv?courseId=${course.id}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=cmd|calc"`);
    expect(res.text).toContain('"Q: Committed?"');
    expect(await prisma.auditLog.count({ where: { actorId: admin.id, action: 'applications.exported' } })).toBeGreaterThan(0);
  });

  it('runs bulk actions and reports per-item results', async () => {
    const course = await createCourse(prisma);
    const users = await Promise.all([createUser(app, prisma), createUser(app, prisma)]);
    const ids: string[] = [];
    for (const u of users) {
      ids.push((await http().post('/api/applications').set('Cookie', u.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201)).body.id);
    }
    const res = await as(admin.cookie).post('/api/admin/applications/bulk').send({ ids: [...ids, 'missing'], event: 'SHORTLIST' }).expect(200);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.results.find((r: { id: string }) => r.id === 'missing').ok).toBe(false);
    const detail = await as(admin.cookie).get(`/api/admin/applications/${ids[0]}`).expect(200);
    expect(detail.body.status).toBe('SHORTLISTED');
    expect(detail.body.profileSnapshot.fullNameEn).toBe('Test Person');
    await as(admin.cookie).post(`/api/admin/applications/${ids[0]}/notes`).send({ body: 'Strong candidate' }).expect(201);
    expect((await as(admin.cookie).get(`/api/admin/applications/${ids[0]}`)).body.notes[0].body).toBe('Strong candidate');
  });

  // QA L25: an admin who applied to a course can't shortlist, accept or reject themselves.
  it('never lets an admin change the status of their own application', async () => {
    const course = await createCourse(prisma);
    const me = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin-applicant' });
    const appId = (await http().post('/api/applications').set('Cookie', me.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201)).body.id;

    const own = await as(me.cookie).post(`/api/admin/applications/${appId}/transition`).send({ event: 'ACCEPT' }).expect(403);
    expect(own.body.code).toBe('OWN_APPLICATION');
    const bulk = await as(me.cookie).post('/api/admin/applications/bulk').send({ ids: [appId], event: 'SHORTLIST' }).expect(200);
    expect(bulk.body.succeeded).toBe(0);
    // The admin panel offers no status changes on it (the UI hides them).
    expect((await as(me.cookie).get(`/api/admin/applications/${appId}`).expect(200)).body).toMatchObject({ ownApplication: true, availableEvents: [], status: 'SUBMITTED' });
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: appId, toStatus: { not: 'SUBMITTED' } } })).toBe(0);

    // Another admin decides as usual.
    const other = await as(admin.cookie).get(`/api/admin/applications/${appId}`).expect(200);
    expect(other.body.ownApplication).toBe(false);
    expect(other.body.availableEvents).toContain('SHORTLIST');
    await as(admin.cookie).post(`/api/admin/applications/${appId}/transition`).send({ event: 'SHORTLIST' }).expect(200);
  });

  it('lists students (not admins or deleted users) and audits CV views', async () => {
    const s = await createUser(app, prisma, { prefix: 'dir' });
    const gone = await createUser(app, prisma, { prefix: 'gone' });
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const res = await as(admin.cookie).get(`/api/admin/students?q=${encodeURIComponent(s.email.split('@')[0]!)}`).expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([s.id]);
    expect((await as(admin.cookie).get(`/api/admin/students?q=${encodeURIComponent(gone.email.split('@')[0]!)}`)).body.total).toBe(0);
    expect((await as(admin.cookie).get(`/api/admin/students?q=${encodeURIComponent(admin.id)}`)).body.total).toBe(0);
    await as(admin.cookie).get(`/api/admin/students/${s.id}/cv`).expect(404);
    const csv = await as(admin.cookie).get('/api/admin/students.csv?country=EG').expect(200);
    expect(csv.text.startsWith('﻿"Student ID"')).toBe(true);
  });

  it('creates and edits courses, questions and sessions', async () => {
    const slug = `adm-${Date.now()}`;
    const base = {
      slug, titleEn: 'Admin course', titleAr: 'دورة', shortDescriptionEn: 'Short description here', shortDescriptionAr: 'وصف قصير للدورة هنا',
      longDescriptionEn: '# Hi', longDescriptionAr: '# مرحبا', type: 'PAID', price: 1500, currency: 'EGP', requiresApproval: true, capacity: 20,
      status: 'DRAFT', level: 'INTERMEDIATE', language: 'AR', startDate: '2026-12-01T17:00:00Z',
      targetAudience: { en: 'Engineers', ar: 'مهندسون' }, notFor: { en: 'Beginners', ar: 'المبتدئون' },
      learningOutcomes: { en: ['X'], ar: ['س'] }, prerequisites: { en: [], ar: [] },
      outline: [{ titleEn: 'M1', titleAr: 'و1' }], faq: [], included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'GOOGLE_DRIVE', driveFolderUrl: 'https://drive.google.com/drive/folders/X', instructorIds: [],
    };
    const created = await as(admin.cookie).post('/api/admin/courses').send(base).expect(201);
    await as(admin.cookie).post('/api/admin/courses').send(base).expect(409);
    // Draft: hidden from the public catalog.
    await http().get(`/api/courses/${slug}`).expect(404);
    await as(admin.cookie).put(`/api/admin/courses/${created.body.id}`).send({ ...base, status: 'OPEN' }).expect(200);
    await http().get(`/api/courses/${slug}`).expect(200);

    const q1 = await as(admin.cookie).put(`/api/admin/courses/${created.body.id}/questions`).send({
      questions: [
        { type: 'LONG_TEXT', labelEn: 'Why?', labelAr: 'لماذا؟', required: true },
        { type: 'SINGLE_SELECT', labelEn: 'Level', labelAr: 'المستوى', required: true, options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }, { value: 'b', labelEn: 'B', labelAr: 'ب' }] },
      ],
    }).expect(200);
    const keptId = q1.body[0].id;
    const q2 = await as(admin.cookie).put(`/api/admin/courses/${created.body.id}/questions`).send({
      questions: [{ id: keptId, type: 'LONG_TEXT', labelEn: 'Why exactly?', labelAr: 'لماذا تحديدًا؟', required: true }],
    }).expect(200);
    expect(q2.body).toHaveLength(1);
    expect(q2.body[0]).toMatchObject({ id: keptId, labelEn: 'Why exactly?' });

    const s1 = await as(admin.cookie).post(`/api/admin/courses/${created.body.id}/sessions`).send({ titleEn: 'One', titleAr: 'واحد', startsAt: '2026-12-01T17:00:00Z', durationMin: 90, liveUrl: 'https://meet.google.com/a', materials: [] }).expect(201);
    const s2 = await as(admin.cookie).post(`/api/admin/courses/${created.body.id}/sessions`).send({ titleEn: 'Two', titleAr: 'اثنان', startsAt: '2026-12-08T17:00:00Z', durationMin: 90, materials: [] }).expect(201);
    const reordered = await as(admin.cookie).put(`/api/admin/courses/${created.body.id}/sessions/order`).send({ ids: [s2.body.id, s1.body.id] }).expect(200);
    expect(reordered.body.map((s: { titleEn: string }) => s.titleEn)).toEqual(['Two', 'One']);
    await as(admin.cookie).del(`/api/admin/courses/${created.body.id}/sessions/${s1.body.id}`).expect(204);
    const full = await as(admin.cookie).get(`/api/admin/courses/${created.body.id}`).expect(200);
    expect(full.body.sessions).toHaveLength(1);
    expect(full.body.driveFolderUrl).toContain('drive.google.com');
  });

  it('tracks Drive access per enrolment and audits it', async () => {
    const course = await createCourse(prisma, { type: 'PAID', price: 100 });
    const s = await createUser(app, prisma);
    const e = await prisma.enrollment.create({ data: { userId: s.id, courseId: course.id, driveRevokeEmail: 'old@gmail.com' } });
    const pending = await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments?driveAccess=pending`).expect(200);
    expect(pending.body[0]).toMatchObject({ googleEmail: `g.${s.email}`, driveRevokeEmail: 'old@gmail.com', driveAccessGranted: false });
    await as(admin.cookie).put(`/api/admin/enrollments/${e.id}/drive-access`).send({ granted: true }).expect(200);
    expect((await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments?driveAccess=pending`)).body).toHaveLength(0);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: e.id } })).driveRevokeEmail).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: e.id, action: 'enrollment.drive_access_granted' } })).toBe(1);
    const csv = await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments.csv`).expect(200);
    expect(csv.text).toContain(`g.${s.email}`);
  });

  it('sends announcements to the chosen statuses, in-app and by email, exactly once', async () => {
    const course = await createCourse(prisma);
    const enrolled = await createUser(app, prisma, { prefix: 'ann-in' });
    const waiting = await createUser(app, prisma, { prefix: 'ann-wait' });
    const gone = await createUser(app, prisma, { prefix: 'ann-gone' });
    for (const [u, status] of [[enrolled, 'ENROLLED'], [waiting, 'WAITLISTED'], [gone, 'ENROLLED']] as const) {
      await prisma.application.create({ data: { userId: u.id, courseId: course.id, status, answers: {}, profileSnapshot: {} } });
    }
    await prisma.enrollment.create({ data: { userId: enrolled.id, courseId: course.id } });
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const audience = (s: string) => as(admin.cookie).get(`/api/admin/courses/${course.id}/announcements/audience?statuses=${s}`).expect(200);
    expect((await audience('ENROLLED')).body.count).toBe(1);
    expect((await audience('ENROLLED,WAITLISTED')).body.count).toBe(2);
    const key = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await as(admin.cookie).post(`/api/admin/courses/${course.id}/announcements`).send({ subjectEn: 'Hi', bodyEn: 'x', statuses: ['REJECTED'], idempotencyKey: key() }).expect(400);
    await as(admin.cookie).post(`/api/admin/courses/${course.id}/announcements`).send({ subjectEn: 'Hi', bodyEn: 'x', statuses: ['ENROLLED'] }).expect(400);

    const payload = { subjectEn: 'Telegram group', bodyEn: 'Join here: https://t.me/example', statuses: ['ENROLLED'], idempotencyKey: key() };
    const sent = await as(admin.cookie).post(`/api/admin/courses/${course.id}/announcements`).send(payload).expect(201);
    expect(sent.body.recipients).toBe(1);
    // A retried request (same key) returns the same announcement and sends nothing new.
    const again = await as(admin.cookie).post(`/api/admin/courses/${course.id}/announcements`).send(payload).expect(201);
    expect(again.body.id).toBe(sent.body.id);
    expect(await prisma.notification.count({ where: { userId: enrolled.id, type: 'course.announcement' } })).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: enrolled.id, type: 'course.announcement' } });
    expect(n).toMatchObject({ bodyAr: 'Join here: https://t.me/example', link: expect.stringMatching(/^\/learn\//) });
    expect(await prisma.notification.count({ where: { userId: waiting.id, type: 'course.announcement' } })).toBe(0);

    // Delivery runs after the response from the durable queue.
    let history: { subject: string; recipients: number; sent: number; pending: number }[] = [];
    for (let i = 0; i < 50 && !history[0]?.sent; i++) {
      await new Promise((r) => setTimeout(r, 100));
      history = (await as(admin.cookie).get(`/api/admin/courses/${course.id}/announcements`).expect(200)).body;
    }
    expect(history[0]).toMatchObject({ subject: 'Telegram group', recipients: 1, sent: 1, pending: 0 });
    await http().get(`/api/admin/courses/${course.id}/announcements`).set('Cookie', enrolled.cookie).expect(403);

    // The enrolled student also sees it on the course page.
    const learn = await http().get(`/api/learn/${course.slug}`).set('Cookie', enrolled.cookie).expect(200);
    expect(learn.body.announcements[0]).toMatchObject({ subjectEn: 'Telegram group', bodyAr: 'Join here: https://t.me/example' });
  });

  it('resumes announcement emails left pending (e.g. by a restart)', async () => {
    const course = await createCourse(prisma);
    const u = await createUser(app, prisma, { prefix: 'ann-resume' });
    const a = await prisma.announcement.create({
      data: { courseId: course.id, idempotencyKey: `resume-${Date.now()}`, subjectEn: 'S', subjectAr: '', bodyEn: 'B', bodyAr: '', statuses: ['ENROLLED'] },
    });
    const r = await prisma.announcementRecipient.create({ data: { announcementId: a.id, userId: u.id, enrolled: true } });
    await app.get(AnnouncementDelivery).process();
    expect(await prisma.announcementRecipient.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('duplicates a course as a draft and adds weekly sessions in bulk', async () => {
    const src = await createCourse(prisma);
    await prisma.course.update({ where: { id: src.id }, data: { preparation: { en: 'Create a repo', ar: 'أنشئ مستودعًا' } } });
    await prisma.courseSession.create({ data: { courseId: src.id, order: 1, titleEn: 'S1', titleAr: 'ج1', startsAt: new Date('2026-10-18T16:00:00Z'), liveUrl: 'https://meet.google.com/old-link' } });
    const slug = `copy-${Date.now()}`;
    const dup = await as(admin.cookie).post(`/api/admin/courses/${src.id}/duplicate`).send({ slug, titleEn: 'Next cohort' }).expect(201);
    const copy = (await as(admin.cookie).get(`/api/admin/courses/${dup.body.id}`).expect(200)).body;
    expect(copy).toMatchObject({ slug, titleEn: 'Next cohort', status: 'DRAFT', preparation: { en: 'Create a repo', ar: 'أنشئ مستودعًا' } });
    expect(copy.questions).toHaveLength(1);
    expect(copy.questions[0].id).not.toBe(src.questionId);
    expect(copy.sessions).toHaveLength(1);
    expect(copy.sessions[0].liveUrl).toBeNull();
    await as(admin.cookie).post(`/api/admin/courses/${src.id}/duplicate`).send({ slug, titleEn: 'Again' }).expect(409);

    const bulk = await as(admin.cookie)
      .post(`/api/admin/courses/${dup.body.id}/sessions/bulk`)
      .send({ sessions: [1, 2].map((n) => ({ titleEn: `Session ${n + 1}`, titleAr: `الجلسة ${n + 1}`, startsAt: `2026-11-0${n}T17:00:00Z`, durationMin: 90 })) })
      .expect(201);
    expect(bulk.body.map((s: { order: number }) => s.order)).toEqual([1, 2, 3]);
  });

  it('deletes a course nobody applied to, and only archives one with applicants', async () => {
    const empty = await createCourse(prisma);
    await as(admin.cookie).del(`/api/admin/courses/${empty.id}`).expect(204);
    expect(await prisma.course.findUnique({ where: { id: empty.id } })).toBeNull();
    expect(await prisma.screeningQuestion.count({ where: { courseId: empty.id } })).toBe(0);

    const used = await createCourse(prisma);
    const s = await createUser(app, prisma, { prefix: 'del' });
    await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: used.slug, answers: { [used.questionId]: true } }).expect(201);
    const res = await as(admin.cookie).del(`/api/admin/courses/${used.id}`).expect(409);
    expect(res.body.code).toBe('COURSE_HAS_APPLICANTS');
    await as(admin.cookie).post(`/api/admin/courses/${used.id}/archive`).expect(204);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: used.id } })).status).toBe('ARCHIVED');
    expect(await prisma.application.count({ where: { courseId: used.id } })).toBe(1);
    await http().delete(`/api/admin/courses/${used.id}`).set('Cookie', s.cookie).expect(403);
  });

  it('saves English-only drafts but needs Arabic to publish', async () => {
    const input = {
      slug: `draft-${Date.now()}`, titleEn: 'English only', titleAr: '', shortDescriptionEn: 'An English-only draft course', shortDescriptionAr: '',
      longDescriptionEn: '', longDescriptionAr: '', type: 'FREE', price: 0, requiresApproval: true, status: 'DRAFT', level: 'ALL_LEVELS', language: 'EN',
      targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' }, learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] },
      outline: [], faq: [], included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'YOUTUBE', instructorIds: [],
    };
    const created = await as(admin.cookie).post('/api/admin/courses').send(input).expect(201);
    await as(admin.cookie).put(`/api/admin/courses/${created.body.id}`).send({ ...input, status: 'OPEN' }).expect(400);
  });

  it('keeps deleted students listed until their old Drive address is removed', async () => {
    const course = await createCourse(prisma);
    const s = await createUser(app, prisma, { prefix: 'leaver' });
    const e = await prisma.enrollment.create({ data: { userId: s.id, courseId: course.id, driveAccessGranted: false, driveRevokeEmail: 'leaver@gmail.com' } });
    await prisma.user.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    const list = await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments?driveAccess=pending`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ deleted: true, driveRevokeEmail: 'leaver@gmail.com', name: null, email: null, phone: null });
    const csv = await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments.csv`).expect(200);
    expect(csv.text).toContain('leaver@gmail.com');
    expect(csv.text).not.toContain(s.email);
    await as(admin.cookie).post(`/api/admin/enrollments/${e.id}/drive-removed`).expect(204);
    expect((await as(admin.cookie).get(`/api/admin/courses/${course.id}/enrollments`)).body).toHaveLength(0);
    await as(admin.cookie).post(`/api/admin/enrollments/${e.id}/drive-removed`).expect(404);
  });

  it('hides accounts pending deletion from applications and their CVs', async () => {
    const course = await createCourse(prisma);
    const s = await createUser(app, prisma, { prefix: 'pending-del' });
    await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    await prisma.profile.update({ where: { userId: s.id }, data: { cvKey: 'cv/test.pdf' } });
    await prisma.user.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    expect((await as(admin.cookie).get(`/api/admin/applications?courseId=${course.id}`)).body.total).toBe(0);
    expect((await as(admin.cookie).get(`/api/admin/applications.csv?courseId=${course.id}`)).text).not.toContain(s.email);
    await as(admin.cookie).get(`/api/admin/students/${s.id}/cv`).expect(404);
  });

  it('refuses to delete a screening question that has answers', async () => {
    const course = await createCourse(prisma);
    const s = await createUser(app, prisma, { prefix: 'answered' });
    await http().post('/api/applications').set('Cookie', s.cookie).send({ courseSlug: course.slug, answers: { [course.questionId]: true } }).expect(201);
    const res = await as(admin.cookie).put(`/api/admin/courses/${course.id}/questions`).send({ questions: [] }).expect(409);
    expect(res.body.code).toBe('QUESTION_ANSWERED');
    expect(await prisma.screeningQuestion.count({ where: { courseId: course.id } })).toBe(1);
  });

  it('shows the dashboard funnel, feedback, audit log and private saved views', async () => {
    const course = await createCourse(prisma);
    await http().post('/api/funnel/events').send({ courseSlug: course.slug, event: 'COURSE_VIEW', anonymousId: 'a1' }).expect(204);
    await http().post('/api/funnel/events').send({ courseSlug: course.slug, event: 'COURSE_VIEW', anonymousId: 'a1' }).expect(204);
    await http().post('/api/funnel/events').send({ courseSlug: course.slug, event: 'COURSE_VIEW', anonymousId: 'a2' }).expect(204);
    const dash = await as(admin.cookie).get('/api/admin/dashboard').expect(200);
    const row = dash.body.courses.find((c: { id: string }) => c.id === course.id);
    expect(row.funnel.COURSE_VIEW).toBe(2);
    expect(typeof dash.body.pendingPayments).toBe('number');
    expect(dash.body.courseCount).toBeGreaterThanOrEqual(dash.body.courses.length);
    expect(dash.body.courses.length).toBeLessThanOrEqual(12);

    expect((await as(admin.cookie).get(`/api/admin/courses/${course.id}/feedback`).expect(200)).body.course.count).toBe(0);
    const audit = await as(admin.cookie).get('/api/admin/audit?action=enrollment').expect(200);
    expect(audit.body.items.every((i: { action: string }) => i.action.startsWith('enrollment'))).toBe(true);

    const saved = await as(admin.cookie).post('/api/admin/saved-filters').send({ scope: 'APPLICATIONS', name: 'Senior MLOps KSA/EG', query: 'country=SA,EG&seniority=SENIOR' }).expect(201);
    const other = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin2' });
    expect((await as(other.cookie).get('/api/admin/saved-filters?scope=APPLICATIONS')).body).toHaveLength(0);
    await as(other.cookie).del(`/api/admin/saved-filters/${saved.body.id}`).expect(404);
    await as(admin.cookie).del(`/api/admin/saved-filters/${saved.body.id}`).expect(204);
  });
});
