import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AUTOMATION_RULES } from '@academy/shared';
import { AutomationService, DAILY_EMAIL_CAP } from '../src/automation/automation.service';
import { CourseData } from '../src/automation/engine';
import { CertificatesService } from '../src/certificates/certificates.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCourse, createTestApp, createUser } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 12:00 Cairo time: outside quiet hours, so emails aren't deferred. */
const NOON = new Date('2026-11-10T10:00:00Z');

describe('course automation rules (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let automation: AutomationService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    automation = app.get(AutomationService);
  });
  afterAll(() => app.close());

  /** An open course with `enrolled` students and sessions at the given offsets (hours from NOON). */
  async function course(opts: { enrolled?: number; sessions?: number[]; type?: 'FREE' | 'PAID'; capacity?: number | null } = {}) {
    const c = await createCourse(prisma, { type: opts.type ?? 'FREE', capacity: opts.capacity ?? null, price: opts.type === 'PAID' ? 1000 : 0 });
    await prisma.course.update({ where: { id: c.id }, data: { status: 'OPEN' } });
    const students = [];
    for (let i = 0; i < (opts.enrolled ?? 0); i++) {
      const s = await createUser(app, prisma);
      await prisma.enrollment.create({ data: { userId: s.id, courseId: c.id, enrolledAt: new Date(NOON.getTime() - 30 * DAY) } });
      students.push(s);
    }
    const sessions = [];
    for (const [i, h] of (opts.sessions ?? []).entries()) {
      sessions.push(
        await prisma.courseSession.create({
          data: { courseId: c.id, order: i + 1, titleEn: `S${i + 1}`, titleAr: `ج${i + 1}`, startsAt: new Date(NOON.getTime() + h * HOUR), durationMin: 60 },
        }),
      );
    }
    const admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'admin' });
    return { ...c, students, sessions, admin };
  }

  const turnOn = (courseId: string, type: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    prisma.courseAutomationRule.upsert({
      where: { courseId_type: { courseId, type } },
      update: { enabled: true, params: params as never, ...extra },
      create: { courseId, type, enabled: true, params: params as never, ...extra },
    });
  const firings = (courseId: string, type: string) => prisma.automationFiring.findMany({ where: { courseId, type } });

  it('serves the Automation tab to ACADEMIC admins and staff with Manage automation rules only', async () => {
    const c = await course();
    const academic = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'acad' });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'fin' });
    const res = await http().get(`/api/admin/courses/${c.id}/automation`).set('Cookie', academic.cookie).expect(200);
    expect(res.body.rules).toHaveLength(AUTOMATION_RULES.length);
    expect(res.body.rules.every((r: { enabled: boolean }) => !r.enabled)).toBe(true);
    await http().get(`/api/admin/courses/${c.id}/automation`).set('Cookie', finance.cookie).expect(403);

    // A moderator (no MANAGE_RULES) can't; a role with it can.
    const staff = await createUser(app, prisma, { prefix: 'staff' });
    const mod = await prisma.courseRole.create({ data: { courseId: c.id, name: 'Moderator', permissions: ['VIEW_ROSTER'] } });
    await prisma.courseStaff.create({ data: { courseId: c.id, roleId: mod.id, userId: staff.id } });
    await http().get(`/api/teach/courses/${c.id}/automation`).set('Cookie', staff.cookie).expect(403);
    await prisma.courseRole.update({ where: { id: mod.id }, data: { permissions: ['VIEW_ROSTER', 'MANAGE_RULES'] } });
    await http().get(`/api/teach/courses/${c.id}/automation`).set('Cookie', staff.cookie).expect(200);
  });

  it('validates and saves a rule, turns on the recommended set and pauses, all audited', async () => {
    const c = await course();
    const base = `/api/admin/courses/${c.id}/automation`;
    const bad = await http().put(`${base}/rules/MISSED_IN_A_ROW`).set('Cookie', c.admin.cookie).send({ enabled: true, params: { sessions: 9 } }).expect(400);
    expect(bad.body.errors[0].path).toBe('params.sessions');
    await http().put(`${base}/rules/NOPE`).set('Cookie', c.admin.cookie).send({ enabled: true }).expect(404);
    const pay = await http()
      .put(`${base}/rules/PAYMENT_REMINDER`)
      .set('Cookie', c.admin.cookie)
      .send({ enabled: true, params: { firstDays: 5, secondDays: 3 } })
      .expect(400);
    expect(pay.body.errors[0].path).toBe('params.secondDays');

    const ok = await http()
      .put(`${base}/rules/MISSED_IN_A_ROW`)
      .set('Cookie', c.admin.cookie)
      .send({ enabled: true, params: { sessions: 3 }, noteEn: 'Ping us on Telegram', noteAr: 'راسلنا على تيليجرام' })
      .expect(200);
    expect(ok.body.rules.find((r: { type: string }) => r.type === 'MISSED_IN_A_ROW')).toMatchObject({ enabled: true, params: { sessions: 3 }, noteEn: 'Ping us on Telegram' });

    const rec = await http().post(`${base}/recommended`).set('Cookie', c.admin.cookie).expect(200);
    const on = rec.body.rules.filter((r: { enabled: boolean }) => r.enabled).map((r: { type: string }) => r.type);
    expect(on).toEqual(expect.arrayContaining(AUTOMATION_RULES.filter((r) => r.recommended).map((r) => r.type)));
    // Settings saved before stay.
    expect(rec.body.rules.find((r: { type: string }) => r.type === 'MISSED_IN_A_ROW').params.sessions).toBe(3);

    expect((await http().put(base).set('Cookie', c.admin.cookie).send({ paused: true }).expect(200)).body.paused).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: { startsWith: 'automation.' } } })).toBe(3);
  });

  it('messages students who missed sessions in a row, once, flags them and alerts the team', async () => {
    const c = await course({ enrolled: 2, sessions: [-72, -48] });
    const [absent, present] = c.students;
    for (const s of c.sessions) {
      await prisma.sessionAttendance.create({ data: { sessionId: s.id, userId: absent!.id, status: 'ABSENT' } });
      await prisma.sessionAttendance.create({ data: { sessionId: s.id, userId: present!.id, status: 'PRESENT' } });
    }
    await turnOn(c.id, 'MISSED_IN_A_ROW', { sessions: 2 });

    await http().post(`/api/admin/courses/${c.id}/automation/rules/MISSED_IN_A_ROW/preview`).set('Cookie', c.admin.cookie).send({}).expect(200);
    // The route uses the real clock; the fixture's sessions are relative to NOON.
    expect(await automation.preview(c.id, 'MISSED_IN_A_ROW', {}, NOON)).toEqual({ count: 1, sample: ['Test Person'] });

    await automation.runAll(NOON);
    const f = await firings(c.id, 'MISSED_IN_A_ROW');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ userId: absent!.id, actions: ['message', 'email', 'alert', 'flag'] });
    expect(await prisma.notification.count({ where: { userId: absent!.id, type: 'automation.missed_in_a_row' } })).toBe(1);
    expect(await prisma.outboundEmail.count({ where: { userId: absent!.id, category: 'automation' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: c.admin.id, type: 'automation.alert.missed_in_a_row' } })).toBe(1);

    // Running again changes nothing; the overview lists the student under "Needs attention".
    await automation.runAll(new Date(NOON.getTime() + HOUR));
    expect(await firings(c.id, 'MISSED_IN_A_ROW')).toHaveLength(1);
    const ov = await http().get(`/api/admin/courses/${c.id}/automation`).set('Cookie', c.admin.cookie).expect(200);
    expect(ov.body.atRisk.map((a: { userId: string }) => a.userId)).toEqual([absent!.id]);
  });

  it('only reminds about an unpaid seat and never changes the application', async () => {
    const c = await course({ type: 'PAID' });
    const student = await createUser(app, prisma);
    const a = await prisma.application.create({ data: { userId: student.id, courseId: c.id, status: 'AWAITING_PAYMENT', answers: {}, profileSnapshot: {} } });
    await prisma.applicationStatusHistory.create({ data: { applicationId: a.id, toStatus: 'AWAITING_PAYMENT', createdAt: new Date(NOON.getTime() - 8 * DAY) } });
    await turnOn(c.id, 'PAYMENT_REMINDER', { firstDays: 3, secondDays: 7 });
    await automation.runAll(NOON);
    const f = await firings(c.id, 'PAYMENT_REMINDER');
    expect(f.map((x) => x.dedupeKey)).toEqual([`${a.id}:2`]);
    expect(f[0]!.actions).toEqual(expect.arrayContaining(['message', 'alert']));
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('AWAITING_PAYMENT');
  });

  it('awards bonus points for a high score once, and issues certificates when set to', async () => {
    const c = await course({ enrolled: 1, sessions: [-48] });
    const s = c.students[0]!;
    const quiz = await prisma.assessment.create({ data: { courseId: c.id, type: 'QUIZ', status: 'PUBLISHED', titleEn: 'Q', titleAr: 'ق', passPercent: 70 } });
    await prisma.submission.create({ data: { assessmentId: quiz.id, userId: s.id, attempt: 1, submittedAt: new Date(NOON.getTime() - DAY), score: 95, maxScore: 100 } });
    await turnOn(c.id, 'HIGH_SCORE', { percent: 90, points: 7 });
    await automation.runAll(NOON);
    await automation.runAll(new Date(NOON.getTime() + HOUR));
    const pts = await prisma.pointsEntry.findMany({ where: { userId: s.id, reason: 'AUTOMATION' } });
    expect(pts.reduce((a, e) => a + e.points, 0)).toBe(7);

    await prisma.course.update({ where: { id: c.id }, data: { certRequireAssessments: false, certMinSessionsPercent: null } });
    await turnOn(c.id, 'CERT_ELIGIBLE', { mode: 'issue' });
    await automation.runAll(NOON);
    expect(await prisma.certificate.count({ where: { enrollment: { courseId: c.id, userId: s.id } } })).toBe(1);
  });

  it('alerts staff with the permission (not admins) about a session without a live link', async () => {
    const c = await course({ sessions: [1] });
    const staff = await createUser(app, prisma, { prefix: 'mgr' });
    const role = await prisma.courseRole.create({ data: { courseId: c.id, name: 'Manager', permissions: ['MANAGE_SESSIONS'] } });
    await prisma.courseStaff.create({ data: { courseId: c.id, roleId: role.id, userId: staff.id } });
    await turnOn(c.id, 'NO_LIVE_LINK', { hours: 2 });
    await automation.runAll(NOON);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: staff.id, type: 'automation.alert.no_live_link' } });
    expect(n.link).toBe(`/teach/courses/${c.id}?tab=sessions`);
    expect(await prisma.notification.count({ where: { userId: c.admin.id, type: 'automation.alert.no_live_link' } })).toBe(0);
  });

  it('respects the course pause, the reminder opt-out, the daily email cap and quiet hours', async () => {
    const c = await course({ enrolled: 2, sessions: [48] });
    const [optedOut, busy] = c.students;
    await prisma.reminderPreference.create({ data: { userId: optedOut!.id, courseId: c.id, emailReminders: false } });
    // 23:00 Cairo: emails wait for 08:00.
    const night = new Date('2026-11-10T21:00:00Z');
    for (let i = 0; i < DAILY_EMAIL_CAP; i++) {
      await prisma.outboundEmail.create({
        data: { userId: busy!.id, locale: 'en', template: {}, category: 'automation', dedupeKey: `cap-${busy!.id}-${i}`, status: 'SENT', createdAt: new Date(night.getTime() - HOUR) },
      });
    }
    await turnOn(c.id, 'WELCOME', { days: 3 });
    await prisma.course.update({ where: { id: c.id }, data: { automationPaused: true } });
    await automation.runAll(NOON);
    expect(await firings(c.id, 'WELCOME')).toHaveLength(0);

    await prisma.course.update({ where: { id: c.id }, data: { automationPaused: false } });
    await automation.runAll(night);
    const rows = await prisma.outboundEmail.findMany({ where: { courseId: c.id, category: 'automation' } });
    const by = new Map(rows.map((r) => [r.userId, r]));
    expect(by.get(optedOut!.id)).toMatchObject({ status: 'SKIPPED', lastError: 'opted_out' });
    expect(by.get(busy!.id)).toMatchObject({ status: 'SKIPPED', lastError: 'daily_cap' });
    // Both still got the in-app message.
    expect(await prisma.notification.count({ where: { userId: { in: [optedOut!.id, busy!.id] }, type: 'automation.welcome' } })).toBe(2);

    const c2 = await course({ enrolled: 1, sessions: [48] });
    await turnOn(c2.id, 'WELCOME', { days: 3 });
    await automation.runAll(night);
    const deferred = await prisma.outboundEmail.findFirstOrThrow({ where: { courseId: c2.id, category: 'automation' } });
    expect(deferred.notBefore.toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });

  it('runs every rule in the catalog on a busy course without failing, and acts for most', async () => {
    const c = await course({ type: 'PAID', capacity: 4, enrolled: 3, sessions: [-120, -96, -72, -48, 30, 72] });
    const [a, b, z] = c.students;
    await prisma.profile.update({ where: { userId: z!.id }, data: { telegramUsername: null } });
    await prisma.course.update({ where: { id: c.id }, data: { startDate: new Date(NOON.getTime() - 6 * DAY), endDate: new Date(NOON.getTime() + 4 * DAY), certMinSessionsPercent: 50 } });
    for (const [i, s] of c.sessions.slice(0, 4).entries()) {
      await prisma.sessionAttendance.create({ data: { sessionId: s.id, userId: a!.id, status: 'PRESENT' } });
      await prisma.sessionAttendance.create({ data: { sessionId: s.id, userId: b!.id, status: i < 3 ? 'PARTIAL' : 'ABSENT' } });
      await prisma.sessionAttendance.create({ data: { sessionId: s.id, userId: z!.id, status: 'ABSENT' } });
    }
    const quiz = await prisma.assessment.create({
      data: { courseId: c.id, type: 'QUIZ', status: 'PUBLISHED', titleEn: 'Quiz', titleAr: 'اختبار', countsForCertificate: true, dueAt: new Date(NOON.getTime() - 2 * DAY) },
    });
    await prisma.submission.create({ data: { assessmentId: quiz.id, userId: a!.id, submittedAt: new Date(NOON.getTime() - 3 * DAY), score: 100, maxScore: 100 } });
    await prisma.submission.create({ data: { assessmentId: quiz.id, userId: b!.id, submittedAt: new Date(NOON.getTime() - 3 * DAY), score: 40, maxScore: 100 } });
    const lab = await prisma.assessment.create({ data: { courseId: c.id, type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab', titleAr: 'معمل', dueAt: new Date(NOON.getTime() + DAY) } });
    await prisma.submission.create({ data: { assessmentId: lab.id, userId: a!.id, submittedAt: new Date(NOON.getTime() - 5 * DAY), maxScore: 100 } });
    await prisma.sessionFeedback.create({ data: { userId: z!.id, courseId: c.id, sessionId: c.sessions[0]!.id, scopeKey: c.sessions[0]!.id, rating: 1, createdAt: new Date(NOON.getTime() - DAY), updatedAt: new Date(NOON.getTime() - DAY) } });
    await prisma.pointsEntry.create({ data: { userId: a!.id, courseId: c.id, points: 20, reason: 'MANUAL_OTHER', createdAt: new Date(NOON.getTime() - 5 * DAY) } });
    const applicant = await createUser(app, prisma);
    const waiting = await prisma.application.create({ data: { userId: applicant.id, courseId: c.id, status: 'SUBMITTED', answers: {}, profileSnapshot: {}, createdAt: new Date(NOON.getTime() - 9 * DAY) } });
    void waiting;
    const payer = await createUser(app, prisma);
    const unpaid = await prisma.application.create({ data: { userId: payer.id, courseId: c.id, status: 'PAYMENT_SUBMITTED', answers: {}, profileSnapshot: {} } });
    await prisma.payment.create({
      data: { applicationId: unpaid.id, method: 'INSTAPAY', amount: 1000, transactionRef: 'REF12345', senderName: 'x', senderPhone: 'y', paidAt: NOON, createdAt: new Date(NOON.getTime() - 3 * DAY) },
    });
    for (const def of AUTOMATION_RULES) {
      const params = def.type === 'COMMUNITY_LINKS' ? { telegramUrl: 'https://t.me/+course' } : {};
      await turnOn(c.id, def.type, params);
    }
    const rules = await prisma.courseAutomationRule.findMany({ where: { courseId: c.id } });
    const certificates = app.get(CertificatesService);
    const data = new CourseData(prisma, await prisma.course.findUniqueOrThrow({ where: { id: c.id } }), NOON, (ids) =>
      certificates.eligibilityFor({ id: c.id, certMinSessionsPercent: 50, certRequireAssessments: true }, ids),
    );
    const acted = new Set<string>();
    for (const r of rules) if ((await automation.runRule(r, data)) > 0) acted.add(r.type);
    // Rules that need a moment this fixture doesn't have (course start, the week after, …) may stay quiet.
    expect(acted.size).toBeGreaterThanOrEqual(15);
    for (const t of ['MISSED_IN_A_ROW', 'OFTEN_LATE', 'QUIZ_FAILED', 'HIGH_SCORE', 'UNGRADED', 'LOW_RATING', 'APPLICATION_IDLE', 'PROOF_WAITING', 'COMMUNITY_LINKS', 'TELEGRAM_MISSING']) {
      expect(acted).toContain(t);
    }
    // Still nobody removed.
    expect(await prisma.enrollment.count({ where: { courseId: c.id } })).toBe(3);
  });

  it('does not run on draft courses', async () => {
    const c = await course({ enrolled: 1, sessions: [48] });
    await prisma.course.update({ where: { id: c.id }, data: { status: 'DRAFT' } });
    await turnOn(c.id, 'WELCOME', { days: 3 });
    await automation.runAll(NOON);
    expect(await firings(c.id, 'WELCOME')).toHaveLength(0);
  });
});
