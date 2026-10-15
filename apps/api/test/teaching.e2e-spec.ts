import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { createCourse, createTestApp, createUser } from './helpers';

type Account = { id: string; email: string; cookie: string };
type Speaker = Account & { instructorId: string; name: string };

const quiz = (extra: Record<string, unknown> = {}) => ({
  type: 'QUIZ',
  status: 'DRAFT',
  titleEn: 'Week 1 quiz',
  instructionsEn: 'Answer both.',
  maxPoints: 10,
  questions: [
    { kind: 'SINGLE', promptEn: 'Pick MLflow', weight: 1, options: [{ labelEn: 'MLflow', correct: true }, { labelEn: 'Nginx', correct: false }] },
    { kind: 'TRUE_FALSE', promptEn: 'Feast is a feature store.', weight: 1, options: [{ labelEn: 'True', correct: true }, { labelEn: 'False', correct: false }] },
  ],
  ...extra,
});
const lab = (extra: Record<string, unknown> = {}) => ({ type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab 1', submissionKind: 'LINK', maxPoints: 20, ...extra });

describe('speakers teach their assigned courses (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  let sent: { to: string; template: EmailTemplate }[] = [];
  const http = () => request(app.getHttpServer());
  let n = 0;

  async function speaker(name: string): Promise<Speaker> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'teach-spk', coreComplete: false });
    const i = await prisma.instructor.create({ data: { slug: `teach-spk-${Date.now()}-${++n}`, name, titleEn: 'Engineer', bioEn: '', userId: s.id } });
    return { ...s, instructorId: i.id, name };
  }
  async function student(courseId: string): Promise<Account> {
    const s = await createUser(app, prisma, { prefix: 'teach-stu' });
    await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    return s;
  }
  const assign = (instructorId: string, courseId: string) => http().put(`/api/admin/instructors/${instructorId}/courses/${courseId}`).set('Cookie', admin.cookie).expect(200);
  const unassign = (instructorId: string, courseId: string) => http().delete(`/api/admin/instructors/${instructorId}/courses/${courseId}`).set('Cookie', admin.cookie).expect(200);
  const base = (courseId: string) => `/api/speaker/courses/${courseId}`;
  async function session(courseId: string) {
    return prisma.courseSession.create({
      data: { courseId, order: 1, titleEn: 'Session 1', titleAr: 'الجلسة ١', startsAt: new Date('2030-01-05T17:00:00Z'), liveUrl: 'https://meet.google.com/abc-defg-hij' },
    });
  }
  async function submitLink(slug: string, assessmentId: string, who: Account, url = 'https://example.org/my-lab') {
    return (await http().post(`/api/learn/${slug}/assessments/${assessmentId}/submission`).set('Cookie', who.cookie).send({ url, attested: true }).expect(200)).body as { id: string; submittedAt: string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'teach-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template) => {
      sent.push({ to, template });
      return true;
    });
    jest.spyOn(app.get(StorageService), 'signedUrl').mockResolvedValue('https://files.example.test/signed');
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets a speaker on two courses manage both, and lists only their non-archived courses', async () => {
    const spk = await speaker('Two Courses');
    const [c1, c2, other, archived] = await Promise.all([createCourse(prisma), createCourse(prisma), createCourse(prisma), createCourse(prisma)]);
    await assign(spk.instructorId, c1.id);
    await assign(spk.instructorId, c2.id);
    await assign(spk.instructorId, archived.id);
    await prisma.course.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });
    await student(c1.id);

    const mine = (await http().get('/api/speaker/courses').set('Cookie', spk.cookie).expect(200)).body as { id: string; students: number }[];
    expect(mine.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(mine.find((c) => c.id === c1.id)).toMatchObject({ students: 1, assessments: 0, toGrade: 0 });

    for (const c of [c1, c2]) {
      const a = (await http().post(`${base(c.id)}/assessments`).set('Cookie', spk.cookie).send(quiz()).expect(201)).body;
      expect(a.courseId).toBe(c.id);
      expect((await http().get(`${base(c.id)}/assessments`).set('Cookie', spk.cookie).expect(200)).body.map((r: { id: string }) => r.id)).toEqual([a.id]);
    }
    // Not assigned, archived, or unknown: one 403 for all.
    for (const id of [other.id, archived.id, 'no-such-course']) {
      expect((await http().get(`${base(id)}/assessments`).set('Cookie', spk.cookie).expect(403)).body.code).toBe('NOT_YOUR_COURSE');
      await http().post(`${base(id)}/assessments`).set('Cookie', spk.cookie).send(quiz()).expect(403);
      await http().get(base(id)).set('Cookie', spk.cookie).expect(403);
      await http().get(`${base(id)}/gradebook.csv`).set('Cookie', spk.cookie).expect(403);
      await http().get(`${base(id)}/points`).set('Cookie', spk.cookie).expect(403);
    }
    expect(await prisma.assessment.count({ where: { courseId: other.id } })).toBe(0);
  });

  it('lets two speakers on one course both manage it; admins see "by {name}"', async () => {
    const [ana, ben] = [await speaker('Ana Teacher'), await speaker('Ben Teacher')];
    const course = await createCourse(prisma);
    await assign(ana.instructorId, course.id);
    await assign(ben.instructorId, course.id);

    const a = (await http().post(`${base(course.id)}/assessments`).set('Cookie', ana.cookie).send(quiz()).expect(201)).body;
    expect(a.updatedBy).toBe('Ana Teacher');
    const edited = (await http().put(`${base(course.id)}/assessments/${a.id}`).set('Cookie', ben.cookie).send(quiz({ titleEn: 'Week 1 quiz (v2)' })).expect(200)).body;
    expect(edited).toMatchObject({ titleEn: 'Week 1 quiz (v2)', updatedBy: 'Ben Teacher' });
    const rows = (await http().get(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).expect(200)).body;
    expect(rows[0]).toMatchObject({ id: a.id, updatedBy: 'Ben Teacher' });

    const audit = await prisma.auditLog.findMany({ where: { entityId: a.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((x) => [x.action, x.actorId])).toEqual([
      ['assessment.created', ana.id],
      ['assessment.updated', ben.id],
    ]);
    // Ids only in the audit log.
    expect(JSON.stringify(audit.map((x) => x.metadata))).not.toMatch(/Week 1|@/);

    // Reorder, then delete (no submissions yet).
    const b = (await http().post(`${base(course.id)}/assessments`).set('Cookie', ben.cookie).send(quiz({ titleEn: 'Second' })).expect(201)).body;
    const order = (await http().put(`${base(course.id)}/assessments/order`).set('Cookie', ana.cookie).send({ ids: [b.id, a.id] }).expect(200)).body;
    expect(order.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
    await http().delete(`${base(course.id)}/assessments/${b.id}`).set('Cookie', ana.cookie).expect(204);
    expect(await prisma.auditLog.count({ where: { action: 'assessment.deleted', entityId: b.id, actorId: ana.id } })).toBe(1);
  });

  it('answers 404 for another course\'s assessments, submissions, sessions and students', async () => {
    const spk = await speaker('Scoped Speaker');
    const [mine, theirs] = [await createCourse(prisma), await createCourse(prisma)];
    const yours = await createCourse(prisma);
    await assign(spk.instructorId, mine.id);
    await assign(spk.instructorId, yours.id);
    const outsider = await student(theirs.id);
    const yoursStudent = await student(yours.id);

    // Things in a course the speaker does NOT teach, and in another course they DO teach.
    const foreign = (await http().post(`/api/admin/courses/${theirs.id}/assessments`).set('Cookie', admin.cookie).send(lab()).expect(201)).body;
    const foreignSub = await submitLink(theirs.slug, foreign.id, outsider);
    const sibling = (await http().post(`${base(yours.id)}/assessments`).set('Cookie', spk.cookie).send(lab()).expect(201)).body;
    const siblingSub = await submitLink(yours.slug, sibling.id, yoursStudent);
    const foreignSession = await session(theirs.id);
    const siblingSession = await session(yours.id);

    for (const id of [foreign.id, sibling.id, 'nope']) {
      await http().get(`${base(mine.id)}/assessments/${id}`).set('Cookie', spk.cookie).expect(404);
      await http().put(`${base(mine.id)}/assessments/${id}`).set('Cookie', spk.cookie).send(lab({ titleEn: 'Hijacked' })).expect(404);
      await http().delete(`${base(mine.id)}/assessments/${id}`).set('Cookie', spk.cookie).expect(404);
      await http().get(`${base(mine.id)}/assessments/${id}/submissions`).set('Cookie', spk.cookie).expect(404);
    }
    await http().put(`${base(mine.id)}/assessments/order`).set('Cookie', spk.cookie).send({ ids: [sibling.id] }).expect(404);
    for (const id of [foreignSub.id, siblingSub.id, 'nope']) {
      await http().get(`${base(mine.id)}/submissions/${id}`).set('Cookie', spk.cookie).expect(404);
      await http().get(`${base(mine.id)}/submissions/${id}/file`).set('Cookie', spk.cookie).expect(404);
      await http().put(`${base(mine.id)}/submissions/${id}/grade`).set('Cookie', spk.cookie).send({ score: 1 }).expect(404);
    }
    for (const id of [foreignSession.id, siblingSession.id, 'nope']) {
      await http().put(`${base(mine.id)}/sessions/${id}/materials`).set('Cookie', spk.cookie).send({ materials: [] }).expect(404);
    }
    for (const who of [outsider, yoursStudent]) {
      await http().post(`${base(mine.id)}/points`).set('Cookie', spk.cookie).send({ userId: who.id, points: 5, reason: 'MANUAL_OTHER', note: 'x' }).expect(404);
    }
    // The course the speaker doesn't teach: 403 even with its own ids.
    await http().get(`${base(theirs.id)}/assessments/${foreign.id}`).set('Cookie', spk.cookie).expect(403);
    await http().put(`${base(theirs.id)}/submissions/${foreignSub.id}/grade`).set('Cookie', spk.cookie).send({ score: 1 }).expect(403);
    await http().put(`${base(theirs.id)}/sessions/${foreignSession.id}/materials`).set('Cookie', spk.cookie).send({ materials: [] }).expect(403);

    // Nothing changed.
    expect((await prisma.assessment.findUniqueOrThrow({ where: { id: foreign.id } })).titleEn).toBe('Lab 1');
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: foreignSub.id } })).gradedAt).toBeNull();
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: siblingSub.id } })).gradedAt).toBeNull();
    expect(await prisma.pointsEntry.count({ where: { userId: { in: [outsider.id, yoursStudent.id] }, sourceType: null } })).toBe(0);
  });

  it('keeps students, other admins\' presets and unassigned speakers out; removal applies at once', async () => {
    const spk = await speaker('Soon Removed');
    const course = await createCourse(prisma);
    await assign(spk.instructorId, course.id);
    const stu = await student(course.id);
    const academic = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'teach-acad' });

    await http().get(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).expect(200);
    // Course routes are for the course's staff (any account role): a student who isn't on it gets 403;
    // SUPER and ACADEMIC admins can do everything in every course.
    await http().get(`${base(course.id)}/assessments`).set('Cookie', stu.cookie).expect(403);
    await http().get(`${base(course.id)}/assessments`).set('Cookie', academic.cookie).expect(200);
    expect((await http().get('/api/speaker/courses').set('Cookie', stu.cookie).expect(200)).body).toEqual([]);
    await http().get(`${base(course.id)}/assessments`).expect(401);
    // Speakers never reach the admin routes (certificates included).
    await http().get(`/api/admin/courses/${course.id}/assessments`).set('Cookie', spk.cookie).expect(403);
    await http().get(`/api/admin/courses/${course.id}/certificates`).set('Cookie', spk.cookie).expect(403);
    await http().get(`/api/admin/students/${stu.id}/points`).set('Cookie', spk.cookie).expect(403);

    await unassign(spk.instructorId, course.id);
    await http().get(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).expect(403);
    await http().post(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).send(quiz()).expect(403);
    expect((await http().get('/api/speaker/courses').set('Cookie', spk.cookie).expect(200)).body).toEqual([]);

    // Any account can be course staff: switched to a student, they keep their course role;
    // a deleted account loses everything at once.
    await assign(spk.instructorId, course.id);
    await prisma.user.update({ where: { id: spk.id }, data: { role: 'STUDENT' } });
    await http().get(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).expect(200);
    await prisma.user.update({ where: { id: spk.id }, data: { deletedAt: new Date() } });
    await http().get(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).expect(401);
  });

  it('publishes (students told once), grades a link with feedback (student emailed), exports the gradebook', async () => {
    const spk = await speaker('Grader Speaker');
    const course = await createCourse(prisma);
    await assign(spk.instructorId, course.id);
    const [s1, s2] = [await student(course.id), await student(course.id)];

    const draft = (await http().post(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).send(lab({ status: 'DRAFT' })).expect(201)).body;
    expect(await prisma.notification.count({ where: { userId: s1.id, type: 'assessment.published' } })).toBe(0);
    await http().put(`${base(course.id)}/assessments/${draft.id}`).set('Cookie', spk.cookie).send(lab({ status: 'PUBLISHED' })).expect(200);
    // The notice goes out after the response.
    const told = () => prisma.notification.count({ where: { type: 'assessment.published', userId: { in: [s1.id, s2.id] } } });
    for (let i = 0; i < 50 && (await told()) < 2; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await told()).toBe(2);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.filter((m) => m.template.name === 'assessmentPublished').map((m) => m.to)).toEqual(expect.arrayContaining([s1.email, s2.email]));
    // Saving it again doesn't tell them again.
    await http().put(`${base(course.id)}/assessments/${draft.id}`).set('Cookie', spk.cookie).send(lab({ status: 'PUBLISHED', titleEn: 'Lab 1 (fixed)' })).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await told()).toBe(2);

    const sub = await submitLink(course.slug, draft.id, s1);
    const book = (await http().get(`${base(course.id)}/assessments/${draft.id}/submissions`).set('Cookie', spk.cookie).expect(200)).body;
    expect(book.rows).toHaveLength(2);
    expect(book.rows.find((r: { userId: string }) => r.userId === s1.id)).toMatchObject({ state: 'SUBMITTED', url: 'https://example.org/my-lab', email: s1.email });
    // Students' personal data beyond name, email and their work never comes back.
    expect(JSON.stringify(book)).not.toMatch(/phone|\+20100|linkedin|googleEmail|country/i);
    const detail = (await http().get(`${base(course.id)}/submissions/${sub.id}`).set('Cookie', spk.cookie).expect(200)).body;
    expect(detail.student).toEqual({ id: s1.id, name: 'Test Person', email: s1.email });

    sent = [];
    const graded = (await http().put(`${base(course.id)}/submissions/${sub.id}/grade`).set('Cookie', spk.cookie).send({ score: 17, feedback: 'Nice work, add tests.', submittedAt: sub.submittedAt }).expect(200)).body;
    expect(graded).toMatchObject({ score: 17, feedback: 'Nice work, add tests.', gradedBy: 'Grader Speaker' });
    expect(sent).toEqual([expect.objectContaining({ to: s1.email, template: expect.objectContaining({ name: 'assessmentGraded', score: 17, maxScore: 20 }) })]);
    expect(await prisma.notification.count({ where: { userId: s1.id, type: 'assessment.graded' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'submission.graded', entityId: sub.id, actorId: spk.id } })).toBe(1);
    // The admin's gradebook says who graded it.
    const adminBook = (await http().get(`/api/admin/assessments/${draft.id}/submissions`).set('Cookie', admin.cookie).expect(200)).body;
    expect(adminBook.rows.find((r: { userId: string }) => r.userId === s1.id)).toMatchObject({ state: 'GRADED', score: 17, gradedBy: 'Grader Speaker' });
    expect((await http().get(`/api/admin/submissions/${sub.id}`).set('Cookie', admin.cookie).expect(200)).body.gradedBy).toBe('Grader Speaker');
    // The student sees the grade and feedback.
    const theirs = (await http().get(`/api/learn/${course.slug}/assessments/${draft.id}`).set('Cookie', s1.cookie).expect(200)).body;
    expect(theirs).toMatchObject({ state: 'GRADED', score: 17 });
    expect(theirs.submissions[0].feedback).toBe('Nice work, add tests.');

    // An admin's grade shows to speakers by name only, never by email.
    const regrade = (await http().put(`/api/admin/submissions/${sub.id}/grade`).set('Cookie', admin.cookie).send({ score: 18 }).expect(200)).body;
    expect(regrade.gradedBy).toBe('Test Person');
    await prisma.profile.update({ where: { userId: admin.id }, data: { fullNameEn: null } });
    expect((await http().get(`${base(course.id)}/submissions/${sub.id}`).set('Cookie', spk.cookie).expect(200)).body.gradedBy).toBeNull();
    expect((await http().get(`/api/admin/submissions/${sub.id}`).set('Cookie', admin.cookie).expect(200)).body.gradedBy).toBe(admin.email);
    await prisma.profile.update({ where: { userId: admin.id }, data: { fullNameEn: 'Test Person' } });

    const csv = await http().get(`${base(course.id)}/gradebook.csv`).set('Cookie', spk.cookie).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(s1.email);
    expect(await prisma.auditLog.count({ where: { action: 'gradebook.exported', entityId: course.id, actorId: spk.id } })).toBe(1);

    // Files: a short-lived link, audited with the speaker as the actor.
    await prisma.submission.update({ where: { id: sub.id }, data: { fileKey: 'submissions/x/y.pdf', fileName: 'y.pdf' } });
    expect((await http().get(`${base(course.id)}/submissions/${sub.id}/file`).set('Cookie', spk.cookie).expect(200)).body.url).toBe('https://files.example.test/signed');
    expect(await prisma.auditLog.count({ where: { action: 'submission.file_viewed', entityId: sub.id, actorId: spk.id } })).toBe(1);

    // With submissions, it can't be deleted (unpublish instead).
    await http().delete(`${base(course.id)}/assessments/${draft.id}`).set('Cookie', spk.cookie).expect(409);
  });

  it('gives and takes course points with a reason (course-tagged; on the leaderboard)', async () => {
    const spk = await speaker('Points Speaker');
    const course = await createCourse(prisma);
    await assign(spk.instructorId, course.id);
    const s1 = await student(course.id);

    const plus = (await http().post(`${base(course.id)}/points`).set('Cookie', spk.cookie).send({ userId: s1.id, points: 15, reason: 'MANUAL_OTHER', note: 'Helped classmates' }).expect(201)).body;
    expect(plus).toMatchObject({ points: 15, course: expect.objectContaining({ slug: course.slug }) });
    await http().post(`${base(course.id)}/points`).set('Cookie', spk.cookie).send({ userId: s1.id, points: -5, reason: 'ADJUSTMENT', note: 'Duplicate' }).expect(201);
    // Course-tagged only: a courseId in the body is ignored.
    await http().post(`${base(course.id)}/points`).set('Cookie', spk.cookie).send({ userId: s1.id, points: 1, reason: 'MANUAL_OTHER', note: 'x', courseId: null }).expect(201);
    await http().post(`${base(course.id)}/points`).set('Cookie', spk.cookie).send({ userId: s1.id, points: 0, reason: 'MANUAL_OTHER', note: 'x' }).expect(400);
    await http().post(`${base(course.id)}/points`).set('Cookie', spk.cookie).send({ userId: s1.id, points: 3, reason: 'ASSESSMENT', note: 'x' }).expect(400);

    const entries = await prisma.pointsEntry.findMany({ where: { userId: s1.id } });
    expect(entries.map((e) => [e.points, e.courseId, e.awardedById])).toEqual(
      expect.arrayContaining([
        [15, course.id, spk.id],
        [-5, course.id, spk.id],
        [1, course.id, spk.id],
      ]),
    );
    expect(await prisma.auditLog.count({ where: { action: 'points.awarded', entityId: s1.id, actorId: spk.id } })).toBe(3);

    const overview = (await http().get(`${base(course.id)}/points`).set('Cookie', spk.cookie).expect(200)).body;
    expect(overview.students).toEqual([{ userId: s1.id, name: 'Test Person', email: s1.email, points: 11 }]);
    expect(overview.entries[0]).toMatchObject({ userId: s1.id, awardedBy: 'Points Speaker' });

    const board = (await http().get(`/api/admin/courses/${course.id}/leaderboard`).set('Cookie', admin.cookie).expect(200)).body;
    expect(JSON.stringify(board)).toContain(s1.id);
    expect(board.rows.find((r: { userId: string }) => r.userId === s1.id).points).toBe(11);
  });

  it('never shows speakers an admin\'s email, and caps new assessments per day', async () => {
    const spk = await speaker('Capped Speaker');
    const course = await createCourse(prisma);
    await assign(spk.instructorId, course.id);
    const nameless = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'teach-nameless', coreComplete: false });
    const a = (await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', nameless.cookie).send(quiz()).expect(201)).body;
    expect(a.updatedBy).toBe(nameless.email);
    const list = (await http().get(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).expect(200)).body;
    expect(list[0].updatedBy).toBeNull();
    expect((await http().get(`${base(course.id)}/assessments/${a.id}`).set('Cookie', spk.cookie).expect(200)).body.updatedBy).toBeNull();
    expect(JSON.stringify(list)).not.toContain(nameless.email);

    await prisma.auditLog.createMany({ data: Array.from({ length: 30 }, () => ({ actorId: spk.id, action: 'assessment.created', entityType: 'Assessment', entityId: 'x' })) });
    expect((await http().post(`${base(course.id)}/assessments`).set('Cookie', spk.cookie).send(quiz()).expect(429)).body.code).toBe('SPEAKER_ASSESSMENT_LIMIT');
    // Editing (and publishing) existing ones still works.
    await http().put(`${base(course.id)}/assessments/${a.id}`).set('Cookie', spk.cookie).send(quiz({ titleEn: 'Renamed' })).expect(200);
  });

  it('edits only a session\'s text and links', async () => {
    const spk = await speaker('Materials Speaker');
    const course = await createCourse(prisma);
    await assign(spk.instructorId, course.id);
    const s = await session(course.id);

    const res = (
      await http()
        .put(`${base(course.id)}/sessions/${s.id}/materials`)
        .set('Cookie', spk.cookie)
        .send({
          descriptionEn: 'We cover MLflow tracking.',
          recordingUrl: 'https://youtu.be/abc',
          assignmentUrl: 'https://github.com/org/lab',
          materials: [{ labelEn: 'Slides', labelAr: 'الشرائح', url: 'https://example.org/slides.pdf' }],
          // Not theirs to change: dropped.
          startsAt: '2020-01-01T00:00:00Z',
          titleEn: 'Renamed',
          liveUrl: 'https://evil.example/meet',
          durationMin: 15,
        })
        .expect(200)
    ).body;
    expect(res).toMatchObject({ descriptionEn: 'We cover MLflow tracking.', recordingUrl: 'https://youtu.be/abc', materials: [expect.objectContaining({ labelEn: 'Slides' })] });
    expect(res).not.toHaveProperty('liveUrl');
    const row = await prisma.courseSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ titleEn: 'Session 1', liveUrl: 'https://meet.google.com/abc-defg-hij', durationMin: 90 });
    expect(row.startsAt.toISOString()).toBe('2030-01-05T17:00:00.000Z');
    await http().put(`${base(course.id)}/sessions/${s.id}/materials`).set('Cookie', spk.cookie).send({ materials: [{ labelEn: 'x', labelAr: 'x', url: 'javascript:alert(1)' }] }).expect(400);
    // A partial save keeps what wasn't sent; null clears.
    const partial = (await http().put(`${base(course.id)}/sessions/${s.id}/materials`).set('Cookie', spk.cookie).send({ assignmentUrl: null }).expect(200)).body;
    expect(partial).toMatchObject({ descriptionEn: 'We cover MLflow tracking.', recordingUrl: 'https://youtu.be/abc', assignmentUrl: null, materials: [expect.objectContaining({ labelEn: 'Slides' })] });
    expect(await prisma.auditLog.count({ where: { action: 'session.materials_updated', entityId: s.id, actorId: spk.id } })).toBe(2);

    // The course page lists sessions without their live link.
    const detail = (await http().get(base(course.id)).set('Cookie', spk.cookie).expect(200)).body;
    expect(detail.sessions).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain('meet.google.com');
  });

  it('opens learn-page assessment previews to teachers only: ACADEMIC/SUPER admins and assigned speakers', async () => {
    const course = await createCourse(prisma);
    const published = (await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send(quiz({ status: 'PUBLISHED' })).expect(201)).body;
    const list = `/api/learn/${course.slug}/assessments`;
    const one = `${list}/${published.id}`;
    const content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'teach-content' });
    const admissions = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'teach-adm' });
    const academic = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'teach-acad2' });
    const spk = await speaker('Preview Speaker');
    const stranger = await speaker('Other Speaker');
    await assign(spk.instructorId, course.id);

    for (const who of [content, admissions, stranger]) {
      expect((await http().get(list).set('Cookie', who.cookie).expect(403)).body.code).toBe('NOT_ENROLLED');
      await http().get(one).set('Cookie', who.cookie).expect(403);
    }
    for (const who of [academic, admin, spk]) {
      await http().get(list).set('Cookie', who.cookie).expect(200);
      expect((await http().get(one).set('Cookie', who.cookie).expect(200)).body.id).toBe(published.id);
      // Previewing never takes the quiz.
      await http().post(`${one}/start`).set('Cookie', who.cookie).expect(403);
    }
    await unassign(spk.instructorId, course.id);
    await http().get(one).set('Cookie', spk.cookie).expect(403);
  });
});
