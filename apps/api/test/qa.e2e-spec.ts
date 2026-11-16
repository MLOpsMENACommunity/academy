import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CourseData, RULES, type CourseRow } from '../src/automation/engine';
import { buildEmail } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

describe('course Q&A (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(() => app.close());

  async function setup() {
    const course = await createCourse(prisma);
    const session = await prisma.courseSession.create({ data: { courseId: course.id, order: 1, titleEn: 'Docker', titleAr: 'دوكر', startsAt: new Date(Date.now() - 86_400_000) } });
    const asker = await createUser(app, prisma, { prefix: 'asker' });
    const peer = await createUser(app, prisma, { prefix: 'peer' });
    const outsider = await createUser(app, prisma, { prefix: 'outsider' });
    for (const u of [asker, peer]) await prisma.enrollment.create({ data: { userId: u.id, courseId: course.id } });
    const base = `/api/learn/${course.slug}/qa`;
    return { course, session, asker, peer, outsider, base };
  }

  async function staffMember(courseId: string, permissions: ('ANSWER_QUESTIONS' | 'VIEW_ROSTER')[], visibility: 'SHOWN' | 'ANONYMOUS' = 'SHOWN') {
    const staff = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'staff' });
    const role = await prisma.courseRole.create({ data: { courseId, name: 'Teaching assistant', nameAr: 'مساعد تدريس', permissions, visibility } });
    await prisma.courseStaff.create({ data: { courseId, roleId: role.id, userId: staff.id } });
    return { ...staff, roleId: role.id };
  }

  it('is for enrolled students only: ask, list, answer, and the follower is told in the app and by email', async () => {
    const { course, session, asker, peer, outsider, base } = await setup();
    await http().get(base).set('Cookie', outsider.cookie).expect(403).expect((r) => expect(r.body.code).toBe('NOT_ENROLLED'));
    await http().post(base).set('Cookie', outsider.cookie).send({ title: 'Can I ask?', body: 'x' }).expect(403);
    await http().post(base).set('Cookie', asker.cookie).send({ title: 'Why', body: 'x' }).expect(400);

    const asked = await http().post(base).set('Cookie', asker.cookie).send({ title: 'How do I tag an image?', body: 'With **docker**?', sessionId: session.id }).expect(201);
    const q = asked.body;
    expect(q).toMatchObject({ status: 'OPEN', following: true, answerCount: 0, session: { id: session.id, order: 1 }, author: { name: 'Test P.', isStaff: false, isYou: true } });
    expect(JSON.stringify(q)).not.toContain('@example.test');

    const list = await http().get(`${base}?filter=unanswered&sessionId=${session.id}&q=TAG`).set('Cookie', peer.cookie).expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body).toMatchObject({ total: 1, page: 1, canModerate: false });
    expect(list.body.items[0]).toMatchObject({ id: q.id, author: { isYou: false } });
    expect((await http().get(`${base}?q=kubernetes`).set('Cookie', peer.cookie).expect(200)).body.total).toBe(0);

    // "I have this question too", not on your own question.
    await http().put(`${base}/${q.id}/vote`).set('Cookie', asker.cookie).expect(409);
    expect((await http().put(`${base}/${q.id}/vote`).set('Cookie', peer.cookie).expect(200)).body).toMatchObject({ voteCount: 1, voted: true });
    expect((await http().put(`${base}/${q.id}/vote`).set('Cookie', peer.cookie).expect(200)).body.voteCount).toBe(1);

    const answered = await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'Use `docker tag src dst`.' }).expect(201);
    expect(answered.body).toMatchObject({ status: 'ANSWERED', answerCount: 1, following: true });
    const answerId = answered.body.answers[0].id;

    const note = await prisma.notification.findFirst({ where: { userId: asker.id, type: 'qa.answer' } });
    expect(note).toMatchObject({ link: `/learn/${course.slug}?q=${q.id}#qa` });
    expect(await prisma.notification.count({ where: { userId: peer.id, type: 'qa.answer' } })).toBe(0);
    const mail = await prisma.outboundEmail.findUnique({ where: { dedupeKey: `qa-answer:${answerId}:${asker.id}` } });
    expect(mail).toMatchObject({ category: 'qa', courseId: course.id, userId: asker.id });
    expect((mail!.template as { name: string; excerpt: string }).excerpt).toBe('Use docker tag src dst.');
    expect(await prisma.outboundEmail.count({ where: { dedupeKey: `qa-answer:${answerId}:${peer.id}` } })).toBe(0);

    // Filters: mine and following.
    expect((await http().get(`${base}?filter=mine`).set('Cookie', peer.cookie).expect(200)).body.total).toBe(0);
    expect((await http().get(`${base}?filter=following`).set('Cookie', peer.cookie).expect(200)).body.total).toBe(1);
    expect((await http().get(`${base}?filter=unanswered`).set('Cookie', peer.cookie).expect(200)).body.total).toBe(0);
  });

  it('skips the email for a student who turned course reminders off, and renders it in both languages', async () => {
    const { course, asker, peer, base } = await setup();
    await prisma.reminderPreference.create({ data: { userId: asker.id, courseId: course.id, emailReminders: false } });
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Quiet question', body: 'x' }).expect(201)).body;
    const a = (await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'Answer' }).expect(201)).body.answers[0];
    expect(await prisma.notification.count({ where: { userId: asker.id, type: 'qa.answer' } })).toBe(1);
    expect(await prisma.outboundEmail.count({ where: { dedupeKey: `qa-answer:${a.id}:${asker.id}` } })).toBe(0);

    const tpl = { name: 'qaAnswer', courseTitle: 'C', questionTitle: 'Q?', excerpt: 'An answer', byTeam: false, url: 'http://x', unsubscribeUrl: 'http://u' } as const;
    expect(buildEmail(tpl, 'en').subject).toBe('New answer: Q?');
    expect(buildEmail(tpl, 'ar').subject).toBe('إجابة جديدة: Q?');
  });

  it('lets authors edit for 30 minutes only, and never someone else’s post', async () => {
    const { asker, peer, base } = await setup();
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'First title', body: 'x' }).expect(201)).body;
    expect((await http().patch(`${base}/${q.id}`).set('Cookie', asker.cookie).send({ title: 'Better title', body: 'y' }).expect(200)).body).toMatchObject({ title: 'Better title', edited: true });
    await http().patch(`${base}/${q.id}`).set('Cookie', peer.cookie).send({ title: 'Hijacked title', body: 'z' }).expect(403);
    const a = (await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'Answer' }).expect(201)).body.answers[0];
    expect(a.editableUntil).toBeTruthy();
    await http().patch(`${base}/${q.id}/answers/${a.id}`).set('Cookie', asker.cookie).send({ body: 'nope' }).expect(404);
    await prisma.courseAnswer.update({ where: { id: a.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    await http().patch(`${base}/${q.id}/answers/${a.id}`).set('Cookie', peer.cookie).send({ body: 'late' }).expect(409).expect((r) => expect(r.body.code).toBe('EDIT_WINDOW_OVER'));
  });

  it('lets only staff with Answer questions moderate; hidden questions stay with their author', async () => {
    const { course, asker, peer, base } = await setup();
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Off-topic question', body: 'x' }).expect(201)).body;
    await http().put(`${base}/${q.id}/pin`).set('Cookie', peer.cookie).send({ pinned: true }).expect(403);

    const roster = await staffMember(course.id, ['VIEW_ROSTER']);
    await http().get(base).set('Cookie', roster.cookie).expect(403);

    const ta = await staffMember(course.id, ['ANSWER_QUESTIONS']);
    expect((await http().get(base).set('Cookie', ta.cookie).expect(200)).body.canModerate).toBe(true);
    expect((await http().put(`${base}/${q.id}/pin`).set('Cookie', ta.cookie).send({ pinned: true }).expect(200)).body.pinned).toBe(true);
    const staffAnswer = (await http().post(`${base}/${q.id}/answers`).set('Cookie', ta.cookie).send({ body: 'From the team' }).expect(201)).body.answers[0];
    expect(staffAnswer.author).toMatchObject({ isStaff: true, roleLabel: 'Teaching assistant', roleLabelAr: 'مساعد تدريس' });
    // Staff can't edit a student's words.
    await http().patch(`${base}/${q.id}`).set('Cookie', ta.cookie).send({ title: 'Edited by staff', body: 'x' }).expect(403);

    expect((await http().put(`${base}/${q.id}/close`).set('Cookie', ta.cookie).send({ closed: true }).expect(200)).body.status).toBe('CLOSED');
    await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'Too late' }).expect(409);
    expect((await http().put(`${base}/${q.id}/close`).set('Cookie', ta.cookie).send({ closed: false }).expect(200)).body.status).toBe('ANSWERED');

    expect((await http().put(`${base}/${q.id}/hide`).set('Cookie', ta.cookie).send({ hidden: true }).expect(200)).body.hidden).toBe(true);
    expect((await http().get(base).set('Cookie', peer.cookie).expect(200)).body.total).toBe(0);
    await http().get(`${base}/${q.id}`).set('Cookie', peer.cookie).expect(404);
    expect((await http().get(`${base}/${q.id}`).set('Cookie', asker.cookie).expect(200)).body.hidden).toBe(true);
    expect((await http().get(base).set('Cookie', ta.cookie).expect(200)).body.total).toBe(1);
    const audit = await prisma.auditLog.count({ where: { entityId: q.id, action: { in: ['qa.question_pinned', 'qa.question_closed', 'qa.question_hidden'] } } });
    expect(audit).toBe(3);

    // An anonymous role is "Course team"; an academic admin moderates every course.
    const anon = await staffMember(course.id, ['ANSWER_QUESTIONS'], 'ANONYMOUS');
    const q2 = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Second question', body: 'x' }).expect(201)).body;
    const anonAnswer = (await http().post(`${base}/${q2.id}/answers`).set('Cookie', anon.cookie).send({ body: 'Hi' }).expect(201)).body.answers[0];
    expect(anonAnswer.author).toMatchObject({ isStaff: true, roleLabel: null, name: null });
    const admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'acad' });
    await http().put(`${base}/${q2.id}/pin`).set('Cookie', admin.cookie).send({ pinned: true }).expect(200);
    const ops = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'fin' });
    await http().get(base).set('Cookie', ops.cookie).expect(403);
  });

  it('awards points for an accepted student answer once, moves them on re-accept, never for staff', async () => {
    const { course, asker, peer, outsider, base } = await setup();
    await prisma.enrollment.create({ data: { userId: outsider.id, courseId: course.id } });
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Points question', body: 'x' }).expect(201)).body;
    const a1 = (await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'One' }).expect(201)).body.answers[0];
    const a2 = (await http().post(`${base}/${q.id}/answers`).set('Cookie', outsider.cookie).send({ body: 'Two' }).expect(201)).body.answers[1];
    const total = async (userId: string) =>
      (await prisma.pointsEntry.findMany({ where: { userId, reason: 'QA_ANSWER', voidedAt: null } })).reduce((n, e) => n + e.points, 0);

    await http().put(`${base}/${q.id}/accept`).set('Cookie', peer.cookie).send({ answerId: a1.id }).expect(403);
    const accepted = await http().put(`${base}/${q.id}/accept`).set('Cookie', asker.cookie).send({ answerId: a1.id }).expect(200);
    expect(accepted.body).toMatchObject({ acceptedAnswerId: a1.id, hasAccepted: true });
    expect(accepted.body.answers[0]).toMatchObject({ id: a1.id, accepted: true });
    await http().put(`${base}/${q.id}/accept`).set('Cookie', asker.cookie).send({ answerId: a1.id }).expect(200);
    expect(await total(peer.id)).toBe(5);

    const moved = await http().put(`${base}/${q.id}/accept`).set('Cookie', asker.cookie).send({ answerId: a2.id }).expect(200);
    expect(moved.body.answers[0].id).toBe(a2.id);
    expect(await total(peer.id)).toBe(0);
    expect(await total(outsider.id)).toBe(5);
    await http().put(`${base}/${q.id}/accept`).set('Cookie', asker.cookie).send({ answerId: null }).expect(200);
    expect(await total(outsider.id)).toBe(0);

    const ta = await staffMember(course.id, ['ANSWER_QUESTIONS']);
    const a3 = (await http().post(`${base}/${q.id}/answers`).set('Cookie', ta.cookie).send({ body: 'Staff' }).expect(201)).body.answers.find((x: { author: { isYou: boolean } }) => x.author.isYou);
    await http().put(`${base}/${q.id}/accept`).set('Cookie', asker.cookie).send({ answerId: a3.id }).expect(200);
    expect(await total(ta.id)).toBe(0);
  });

  it('alerts the team about questions unanswered for too long (automation rule)', async () => {
    const { course, asker, base } = await setup();
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Old question', body: 'x' }).expect(201)).body;
    await http().post(base).set('Cookie', asker.cookie).send({ title: 'Fresh question', body: 'x' }).expect(201);
    await prisma.courseQuestion.update({ where: { id: q.id }, data: { createdAt: new Date(Date.now() - 50 * 3_600_000) } });
    const row = (await prisma.course.findUniqueOrThrow({ where: { id: course.id } })) as unknown as CourseRow;
    const d = new CourseData(prisma, row, new Date(), async () => new Map());
    const result = await RULES.QUESTION_UNANSWERED(d, { hours: 48 });
    expect(result.hits.map((h) => h.key)).toEqual([q.id]);
    expect(result.link?.teach).toBe('qa');
    expect(result.alert!(1).titleEn).toContain('1 question waiting');
  });

  it('keeps the thread when an account is anonymised, without its name, votes or follows', async () => {
    const { asker, peer, base } = await setup();
    const q = (await http().post(base).set('Cookie', asker.cookie).send({ title: 'Kept question', body: 'x' }).expect(201)).body;
    await http().put(`${base}/${q.id}/vote`).set('Cookie', peer.cookie).expect(200);
    await http().post(`${base}/${q.id}/answers`).set('Cookie', peer.cookie).send({ body: 'Kept answer' }).expect(201);

    const exported = await app.get(AccountService).export(peer.id);
    expect(exported.courseAnswers).toEqual([expect.objectContaining({ body: 'Kept answer', question: 'Kept question' })]);

    await prisma.user.update({ where: { id: peer.id }, data: { deletedAt: new Date() } });
    await app.get(AccountService).anonymize(peer.id);
    expect(await prisma.questionVote.count({ where: { userId: peer.id } })).toBe(0);
    expect(await prisma.questionFollow.count({ where: { userId: peer.id } })).toBe(0);
    const after = (await http().get(`${base}/${q.id}`).set('Cookie', asker.cookie).expect(200)).body;
    expect(after).toMatchObject({ voteCount: 0, answerCount: 1 });
    expect(after.answers[0]).toMatchObject({ body: 'Kept answer', author: { name: null, isStaff: false } });
  });
});
