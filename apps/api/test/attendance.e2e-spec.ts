import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

/**
 * Attendance from Google Meet and editing points. Every name and address here is made up.
 */
type Account = { id: string; email: string; cookie: string };

describe('attendance and points editing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  let content: Account;
  const http = () => request(app.getHttpServer());
  let n = 0;

  async function student(courseId: string, name: string, googleEmail: string | null = null): Promise<Account> {
    const s = await createUser(app, prisma, { prefix: 'att-stu' });
    await prisma.profile.update({ where: { userId: s.id }, data: { fullNameEn: name, googleEmail } });
    await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    return s;
  }
  async function speakerOn(courseId: string): Promise<Account> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'att-spk', coreComplete: false });
    const i = await prisma.instructor.create({ data: { slug: `att-spk-${Date.now()}-${++n}`, name: `Speaker ${n}`, titleEn: 'Engineer', bioEn: '', userId: s.id } });
    await prisma.courseInstructor.create({ data: { courseId, instructorId: i.id } });
    return s;
  }
  const session = (courseId: string, order = 1) =>
    prisma.courseSession.create({ data: { courseId, order, titleEn: `Session ${order}`, titleAr: `الجلسة ${order}`, startsAt: new Date('2025-01-05T17:00:00Z'), durationMin: 90 } });
  const ledger = async (userId: string, courseId: string) =>
    (await prisma.pointsEntry.aggregate({ where: { userId, courseId, voidedAt: null }, _sum: { points: true } }))._sum.points ?? 0;
  const board = async (courseId: string) =>
    new Map(((await http().get(`/api/admin/courses/${courseId}/leaderboard?scope=course`).set('Cookie', admin.cookie).expect(200)).body.rows as { userId: string; points: number }[]).map((r) => [r.userId, r.points]));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'att-admin' });
    content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'att-content' });
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });
  afterAll(async () => {
    await app.close();
  });

  it('admin upload: previews, saves, awards points; a changed re-upload adjusts without double awards', async () => {
    const course = await createCourse(prisma);
    const s1 = await session(course.id);
    const layla = await student(course.id, 'Layla Haddad');
    const omar = await student(course.id, 'Omar Farouk', 'omar.farouk.test@gmail.com');
    const sami = await student(course.id, 'Sami Nabil');
    const url = `/api/admin/courses/${course.id}/sessions/${s1.id}/attendance`;
    const records = [
      { name: 'Layla H', email: layla.email, minutes: 80 },
      // Gmail dots and a plus tag still find Omar's Google account.
      { name: 'Omar', email: 'omarfarouk.test+meet@gmail.com', minutes: 30 },
      // By exact name: flagged for review.
      { name: 'sami  nabil', email: null, minutes: 50 },
      { name: 'Unknown Guest', email: 'guest@example.test', minutes: 90 },
    ];

    const preview = (await http().post(url).set('Cookie', admin.cookie).send({ records }).expect(200)).body;
    expect(preview.dryRun).toBe(true);
    const by = (id: string) => preview.rows.find((r: { userId: string }) => r.userId === id);
    expect(by(layla.id)).toMatchObject({ status: 'PRESENT', minutes: 80, percent: 89, matchedBy: 'EMAIL', points: 10, change: 10 });
    expect(by(omar.id)).toMatchObject({ status: 'PARTIAL', minutes: 30, matchedBy: 'EMAIL', points: 5 });
    expect(by(sami.id)).toMatchObject({ status: 'PRESENT', matchedBy: 'NAME' });
    expect(preview.unmatched).toEqual([{ index: 3, name: 'Unknown Guest', email: 'guest@example.test', minutes: 90 }]);
    expect(await prisma.sessionAttendance.count({ where: { sessionId: s1.id } })).toBe(0);

    const saved = (await http().post(url).set('Cookie', admin.cookie).send({ records, dryRun: false }).expect(200)).body;
    expect(saved.counts).toEqual({ present: 2, partial: 1, absent: 0 });
    expect(saved.pointsChange).toBe(25);
    // Unmatched rows are never stored, and no account is created from the file.
    expect(await prisma.sessionAttendance.count({ where: { sessionId: s1.id } })).toBe(3);
    expect(await prisma.user.count({ where: { email: 'guest@example.test' } })).toBe(0);
    expect(await ledger(layla.id, course.id)).toBe(10);
    expect(await ledger(omar.id, course.id)).toBe(5);

    // The same file again: nothing changes.
    await http().post(url).set('Cookie', admin.cookie).send({ records, dryRun: false }).expect(200);
    expect(await prisma.pointsEntry.count({ where: { sourceType: 'ATTENDANCE', sourceId: s1.id } })).toBe(3);

    // Changed: Omar stayed longer, Sami was a wrong name match (ignored), Layla marked absent by hand,
    // the guest matched by hand to nobody (left unmatched), and a lower threshold for this session.
    const changed = [{ ...records[0]! }, { ...records[1]!, minutes: 70 }, records[2]!, records[3]!];
    const again = (await http()
      .post(url)
      .set('Cookie', admin.cookie)
      .send({ records: changed, ignore: [2], statuses: [{ userId: layla.id, status: 'ABSENT' }], presentPercent: 40, dryRun: false })
      .expect(200)).body;
    expect(again.presentPercent).toBe(40);
    const row = (id: string) => again.rows.find((r: { userId: string }) => r.userId === id);
    expect(row(layla.id)).toMatchObject({ status: 'ABSENT', source: 'MANUAL', change: -10 });
    expect(row(omar.id)).toMatchObject({ status: 'PRESENT', change: 5 });
    expect(row(sami.id)).toMatchObject({ status: 'ABSENT', matchedBy: null, change: -10 });
    expect(await ledger(layla.id, course.id)).toBe(0);
    expect(await ledger(omar.id, course.id)).toBe(10);
    expect(await ledger(sami.id, course.id)).toBe(0);
    // Totals on the board follow.
    const b = await board(course.id);
    expect(b.get(omar.id)).toBe(10);
    expect(b.get(layla.id)).toBe(0);

    // A hand mark later: points follow again.
    await http().put(`${url}/${sami.id}`).set('Cookie', admin.cookie).send({ status: 'PRESENT' }).expect(200);
    expect(await ledger(sami.id, course.id)).toBe(10);

    // The student sees their own attendance; the history shows the points.
    const learn = (await http().get(`/api/learn/${course.slug}`).set('Cookie', omar.cookie).expect(200)).body;
    expect(learn.sessions[0].attendance).toEqual({ status: 'PRESENT', minutes: 70, percent: 78 });
    const history = (await http().get('/api/me/points/history').set('Cookie', omar.cookie).expect(200)).body as { reason: string; points: number }[];
    expect(history.filter((e) => e.reason === 'ATTENDANCE').reduce((s, e) => s + e.points, 0)).toBe(10);

    // Course settings change the points; the export lists sessions × students.
    await http().put(`/api/admin/courses/${course.id}/attendance/settings`).set('Cookie', admin.cookie).send({ presentPercent: 60, presentPoints: 20, partialPoints: 8, absentPoints: 0 }).expect(200);
    const csv = (await http().get(`/api/admin/courses/${course.id}/attendance.csv`).set('Cookie', admin.cookie).expect(200)).text;
    expect(csv).toContain('1. Session 1');
    expect(csv).toContain('Present (70 min)');

    // Ids and counts only in the audit log.
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'attendance.' }, entityId: s1.id } });
    expect(audit.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/@|Layla|Omar|Guest/);
  });

  it("refuses to save or mark attendance for a session that hasn't started (a preview is fine)", async () => {
    const course = await createCourse(prisma);
    const later = await prisma.courseSession.create({ data: { courseId: course.id, order: 1, titleEn: 'Later', titleAr: 'لاحقة', startsAt: new Date(Date.now() + 86_400_000), durationMin: 90 } });
    const layla = await student(course.id, 'Layla Haddad');
    const url = `/api/admin/courses/${course.id}/sessions/${later.id}/attendance`;
    const records = [{ name: 'Layla H', email: layla.email, minutes: 80 }];
    await http().post(url).set('Cookie', admin.cookie).send({ records }).expect(200);
    expect((await http().post(url).set('Cookie', admin.cookie).send({ records, dryRun: false }).expect(409)).body.code).toBe('SESSION_NOT_STARTED');
    expect((await http().put(`${url}/${layla.id}`).set('Cookie', admin.cookie).send({ status: 'PRESENT' }).expect(409)).body.code).toBe('SESSION_NOT_STARTED');
    expect(await prisma.sessionAttendance.count({ where: { sessionId: later.id } })).toBe(0);
    expect(await ledger(layla.id, course.id)).toBe(0);
  });

  it('rejects hand matches to someone outside the course', async () => {
    const course = await createCourse(prisma);
    const other = await createCourse(prisma);
    const s1 = await session(course.id);
    const outsider = await student(other.id, 'Rana Aziz');
    await http()
      .post(`/api/admin/courses/${course.id}/sessions/${s1.id}/attendance`)
      .set('Cookie', admin.cookie)
      .send({ records: [{ name: 'Rana Aziz', email: null, minutes: 60 }], assign: [{ index: 0, userId: outsider.id }], dryRun: false })
      .expect(400);
    await http().post(`/api/admin/courses/${other.id}/sessions/${s1.id}/attendance`).set('Cookie', admin.cookie).send({ records: [] }).expect(404);
  });

  it('speaker: uploads for their own course, 403 for another, 404 for another course\'s session', async () => {
    const course = await createCourse(prisma);
    const other = await createCourse(prisma);
    const s1 = await session(course.id);
    const foreign = await session(other.id);
    const spk = await speakerOn(course.id);
    const hana = await student(course.id, 'Hana Youssef');
    const base = `/api/speaker/courses/${course.id}`;

    const res = (await http()
      .post(`${base}/sessions/${s1.id}/attendance`)
      .set('Cookie', spk.cookie)
      .send({ records: [{ name: 'Someone', email: null, minutes: 60 }], assign: [{ index: 0, userId: hana.id }], dryRun: false })
      .expect(200)).body;
    expect(res.rows[0]).toMatchObject({ userId: hana.id, status: 'PRESENT', matchedBy: 'MANUAL' });
    expect(await ledger(hana.id, course.id)).toBe(10);
    await http().get(`${base}/attendance`).set('Cookie', spk.cookie).expect(200);
    await http().get(`${base}/attendance.csv`).set('Cookie', spk.cookie).expect(200);

    expect((await http().post(`/api/speaker/courses/${other.id}/sessions/${foreign.id}/attendance`).set('Cookie', spk.cookie).send({ records: [] }).expect(403)).body.code).toBe('NOT_YOUR_COURSE');
    await http().get(`/api/speaker/courses/${other.id}/attendance`).set('Cookie', spk.cookie).expect(403);
    await http().post(`${base}/sessions/${foreign.id}/attendance`).set('Cookie', spk.cookie).send({ records: [] }).expect(404);
    // Speakers can't change the course's settings or use the admin routes.
    await http().put(`/api/admin/courses/${course.id}/attendance/settings`).set('Cookie', spk.cookie).send({ presentPercent: 10, presentPoints: 1000, partialPoints: 0, absentPoints: 0 }).expect(403);
  });

  it('a CONTENT admin gets 403 on attendance and points editing', async () => {
    const course = await createCourse(prisma);
    const s1 = await session(course.id);
    const st = await student(course.id, 'Karim Mansour');
    const e = await prisma.pointsEntry.create({ data: { userId: st.id, courseId: course.id, points: 5, reason: 'MANUAL_OTHER', note: 'x' } });
    await http().get(`/api/admin/courses/${course.id}/attendance`).set('Cookie', content.cookie).expect(403);
    await http().post(`/api/admin/courses/${course.id}/sessions/${s1.id}/attendance`).set('Cookie', content.cookie).send({ records: [] }).expect(403);
    await http().patch(`/api/admin/points/${e.id}`).set('Cookie', content.cookie).send({ points: 7, reason: 'MANUAL_OTHER', note: 'y', why: 'z' }).expect(403);
    await http().post(`/api/admin/points/${e.id}/void`).set('Cookie', content.cookie).send({ why: 'z' }).expect(403);
    expect((await prisma.pointsEntry.findUniqueOrThrow({ where: { id: e.id } })).voidedAt).toBeNull();
  });

  it('edit and remove: void + replace, totals and boards follow, automatic entries refuse', async () => {
    const course = await createCourse(prisma);
    const s1 = await session(course.id);
    const st = await student(course.id, 'Nour Saleh');
    const added = (await http().post(`/api/admin/students/${st.id}/points`).set('Cookie', admin.cookie).send({ points: 30, reason: 'MANUAL_OTHER', courseId: course.id, note: 'Demo' }).expect(201)).body;
    expect((await board(course.id)).get(st.id)).toBe(30);

    const edited = (await http().patch(`/api/admin/points/${added.id}`).set('Cookie', admin.cookie).send({ points: 12, reason: 'MANUAL_COMMUNITY', note: 'Demo (fixed)', why: 'Typo' }).expect(200)).body;
    expect(edited).toMatchObject({ points: 12, reason: 'MANUAL_COMMUNITY', replaces: added.id, voided: null });
    const old = await prisma.pointsEntry.findUniqueOrThrow({ where: { id: added.id } });
    expect(old.voidedAt).not.toBeNull();
    expect(old.voidReason).toBe('Typo');
    expect((await board(course.id)).get(st.id)).toBe(12);
    // Editing the old one again: already voided.
    expect((await http().patch(`/api/admin/points/${added.id}`).set('Cookie', admin.cookie).send({ points: 1, reason: 'MANUAL_OTHER', note: 'x', why: 'x' }).expect(409)).body.code).toBe('ENTRY_VOIDED');

    await http().post(`/api/admin/points/${edited.id}/void`).set('Cookie', admin.cookie).send({ why: 'Not earned' }).expect(200);
    expect((await board(course.id)).get(st.id)).toBe(0);
    const mine = (await http().get('/api/me/points').set('Cookie', st.cookie).expect(200)).body;
    expect(mine.total).toBe(0);
    // Kept for the record: admins see both, struck through.
    const adminView = (await http().get(`/api/admin/students/${st.id}/points`).set('Cookie', admin.cookie).expect(200)).body;
    expect(adminView.entries.filter((e: { voided: unknown }) => e.voided)).toHaveLength(2);
    expect(adminView.cap).toBe(10000);

    // Automatic entries can't be edited or removed directly: a correction (ADJUSTMENT) instead.
    await http().put(`/api/admin/courses/${course.id}/sessions/${s1.id}/attendance/${st.id}`).set('Cookie', admin.cookie).send({ status: 'PRESENT' }).expect(200);
    const auto = await prisma.pointsEntry.findFirstOrThrow({ where: { userId: st.id, sourceType: 'ATTENDANCE' } });
    expect((await http().patch(`/api/admin/points/${auto.id}`).set('Cookie', admin.cookie).send({ points: 1, reason: 'MANUAL_OTHER', note: 'x', why: 'x' }).expect(409)).body.code).toBe('AUTOMATIC_ENTRY');
    expect((await http().post(`/api/admin/points/${auto.id}/void`).set('Cookie', admin.cookie).send({ why: 'x' }).expect(409)).body.code).toBe('AUTOMATIC_ENTRY');
    await http().post(`/api/admin/students/${st.id}/points`).set('Cookie', admin.cookie).send({ points: -10, reason: 'ADJUSTMENT', courseId: course.id, note: 'Override attendance' }).expect(201);
    expect((await board(course.id)).get(st.id)).toBe(0);

    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['points.edited', 'points.voided'] }, entityId: { in: [added.id, edited.id] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['points.edited', 'points.voided']);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Demo|Typo|Not earned|@/);
  });

  it('speaker: edits within ±100 on their own course only', async () => {
    const course = await createCourse(prisma);
    const other = await createCourse(prisma);
    const spk = await speakerOn(course.id);
    const st = await student(course.id, 'Yara Kamel');
    const elsewhere = await student(other.id, 'Ali Tarek');
    const base = `/api/speaker/courses/${course.id}`;

    expect((await http().post(`${base}/points`).set('Cookie', spk.cookie).send({ userId: st.id, points: 101, reason: 'MANUAL_OTHER', note: 'Too many' }).expect(403)).body.code).toBe('POINTS_CAP');
    await http().post(`${base}/points`).set('Cookie', spk.cookie).send({ userId: st.id, points: -101, reason: 'MANUAL_OTHER', note: 'Too many' }).expect(403);
    const e = (await http().post(`${base}/points`).set('Cookie', spk.cookie).send({ userId: st.id, points: 100, reason: 'MANUAL_OTHER', note: 'Great demo' }).expect(201)).body;

    const view = (await http().get(`${base}/students/${st.id}/points`).set('Cookie', spk.cookie).expect(200)).body;
    expect(view).toMatchObject({ total: 100, cap: 100 });
    await http().get(`${base}/students/${elsewhere.id}/points`).set('Cookie', spk.cookie).expect(404);

    await http().patch(`${base}/points/${e.id}`).set('Cookie', spk.cookie).send({ points: 150, reason: 'MANUAL_OTHER', note: 'x', why: 'x' }).expect(403);
    const edited = (await http().patch(`${base}/points/${e.id}`).set('Cookie', spk.cookie).send({ points: 40, reason: 'MANUAL_OTHER', note: 'Good demo', why: 'Too generous' }).expect(200)).body;
    expect(await ledger(st.id, course.id)).toBe(40);

    // An admin's bigger entry is over the speaker's cap: they can't remove it.
    const big = await prisma.pointsEntry.create({ data: { userId: st.id, courseId: course.id, points: 500, reason: 'MANUAL_OTHER', note: 'Admin award' } });
    expect((await http().post(`${base}/points/${big.id}/void`).set('Cookie', spk.cookie).send({ why: 'x' }).expect(403)).body.code).toBe('POINTS_CAP');
    // Another course's entry, or a community entry: not found.
    const foreign = await prisma.pointsEntry.create({ data: { userId: elsewhere.id, courseId: other.id, points: 5, reason: 'MANUAL_OTHER', note: 'x' } });
    const community = await prisma.pointsEntry.create({ data: { userId: st.id, courseId: null, points: 5, reason: 'MANUAL_COMMUNITY', note: 'x' } });
    await http().post(`${base}/points/${foreign.id}/void`).set('Cookie', spk.cookie).send({ why: 'x' }).expect(404);
    await http().post(`${base}/points/${community.id}/void`).set('Cookie', spk.cookie).send({ why: 'x' }).expect(404);
    await http().post(`/api/speaker/courses/${other.id}/points/${foreign.id}/void`).set('Cookie', spk.cookie).send({ why: 'x' }).expect(403);

    await http().post(`${base}/points/${edited.id}/void`).set('Cookie', spk.cookie).send({ why: 'Duplicate' }).expect(200);
    expect(await ledger(st.id, course.id)).toBe(500);

  });
});
