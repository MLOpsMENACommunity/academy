import type { NestExpressApplication } from '@nestjs/platform-express';
import { courseWeekRange } from '@academy/shared';
import request from 'supertest';
import { PointsJobs } from '../src/points/points.jobs';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

const DAY = 86_400_000;

/** One single-choice question (weight 1) and one true/false (weight 1); max 10 points. */
const quiz = {
  type: 'QUIZ',
  status: 'PUBLISHED',
  titleEn: 'Week 1 quiz',
  titleAr: 'اختبار الأسبوع ١',
  maxPoints: 10,
  passPercent: 50,
  attemptsAllowed: 0,
  scoring: 'BEST',
  revealAnswers: 'AFTER_SUBMIT',
  questions: [
    {
      kind: 'SINGLE',
      promptEn: 'Pick A',
      promptAr: 'اختر أ',
      weight: 1,
      options: [
        { labelEn: 'A', labelAr: 'أ', correct: true },
        { labelEn: 'B', labelAr: 'ب', correct: false },
      ],
    },
    {
      kind: 'TRUE_FALSE',
      promptEn: 'True?',
      promptAr: 'صحيح؟',
      weight: 1,
      options: [
        { labelEn: 'True', labelAr: 'صحيح', correct: true },
        { labelEn: 'False', labelAr: 'خطأ', correct: false },
      ],
    },
  ],
};

describe('points, badges and leaderboards (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** A course whose first session was `startedDaysAgo` days ago, with three weekly sessions. */
  async function setup(opts: { startedDaysAgo?: number; students?: number; endDate?: Date | null } = {}) {
    const course = await createCourse(prisma);
    const first = new Date(Date.now() - (opts.startedDaysAgo ?? 3) * DAY);
    await prisma.course.update({ where: { id: course.id }, data: { endDate: opts.endDate ?? null } });
    const sessions = await Promise.all(
      [0, 1, 2].map((i) =>
        prisma.courseSession.create({ data: { courseId: course.id, order: i + 1, titleEn: `S${i + 1}`, titleAr: `ج${i + 1}`, startsAt: new Date(first.getTime() + i * 7 * DAY) } }),
      ),
    );
    sessions.sort((a, b) => a.order - b.order);
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    const students = [];
    for (let i = 0; i < (opts.students ?? 2); i++) students.push(await createUser(app, prisma, { prefix: `pts${i}` }));
    await prisma.enrollment.createMany({ data: students.map((s) => ({ userId: s.id, courseId: course.id })) });
    return { course, sessions, first, admin, students };
  }

  const sum = async (userId: string, courseId?: string) =>
    (await prisma.pointsEntry.aggregate({ where: { userId, ...(courseId ? { courseId } : {}) }, _sum: { points: true } }))._sum.points ?? 0;

  async function takeQuiz(slug: string, id: string, cookie: string, right: number) {
    const base = `/api/learn/${slug}/assessments/${id}`;
    const start = await http().post(`${base}/start`).set('Cookie', cookie).expect(200);
    const answers: Record<string, string[]> = {};
    for (const [i, q] of (start.body.questions as { id: string; options: { id: string; labelEn: string }[] }[]).entries()) {
      // Right answers are "A" and "True"; wrong ones the other option.
      const correctLabel = q.options.some((o) => o.labelEn === 'A') ? 'A' : 'True';
      const pick = i < right ? q.options.find((o) => o.labelEn === correctLabel) : q.options.find((o) => o.labelEn !== correctLabel);
      answers[q.id] = [pick!.id];
    }
    return (await http().post(`${base}/submit`).set('Cookie', cookie).send({ answers }).expect(200)).body;
  }

  it('turns quiz scores into points, adds only the difference for a better attempt, and gives "Perfect score"', async () => {
    const { course, admin, students } = await setup();
    const [s] = students;
    const q = (await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send(quiz).expect(201)).body;

    expect((await takeQuiz(course.slug, q.id, s!.cookie, 1)).score).toBe(5);
    expect(await sum(s!.id, course.id)).toBe(5);
    // A worse attempt changes nothing under BEST.
    await takeQuiz(course.slug, q.id, s!.cookie, 0);
    expect(await sum(s!.id, course.id)).toBe(5);
    // A perfect one adds the difference, as a new entry (the ledger is append-only).
    await takeQuiz(course.slug, q.id, s!.cookie, 2);
    const entries = await prisma.pointsEntry.findMany({ where: { userId: s!.id, sourceType: 'ASSESSMENT', sourceId: q.id }, orderBy: { sourceSeq: 'asc' } });
    expect(entries.map((e) => [e.points, e.sourceSeq, e.reason])).toEqual([
      [5, 0, 'ASSESSMENT'],
      [5, 1, 'ASSESSMENT'],
    ]);
    const badges = await prisma.userBadge.findMany({ where: { userId: s!.id }, include: { badge: true } });
    expect(badges.map((b) => b.badge.code)).toEqual(['perfect-score']);

    // Syncing again (the hourly sweep) is a no-op.
    await app.get(PointsService).syncAssessment(q.id, s!.id);
    expect(await prisma.pointsEntry.count({ where: { userId: s!.id } })).toBe(2);

    // The dashboard card.
    const mine = (await http().get('/api/me/points').set('Cookie', s!.cookie).expect(200)).body;
    expect(mine).toMatchObject({ total: 10, courses: [{ slug: course.slug, points: 10 }] });
    expect(mine.recent[0]).toMatchObject({ points: 5, reason: 'ASSESSMENT', adjustment: true, label: { en: 'Week 1 quiz' } });
    expect(mine.badges[0].badge).toMatchObject({ code: 'perfect-score', icon: '💯' });
    expect(await prisma.notification.count({ where: { userId: s!.id, type: 'badge.awarded' } })).toBe(1);

    // Unpublishing takes the points back; publishing again restores them.
    const full = (await http().get(`/api/admin/assessments/${q.id}`).set('Cookie', admin.cookie).expect(200)).body;
    await http().put(`/api/admin/assessments/${q.id}`).set('Cookie', admin.cookie).send({ ...full, status: 'DRAFT' }).expect(200);
    expect(await sum(s!.id, course.id)).toBe(0);
    await http().put(`/api/admin/assessments/${q.id}`).set('Cookie', admin.cookie).send({ ...full, status: 'PUBLISHED' }).expect(200);
    expect(await sum(s!.id, course.id)).toBe(10);
  });

  it('follows regrades with delta entries, up and down', async () => {
    const { course, admin, students } = await setup();
    const [s] = students;
    const lab = (await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send({ type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab', titleAr: 'مختبر', submissionKind: 'LINK', maxPoints: 20 }).expect(201)).body;
    const sub = (await http().post(`/api/learn/${course.slug}/assessments/${lab.id}/submission`).set('Cookie', s!.cookie).send({ url: 'https://example.com/work' }).expect(200)).body;
    expect(await sum(s!.id)).toBe(0); // not graded yet
    await http().put(`/api/admin/submissions/${sub.id}/grade`).set('Cookie', admin.cookie).send({ score: 12 }).expect(200);
    await http().put(`/api/admin/submissions/${sub.id}/grade`).set('Cookie', admin.cookie).send({ score: 17.6 }).expect(200);
    await http().put(`/api/admin/submissions/${sub.id}/grade`).set('Cookie', admin.cookie).send({ score: 9 }).expect(200);
    const entries = await prisma.pointsEntry.findMany({ where: { userId: s!.id }, orderBy: { sourceSeq: 'asc' } });
    expect(entries.map((e) => e.points)).toEqual([12, 6, -9]);
    expect(await sum(s!.id)).toBe(9);
  });

  it('gives session points, takes them back when unmarked, and awards "Finisher"', async () => {
    const { course, sessions, students } = await setup();
    const [s] = students;
    const mark = (id: string, completed: boolean) => http().put(`/api/learn/${course.slug}/sessions/${id}/progress`).set('Cookie', s!.cookie).send({ completed }).expect(204);
    await mark(sessions[0]!.id, true);
    await mark(sessions[0]!.id, true); // idempotent
    expect(await sum(s!.id)).toBe(5);
    await mark(sessions[0]!.id, false);
    expect(await sum(s!.id)).toBe(0);
    for (const x of sessions) await mark(x.id, true);
    expect(await sum(s!.id)).toBe(15);
    expect(await prisma.userBadge.count({ where: { userId: s!.id, badge: { code: 'finisher' }, courseId: course.id } })).toBe(1);
  });

  it('lets admins award, adjust and audit points and manual badges (and nobody else)', async () => {
    const { course, admin, students } = await setup();
    const [s, other] = students;
    const url = `/api/admin/students/${s!.id}/points`;
    await http().post(url).set('Cookie', other!.cookie).send({ points: 10, reason: 'MANUAL_COMMUNITY', note: 'x' }).expect(403);
    const bad = await http().post(url).set('Cookie', admin.cookie).send({ points: 0, reason: 'MANUAL_COMMUNITY', note: '' }).expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['note', 'points']);
    await http().post(url).set('Cookie', admin.cookie).send({ points: 15, reason: 'MANUAL_COMMUNITY', note: 'Helped 5 people on Telegram', courseId: course.id }).expect(201);
    await http().post(url).set('Cookie', admin.cookie).send({ points: -3, reason: 'ADJUSTMENT', note: 'Double counted' }).expect(201);
    const view = (await http().get(url).set('Cookie', admin.cookie).expect(200)).body;
    expect(view).toMatchObject({ total: 12, courses: [{ id: course.id, points: 15 }], enrolledCourses: [{ id: course.id }] });
    expect(view.entries[0]).toMatchObject({ points: -3, reason: 'ADJUSTMENT', course: null, awardedBy: 'Test Person' });
    expect(await prisma.auditLog.count({ where: { action: 'points.awarded', entityId: s!.id } })).toBe(2);

    // Badges: manual ones once per course, automatic ones can't be given by hand.
    const badges = (await http().get('/api/admin/badges').set('Cookie', admin.cookie).expect(200)).body as { id: string; code: string; kind: string }[];
    expect(badges.map((b) => b.code)).toEqual(expect.arrayContaining(['top-week', 'top-course', 'perfect-score', 'finisher', 'certified', 'top-performer', 'community-helper', 'speaker']));
    const helper = badges.find((b) => b.code === 'community-helper')!;
    const auto = badges.find((b) => b.code === 'finisher')!;
    const award = (await http().post(`/api/admin/students/${s!.id}/badges`).set('Cookie', admin.cookie).send({ badgeId: helper.id, courseId: course.id, reason: 'Telegram' }).expect(201)).body;
    expect((await http().post(`/api/admin/students/${s!.id}/badges`).set('Cookie', admin.cookie).send({ badgeId: helper.id, courseId: course.id }).expect(409)).body.code).toBe('ALREADY_AWARDED');
    await http().post(`/api/admin/students/${s!.id}/badges`).set('Cookie', admin.cookie).send({ badgeId: auto.id }).expect(400);
    // A new manual badge.
    const code = `mentor-${Date.now().toString(36)}`;
    const created = (await http().post('/api/admin/badges').set('Cookie', admin.cookie).send({ code, nameEn: 'Mentor', nameAr: 'مرشد', icon: '🧭' }).expect(201)).body;
    expect(created).toMatchObject({ code, kind: 'MANUAL', active: true });
    await http().post('/api/admin/badges').set('Cookie', admin.cookie).send({ code, nameEn: 'Mentor', nameAr: 'مرشد', icon: '🧭' }).expect(409);
    await http().delete(`/api/admin/badge-awards/${award.id}`).set('Cookie', admin.cookie).expect(204);
    expect(await prisma.userBadge.count({ where: { id: award.id } })).toBe(0);
    expect(await prisma.auditLog.findMany({ where: { entityId: s!.id, action: { startsWith: 'badge.' } }, select: { action: true } })).toEqual(
      expect.arrayContaining([{ action: 'badge.awarded' }, { action: 'badge.revoked' }]),
    );
  });

  it('imports community points from CSV with a dry run first', async () => {
    const { course, admin, students } = await setup();
    const [a, b] = students;
    const csv = `email,points,note,course\n${a!.email.toUpperCase()},10,"Helped on Telegram, twice",${course.slug}\n${b!.email},5,Active on WhatsApp,\nnobody@example.test,3,,\n${b!.email},2,,no-such-course\n`;
    const dry = (await http().post('/api/admin/points/import').set('Cookie', admin.cookie).send({ csv, dryRun: true }).expect(200)).body;
    expect(dry).toMatchObject({ dryRun: true, ok: 2, errors: 2, totalPoints: 15, applied: 0 });
    expect(dry.rows.map((r: { line: number; status: string }) => [r.line, r.status])).toEqual([
      [2, 'ok'],
      [3, 'ok'],
      [4, 'error'],
      [5, 'error'],
    ]);
    expect(await sum(a!.id)).toBe(0);
    // Applying a file with errors is refused; the fixed file applies.
    expect((await http().post('/api/admin/points/import').set('Cookie', admin.cookie).send({ csv, dryRun: false }).expect(409)).body.code).toBe('IMPORT_HAS_ERRORS');
    const fixed = csv.split('\n').slice(0, 3).join('\n');
    const applied = (await http().post('/api/admin/points/import').set('Cookie', admin.cookie).send({ csv: fixed, dryRun: false }).expect(200)).body;
    expect(applied).toMatchObject({ applied: 2, totalPoints: 15 });
    expect(await sum(a!.id, course.id)).toBe(10);
    expect(await sum(b!.id)).toBe(5);
    expect((await prisma.pointsEntry.findFirst({ where: { userId: b!.id } }))!).toMatchObject({ courseId: null, reason: 'MANUAL_COMMUNITY', note: 'Active on WhatsApp' });
    await http().post('/api/admin/points/import').set('Cookie', a!.cookie).send({ csv: fixed, dryRun: true }).expect(403);
  });

  it('ranks this week and the whole course, names only opted-in students, and shows each student their own rank', async () => {
    const { course, first, admin, students } = await setup({ startedDaysAgo: 10, students: 4 });
    const [a, b, c, d] = students;
    const outsider = await createUser(app, prisma, { prefix: 'outsider' });
    await prisma.profile.update({ where: { userId: a!.id }, data: { fullNameEn: 'Aya Nasser Salama' } });
    const week1 = courseWeekRange(first, 1);
    const inWeek1 = new Date(week1.start.getTime() + DAY);
    await prisma.pointsEntry.createMany({
      data: [
        { userId: a!.id, courseId: course.id, points: 30, reason: 'MANUAL_OTHER', createdAt: inWeek1 },
        { userId: b!.id, courseId: course.id, points: 50, reason: 'MANUAL_OTHER', createdAt: inWeek1 },
        { userId: c!.id, courseId: course.id, points: 20, reason: 'MANUAL_OTHER' }, // this week (week 2)
        { userId: a!.id, courseId: course.id, points: 5, reason: 'MANUAL_OTHER' },
        { userId: d!.id, courseId: null, points: 99, reason: 'MANUAL_COMMUNITY' }, // not a course point
      ],
    });
    const url = `/api/learn/${course.slug}/leaderboard`;
    await http().get(url).set('Cookie', outsider.cookie).expect(403);
    await http().put(`${url}/opt-in`).set('Cookie', outsider.cookie).send({ optedIn: true }).expect(403);

    // Nobody opted in: nobody named, but everyone sees their own standing.
    let board = (await http().get(`${url}?scope=course`).set('Cookie', a!.cookie).expect(200)).body;
    expect(board).toMatchObject({ scope: 'course', rows: [], participants: 0, total: 4, me: { rank: 1, points: 35, optedIn: false }, weeks: { current: 2, available: 2 } });

    await http().put(`${url}/opt-in`).set('Cookie', a!.cookie).send({ optedIn: true }).expect(200);
    await http().put(`${url}/opt-in`).set('Cookie', c!.cookie).send({ optedIn: true }).expect(200);
    board = (await http().get(`${url}?scope=course`).set('Cookie', a!.cookie).expect(200)).body;
    expect(board.rows).toEqual([
      { rank: 1, name: 'Aya S.', points: 35, badges: [], me: true },
      { rank: 2, name: 'Test P.', points: 20, badges: [], me: false },
    ]);
    expect(JSON.stringify(board)).not.toMatch(/@|Nasser|Salama|Person/);
    expect(board).toMatchObject({ participants: 2, total: 4, me: { rank: 1, points: 35, optedIn: true } });
    // b (50 points) hasn't opted in: hidden from others, but sees where they'd be.
    const bView = (await http().get(`${url}?scope=course`).set('Cookie', b!.cookie).expect(200)).body;
    expect(bView.rows.map((r: { points: number }) => r.points)).toEqual([35, 20]);
    expect(bView.me).toEqual({ rank: 1, points: 50, optedIn: false });

    // This week (week 2) and a past week.
    const thisWeek = (await http().get(`${url}?scope=week`).set('Cookie', c!.cookie).expect(200)).body;
    expect(thisWeek).toMatchObject({ scope: 'week', week: 2 });
    expect(thisWeek.rows.map((r: { name: string; points: number; rank: number }) => [r.rank, r.points])).toEqual([
      [1, 20],
      [2, 5],
    ]);
    const lastWeek = (await http().get(`${url}?scope=week&week=1`).set('Cookie', c!.cookie).expect(200)).body;
    expect(lastWeek).toMatchObject({ week: 1, rows: [{ rank: 1, points: 30 }], me: { rank: null, points: 0 } });
    // A future week falls back to this week.
    expect((await http().get(`${url}?scope=week&week=9`).set('Cookie', c!.cookie).expect(200)).body.week).toBe(2);

    // Opting out hides the student again.
    await http().put(`${url}/opt-in`).set('Cookie', c!.cookie).send({ optedIn: false }).expect(200);
    expect((await http().get(`${url}?scope=course`).set('Cookie', a!.cookie).expect(200)).body.rows).toHaveLength(1);

    // Admins: the public board through the learn API, and the full list (non-opted marked) with CSV.
    expect((await http().get(`${url}?scope=course`).set('Cookie', admin.cookie).expect(200)).body.me).toBeNull();
    const full = (await http().get(`/api/admin/courses/${course.id}/leaderboard?scope=course`).set('Cookie', admin.cookie).expect(200)).body;
    expect(full.rows.map((r: { email: string; rank: number | null; points: number; optedIn: boolean }) => [r.email, r.rank, r.points, r.optedIn])).toEqual([
      [b!.email, 1, 50, false],
      [a!.email, 2, 35, true],
      [c!.email, 3, 20, false],
      [d!.email, null, 0, false],
    ]);
    const csvRes = await http().get(`/api/admin/courses/${course.id}/leaderboard.csv?scope=week&week=1`).set('Cookie', admin.cookie).expect(200);
    expect(csvRes.text).toContain(b!.email);
    await http().get(`/api/admin/courses/${course.id}/leaderboard`).set('Cookie', a!.cookie).expect(403);
  });

  it('awards "Top of the week" to the top 3 once a week closes, once, and "Top of the course" at the end', async () => {
    // Started 15 days ago: weeks 1 and 2 have closed. Ended yesterday.
    const { course, first, students } = await setup({ startedDaysAgo: 15, students: 5, endDate: new Date(Date.now() - 2 * DAY) });
    const w1 = courseWeekRange(first, 1);
    const at = new Date(w1.start.getTime() + 2 * DAY);
    const pts = [40, 30, 30, 10, 0];
    await prisma.pointsEntry.createMany({
      data: students.map((s, i) => ({ userId: s.id, courseId: course.id, points: pts[i]!, reason: 'MANUAL_OTHER' as const, createdAt: new Date(at.getTime() + i * 60_000) })),
    });
    const jobs = app.get(PointsJobs);
    await jobs.run();
    await jobs.run();
    const weekly = await prisma.userBadge.findMany({ where: { courseId: course.id, badge: { code: 'top-week' } }, orderBy: { awardedAt: 'asc' } });
    // Ranks 1, 2, 2, 4: the three in the top 3 (a tie at 2), once each, for week 1 only.
    expect(weekly.map((b) => [b.userId, b.period])).toEqual(
      expect.arrayContaining([
        [students[0]!.id, 1],
        [students[1]!.id, 1],
        [students[2]!.id, 1],
      ]),
    );
    expect(weekly).toHaveLength(3);
    const top = await prisma.userBadge.findMany({ where: { courseId: course.id, badge: { code: 'top-course' } } });
    expect(top.map((b) => b.userId).sort()).toEqual([students[0]!.id, students[1]!.id, students[2]!.id].sort());
    expect(await prisma.notification.count({ where: { userId: students[0]!.id, type: 'badge.awarded' } })).toBe(2);
    // Badges show next to opted-in names on the board.
    await http().put(`/api/learn/${course.slug}/leaderboard/opt-in`).set('Cookie', students[0]!.cookie).send({ optedIn: true }).expect(200);
    const board = (await http().get(`/api/learn/${course.slug}/leaderboard?scope=course`).set('Cookie', students[3]!.cookie).expect(200)).body;
    expect(board).toMatchObject({ courseEnded: true, weeks: { current: null } });
    expect(board.rows[0].badges.map((b: { code: string }) => b.code).sort()).toEqual(['top-course', 'top-week']);
  });

  it('gives the certificate bonus and "Certified" once (the hook for certificates)', async () => {
    const { course, students } = await setup();
    const [s] = students;
    const points = app.get(PointsService);
    await points.onCertificateIssued(s!.id, course.id, 'cert-1');
    await points.onCertificateIssued(s!.id, course.id, 'cert-1');
    expect(await sum(s!.id)).toBe(50);
    expect(await prisma.userBadge.count({ where: { userId: s!.id, badge: { code: 'certified' } } })).toBe(1);
    await points.onCertificateRevoked(s!.id, course.id, 'cert-1');
    expect(await sum(s!.id)).toBe(0);
    expect(await prisma.userBadge.count({ where: { userId: s!.id, badge: { code: 'certified' } } })).toBe(0);
  });

  it('exports points, badges and leaderboard choices, and removes them on deletion', async () => {
    const { course, admin, students } = await setup();
    const [s] = students;
    await http().post(`/api/admin/students/${s!.id}/points`).set('Cookie', admin.cookie).send({ points: 7, reason: 'MANUAL_OTHER', note: 'Demo day' }).expect(201);
    await app.get(PointsService).awardBadge('top-performer', s!.id, { courseId: course.id });
    await http().put(`/api/learn/${course.slug}/leaderboard/opt-in`).set('Cookie', s!.cookie).send({ optedIn: true }).expect(200);
    const account = app.get(AccountService);
    const data = await account.export(s!.id);
    expect(data).toMatchObject({ points: { total: 7 }, badges: [{ badge: { code: 'top-performer' } }], leaderboards: [{ shownOnLeaderboard: true }] });
    await prisma.user.update({ where: { id: s!.id }, data: { deletedAt: new Date() } });
    await account.anonymize(s!.id);
    expect(await prisma.pointsEntry.count({ where: { userId: s!.id } })).toBe(0);
    expect(await prisma.userBadge.count({ where: { userId: s!.id } })).toBe(0);
    expect(await prisma.leaderboardOptIn.count({ where: { userId: s!.id } })).toBe(0);
  });
});
