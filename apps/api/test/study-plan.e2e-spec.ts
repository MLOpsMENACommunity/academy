import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { addDays, localIsoDate } from '@academy/shared';
import { AutomationService } from '../src/automation/automation.service';
import { PublicRevalidator } from '../src/common/revalidate';
import { PrismaService } from '../src/prisma/prisma.service';
import { StudyPlanJobs } from '../src/study-plan/study-plan.jobs';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

const video = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const past = new Date('2026-08-16T16:00:00Z');
const MIN = 60_000;
const CAIRO = 'Africa/Cairo';
/** Wednesday 18 November 2026, 20:00 in Cairo (UTC+2). */
const WED_8PM = new Date('2026-11-18T18:00:00Z');

describe('study plans (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** A self-paced course: two required videos (30 min each), an optional one, one without a video, and a mandatory quiz. */
  async function setup(opts: { selfPaced?: boolean } = {}) {
    const course = await createCourse(prisma, { requiresApproval: false });
    await prisma.course.update({ where: { id: course.id }, data: { selfPaced: opts.selfPaced ?? true } });
    const lesson = (order: number, recordingUrl: string | null, optional = false) =>
      prisma.courseSession.create({ data: { courseId: course.id, order, titleEn: `L${order}`, titleAr: `د${order}`, startsAt: past, durationMin: 30, recordingUrl, optional } });
    const l1 = await lesson(1, video('aaaaaaaaaaa'));
    const l2 = await lesson(2, video('bbbbbbbbbbb'));
    await lesson(3, video('ccccccccccc'), true);
    await lesson(4, null);
    const quiz = await prisma.assessment.create({
      data: { courseId: course.id, type: 'QUIZ', status: 'PUBLISHED', titleEn: 'Final', titleAr: 'نهائي', maxPoints: 10, passPercent: 80, countsForCertificate: true },
    });
    const student = await createUser(app, prisma);
    await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } });
    return { course, student, l1, l2, quiz };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  const url = (c: Ctx) => `/api/learn/${c.course.slug}/study-plan`;
  const today = () => localIsoDate(new Date(), CAIRO);
  const put = (c: Ctx, body: Record<string, unknown>, cookie = c.student.cookie) => http().put(url(c)).set('Cookie', cookie).send(body);
  const everyDay = { weekdays: [0, 1, 2, 3, 4, 5, 6], minutesPerDay: 60, reminderHour: 20 };

  it('is for enrolled students of self-paced courses only', async () => {
    const c = await setup();
    const outsider = await createUser(app, prisma);
    await http().get(url(c)).expect(401);
    await http().get(url(c)).set('Cookie', outsider.cookie).expect(403);
    await put(c, { ...everyDay, startDate: today() }, outsider.cookie).expect(403);
    const live = await setup({ selfPaced: false });
    expect((await http().get(url(live)).set('Cookie', live.student.cookie).expect(409)).body.code).toBe('NOT_SELF_PACED');
    await put(live, { ...everyDay, startDate: today() }).expect(409);
    // An admin previewing the course can't make one either.
    const admin = await createUser(app, prisma, { role: 'ADMIN' });
    await put(c, { ...everyDay, startDate: today() }, admin.cookie).expect(403);
  });

  it('saves, reads and deletes a plan, with the schedule summary', async () => {
    const c = await setup();
    const empty = (await http().get(url(c)).set('Cookie', c.student.cookie).expect(200)).body;
    expect(empty).toEqual({ timezone: CAIRO, timezoneIsDefault: false, plan: null, summary: null });

    await put(c, { ...everyDay, weekdays: [], startDate: today() }).expect(400);
    await put(c, { ...everyDay, minutesPerDay: 5, startDate: today() }).expect(400);
    await put(c, { ...everyDay, startDate: '2026-02-30' }).expect(400);

    const saved = (await put(c, { ...everyDay, weekdays: [6, 0, 1, 2, 3, 4, 5], startDate: today() }).expect(200)).body;
    expect(saved.plan).toMatchObject({ weekdays: [0, 1, 2, 3, 4, 5, 6], minutesPerDay: 60, startDate: today(), reminderHour: 20 });
    // L1 + L2 (60 min) today, the quiz (20 min) tomorrow; the optional video and the lesson without one don't count.
    expect(saved.summary).toMatchObject({ targetDate: addDays(today(), 1), onTrack: true, behindBy: 0, totalItems: 3, remainingItems: 3 });
    expect(saved.summary.nextDay).toMatchObject({ date: today(), minutes: 60 });
    expect(saved.summary.nextDay.items.map((i: { titleEn: string; kind: string }) => [i.kind, i.titleEn])).toEqual([
      ['lesson', 'L1'],
      ['lesson', 'L2'],
    ]);

    // Done items drop out of the schedule.
    await prisma.sessionProgress.create({ data: { userId: c.student.id, sessionId: c.l1.id, source: 'WATCHED' } });
    const read = (await http().get(url(c)).set('Cookie', c.student.cookie).expect(200)).body;
    expect(read.summary.nextDay.items.map((i: { titleEn: string }) => i.titleEn)).toEqual(['L2', 'Final']);
    expect(read.summary.remainingItems).toBe(2);

    // Started five days ago with nothing done since: behind by the three items due before today… minus L1.
    const behind = (await put(c, { ...everyDay, startDate: addDays(today(), -5), reminderHour: null }).expect(200)).body;
    expect(behind.plan.reminderHour).toBeNull();
    expect(behind.summary).toMatchObject({ onTrack: false, behindBy: 2 });
    expect(await prisma.studyPlan.count({ where: { userId: c.student.id } })).toBe(1);

    await http().delete(url(c)).set('Cookie', c.student.cookie).expect(204);
    expect((await http().get(url(c)).set('Cookie', c.student.cookie).expect(200)).body.plan).toBeNull();
    await http().delete(url(c)).set('Cookie', c.student.cookie).expect(204);
  });

  it('says when the time zone is the academy default', async () => {
    const c = await setup();
    await prisma.profile.update({ where: { userId: c.student.id }, data: { timezone: null } });
    expect((await http().get(url(c)).set('Cookie', c.student.cookie).expect(200)).body).toMatchObject({ timezone: CAIRO, timezoneIsDefault: true });
  });

  describe('reminders', () => {
    const jobs = () => app.get(StudyPlanJobs);
    const rows = (planId: string) => prisma.outboundEmail.findMany({ where: { dedupeKey: { startsWith: `study-plan:${planId}:` } }, orderBy: { createdAt: 'asc' } });
    const notes = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'study-plan.reminder' } });
    /** A Wednesday plan with a reminder at `hour`, from 1 November. */
    async function planOn(c: Ctx, hour: number) {
      await put(c, { weekdays: [3], minutesPerDay: 60, startDate: '2026-11-01', reminderHour: hour }).expect(200);
      return prisma.studyPlan.findUniqueOrThrow({ where: { userId_courseId: { userId: c.student.id, courseId: c.course.id } } });
    }

    it('queues one email and notification per plan and study day, never before the reminder hour', async () => {
      const c = await setup();
      const plan = await planOn(c, 20);
      await jobs().run(new Date(WED_8PM.getTime() - 30 * MIN)); // 19:30 Cairo
      expect(await rows(plan.id)).toHaveLength(0);
      await jobs().run(new Date(WED_8PM.getTime() + 10 * MIN));
      await jobs().run(new Date(WED_8PM.getTime() + 50 * MIN));
      const [row, ...more] = await rows(plan.id);
      expect(more).toHaveLength(0);
      expect(row).toMatchObject({ dedupeKey: `study-plan:${plan.id}:2026-11-18`, category: 'study-plan', courseId: c.course.id, userId: c.student.id });
      expect(row!.notBefore.toISOString()).toBe(WED_8PM.toISOString());
      expect(row!.template).toMatchObject({ name: 'studyPlanReminder', minutes: 60, items: ['L1 · 30 min', 'L2 · 30 min'] });
      const [note, ...moreNotes] = await notes(c.student.id);
      expect(moreNotes).toHaveLength(0);
      expect(note).toMatchObject({ link: `/learn/${c.course.slug}#study-plan` });
      // Thursday is not a study day; the next Wednesday is.
      await jobs().run(new Date(WED_8PM.getTime() + 24 * 3600_000 + 10 * MIN));
      expect(await rows(plan.id)).toHaveLength(1);
      await jobs().run(new Date(WED_8PM.getTime() + 7 * 24 * 3600_000 + 10 * MIN));
      expect((await rows(plan.id)).map((r) => r.dedupeKey)).toEqual([`study-plan:${plan.id}:2026-11-18`, `study-plan:${plan.id}:2026-11-25`]);
    });

    it('drops a reminder hours late, and has none without a reminder hour or before the start date', async () => {
      const c = await setup();
      const plan = await planOn(c, 8);
      await jobs().run(WED_8PM); // 12 hours after 08:00
      expect(await rows(plan.id)).toHaveLength(0);
      await put(c, { weekdays: [3], minutesPerDay: 60, startDate: '2026-11-01', reminderHour: null }).expect(200);
      await jobs().run(new Date('2026-11-18T06:10:00Z'));
      expect(await rows(plan.id)).toHaveLength(0);
      await put(c, { weekdays: [3], minutesPerDay: 60, startDate: '2026-11-20', reminderHour: 8 }).expect(200);
      await jobs().run(new Date('2026-11-18T06:10:00Z'));
      expect(await rows(plan.id)).toHaveLength(0);
    });

    it('emails no one who opted out of the course reminders, and skips students who finished', async () => {
      const c = await setup();
      const plan = await planOn(c, 20);
      await http().put(`/api/learn/${c.course.slug}/reminders`).set('Cookie', c.student.cookie).send({ emailReminders: false }).expect(204);
      await jobs().run(new Date(WED_8PM.getTime() + 10 * MIN));
      const [row] = await rows(plan.id);
      // The key is taken (no retry) but nothing is sent; the in-app notification still comes.
      expect(row).toMatchObject({ status: 'SKIPPED', lastError: 'opted_out' });
      expect(await notes(c.student.id)).toHaveLength(1);

      const done = await setup();
      const donePlan = await planOn(done, 20);
      await prisma.sessionProgress.createMany({ data: [done.l1, done.l2].map((l) => ({ userId: done.student.id, sessionId: l.id, source: 'WATCHED' as const })) });
      await prisma.submission.create({ data: { assessmentId: done.quiz.id, userId: done.student.id, submittedAt: new Date(), score: 9, maxScore: 10 } });
      await jobs().run(new Date(WED_8PM.getTime() + 10 * MIN));
      expect(await rows(donePlan.id)).toHaveLength(0);
      expect(await notes(done.student.id)).toHaveLength(0);
    });
  });

  it('adds study blocks to the private calendar feed without purging the whole edge cache', async () => {
    const c = await setup();
    const feedUrl = (await http().post('/api/me/calendar-feed').set('Cookie', c.student.cookie).expect(200)).body.url as string;
    const changed = jest.spyOn(app.get(PublicRevalidator), 'changed');
    await put(c, { ...everyDay, reminderHour: 7, startDate: today() }).expect(200);
    expect(changed).not.toHaveBeenCalled();
    const plan = await prisma.studyPlan.findFirstOrThrow({ where: { userId: c.student.id } });
    const ics = (await http().get(new URL(feedUrl).pathname).expect(200)).text.replace(/\r\n /g, '');
    expect(ics).toContain(`UID:study-${plan.id}-${today()}`);
    expect(ics).toContain('SUMMARY:Study: Test course — L1');
    expect(ics).toContain(`UID:study-${plan.id}-${addDays(today(), 1)}`);
    changed.mockClear();
    await http().delete(url(c)).set('Cookie', c.student.cookie).expect(204);
    expect(changed).not.toHaveBeenCalled();
    const after = (await http().get(new URL(feedUrl).pathname).expect(200)).text;
    expect(after).not.toContain('study-');
    changed.mockRestore();
  });

  it('nudges a student who is behind their plan once a week (automation)', async () => {
    const c = await setup();
    await put(c, { ...everyDay, startDate: addDays(today(), -5) }).expect(200);
    const automation = app.get(AutomationService);
    const now = new Date();
    expect((await automation.preview(c.course.id, 'STUDY_PLAN_BEHIND', { enabled: true, params: { items: 4 } }, now)).count).toBe(0);
    expect(await automation.preview(c.course.id, 'STUDY_PLAN_BEHIND', { enabled: true, params: { items: 3 } }, now)).toMatchObject({ count: 1 });
    await prisma.courseAutomationRule.create({ data: { courseId: c.course.id, type: 'STUDY_PLAN_BEHIND', enabled: true, params: { items: 3 } } });
    await automation.runAll(now);
    await automation.runAll(new Date(now.getTime() + 3600_000));
    expect(await prisma.automationFiring.count({ where: { courseId: c.course.id, type: 'STUDY_PLAN_BEHIND' } })).toBe(1);
    expect(await prisma.enrollment.count({ where: { courseId: c.course.id } })).toBe(1);
  });

  it('is in the data export and deleted on anonymisation', async () => {
    const c = await setup();
    await put(c, { ...everyDay, startDate: today() }).expect(200);
    const exported = (await http().get('/api/me/export').set('Cookie', c.student.cookie).expect(200)).body;
    expect(exported.studyPlans).toEqual([expect.objectContaining({ weekdays: [0, 1, 2, 3, 4, 5, 6], minutesPerDay: 60, startDate: today(), reminderHour: 20, course: expect.objectContaining({ slug: c.course.slug }) })]);
    await prisma.user.update({ where: { id: c.student.id }, data: { deletedAt: new Date() } });
    await app.get(AccountService).anonymize(c.student.id);
    expect(await prisma.studyPlan.count({ where: { userId: c.student.id } })).toBe(0);
  });
});
