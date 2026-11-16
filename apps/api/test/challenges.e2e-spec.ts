import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CoursePermission } from '@academy/shared';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createCourse, createTestApp, createUser } from './helpers';

type Account = { id: string; email: string; cookie: string };
const DAY = 86_400_000;
let n = 0;

describe('challenges (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'chl-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(undefined as never);
  });
  afterAll(async () => {
    await app.close();
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    slug: `deploy-${Date.now().toString(36)}-${++n}`,
    titleEn: 'Deploy a model in a week',
    titleAr: 'انشر نموذجًا في أسبوع',
    descriptionEn: 'Ship a model behind an **API**.',
    descriptionAr: 'انشر نموذجًا خلف واجهة برمجية.',
    startsAt: new Date(Date.now() - DAY).toISOString(),
    endsAt: new Date(Date.now() + 6 * DAY).toISOString(),
    points: 40,
    status: 'PUBLISHED',
    ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) => (await http().post('/api/admin/challenges').set('Cookie', admin.cookie).send(body(extra)).expect(201)).body as { id: string; slug: string };
  async function student(name = 'Test Person', courseId?: string): Promise<Account> {
    const s = await createUser(app, prisma, { prefix: 'chl-stu' });
    await prisma.profile.update({ where: { userId: s.id }, data: { fullNameEn: name } });
    if (courseId) await prisma.enrollment.create({ data: { userId: s.id, courseId } });
    return s;
  }
  const submit = (slug: string, who: Account, entry: Record<string, unknown> = { url: 'https://github.com/me/model' }) => http().put(`/api/me/challenges/${slug}/entry`).set('Cookie', who.cookie).send(entry);
  const entryOf = (slug: string, userId: string) => prisma.challengeEntry.findFirstOrThrow({ where: { userId, challenge: { slug } } });
  const review = (id: string, entryId: string, decision: 'APPROVE' | 'REJECT', feedback = '') =>
    http().post(`/api/admin/challenges/${id}/entries/${entryId}/review`).set('Cookie', admin.cookie).send({ decision, feedback });
  const challengePoints = async (userId: string) => (await prisma.pointsEntry.aggregate({ where: { userId, reason: 'CHALLENGE', voidedAt: null }, _sum: { points: true } }))._sum.points ?? 0;
  const badgeCount = (userId: string, challengeId: string) => prisma.userBadge.count({ where: { userId, scopeKey: `challenge:${challengeId}` } });

  it('creates the badge with the challenge, and keeps drafts out of sight', async () => {
    const c = await create({ status: 'DRAFT', icon: '🛳️' });
    const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: c.id }, include: { badge: true } });
    expect(stored.badge).toMatchObject({ code: `challenge-${c.slug}`, kind: 'AUTO', nameEn: 'Deploy a model in a week', nameAr: 'انشر نموذجًا في أسبوع', icon: '🛳️' });
    await http().get(`/api/challenges/${c.slug}`).expect(404);
    const s = await student();
    await submit(c.slug, s).expect(404);
    // The same address twice: 409 on the slug.
    const again = await http().post('/api/admin/challenges').set('Cookie', admin.cookie).send(body({ slug: c.slug })).expect(409);
    expect(again.body.errors[0].path).toBe('slug');
    // Published: on the public list, without any personal data.
    await http().put(`/api/admin/challenges/${c.id}`).set('Cookie', admin.cookie).send({ ...body(), status: 'PUBLISHED' }).expect(200);
    const pub = await http().get('/api/challenges').expect(200);
    expect(pub.headers['cache-control']).toBe('no-store');
    expect(pub.body.find((x: { slug: string }) => x.slug === c.slug)).toMatchObject({ phase: 'open', finishers: 0, finisherNames: [], course: null, points: 40 });
  });

  it('only lets enrolled students enter a course challenge, and only while it is open', async () => {
    const course = await createCourse(prisma);
    const c = await create({ courseId: course.id });
    const outsider = await student();
    const enrolled = await student('Enrolled One', course.id);
    expect((await submit(c.slug, outsider).expect(403)).body.code).toBe('CHALLENGE_NOT_ELIGIBLE');
    const mine = (await http().get(`/api/me/challenges/${c.slug}`).set('Cookie', outsider.cookie).expect(200)).body;
    expect(mine).toMatchObject({ eligible: false, canSubmit: false, blocked: 'NOT_ELIGIBLE' });
    // Not in the outsider's own list either; in the enrolled student's.
    expect((await http().get('/api/me/challenges').set('Cookie', outsider.cookie).expect(200)).body.map((x: { slug: string }) => x.slug)).not.toContain(c.slug);
    expect((await http().get('/api/me/challenges').set('Cookie', enrolled.cookie).expect(200)).body.map((x: { slug: string }) => x.slug)).toContain(c.slug);

    const upcoming = await create({ startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString() });
    expect((await submit(upcoming.slug, enrolled).expect(409)).body.code).toBe('CHALLENGE_NOT_STARTED');
    const ended = await create({ startsAt: new Date(Date.now() - 8 * DAY).toISOString(), endsAt: new Date(Date.now() - DAY).toISOString() });
    expect((await submit(ended.slug, enrolled).expect(409)).body.code).toBe('CHALLENGE_CLOSED');
    // https only.
    await submit(c.slug, enrolled, { url: 'http://github.com/me/model' }).expect(400);
    await submit(c.slug, enrolled, { url: 'javascript:alert(1)' }).expect(400);
    expect((await submit(c.slug, enrolled).expect(200)).body).toMatchObject({ eligible: true, entry: { status: 'PENDING', url: 'https://github.com/me/model' } });
  });

  it('takes a resubmission after a rejection, back to pending', async () => {
    const c = await create();
    const s = await student();
    await submit(c.slug, s, { url: 'https://github.com/me/v1', note: 'First try' }).expect(200);
    const e = await entryOf(c.slug, s.id);
    // Rejecting needs feedback.
    await review(c.id, e.id, 'REJECT').expect(400);
    expect((await review(c.id, e.id, 'REJECT', 'Add a README').expect(201)).body).toMatchObject({ status: 'REJECTED', feedback: 'Add a README' });
    const note = await prisma.notification.findFirst({ where: { userId: s.id, type: 'challenge.rejected' } });
    expect(note).toMatchObject({ bodyEn: 'Add a README', link: `/challenges/${c.slug}` });
    const again = (await submit(c.slug, s, { url: 'https://github.com/me/v2', note: 'With a README' }).expect(200)).body;
    expect(again.entry).toMatchObject({ status: 'PENDING', url: 'https://github.com/me/v2', note: 'With a README' });
    expect(await prisma.challengeEntry.count({ where: { userId: s.id, challengeId: c.id } })).toBe(1);
  });

  it('awards the badge and the points exactly once, and takes both back on a later rejection', async () => {
    const course = await createCourse(prisma);
    const c = await create({ courseId: course.id, points: 40 });
    const s = await student('Mona Ali', course.id);
    await submit(c.slug, s).expect(200);
    const e = await entryOf(c.slug, s.id);
    await review(c.id, e.id, 'APPROVE').expect(201);
    await review(c.id, e.id, 'APPROVE', 'Still great').expect(201);
    expect(await challengePoints(s.id)).toBe(40);
    expect(await prisma.pointsEntry.count({ where: { userId: s.id, reason: 'CHALLENGE' } })).toBe(1);
    expect(await badgeCount(s.id, c.id)).toBe(1);
    expect(await prisma.notification.count({ where: { userId: s.id, type: 'challenge.approved' } })).toBe(1);
    // Tagged with the course (its leaderboard), labelled with the challenge in the student's history.
    const mine = (await http().get('/api/me/points').set('Cookie', s.cookie).expect(200)).body;
    expect(mine.courses).toEqual([expect.objectContaining({ slug: course.slug, points: 40 })]);
    expect(mine.recent[0]).toMatchObject({ reason: 'CHALLENGE', points: 40, label: { en: 'Deploy a model in a week' } });
    // An approved entry can't be changed any more.
    expect((await submit(c.slug, s).expect(409)).body.code).toBe('CHALLENGE_APPROVED');

    await review(c.id, e.id, 'REJECT', 'The demo link is someone else’s').expect(201);
    expect(await challengePoints(s.id)).toBe(0);
    expect(await badgeCount(s.id, c.id)).toBe(0);
    // Approved again: once more, not twice.
    await review(c.id, e.id, 'APPROVE').expect(201);
    expect(await challengePoints(s.id)).toBe(40);
    expect(await badgeCount(s.id, c.id)).toBe(1);
  });

  it('shows finisher counts publicly, with names only of finishers who chose to be shown', async () => {
    const c = await create();
    const shown = await student('Salma Hassan Kamel');
    const hidden = await student('Hidden Person');
    const pending = await student('Pending Person');
    await submit(c.slug, shown, { url: 'https://example.com/a', showName: true }).expect(200);
    await submit(c.slug, hidden, { url: 'https://example.com/b' }).expect(200);
    await submit(c.slug, pending, { url: 'https://example.com/c', showName: true }).expect(200);
    for (const s of [shown, hidden]) await review(c.id, (await entryOf(c.slug, s.id)).id, 'APPROVE').expect(201);
    const pub = (await http().get(`/api/challenges/${c.slug}`).expect(200)).body;
    expect(pub).toMatchObject({ finishers: 2, finisherNames: ['Salma K.'] });
    expect(JSON.stringify(pub)).not.toMatch(/@|example\.com|Hidden|Pending/);
    // Hiding the name works after approval too.
    await http().put(`/api/me/challenges/${c.slug}/visibility`).set('Cookie', shown.cookie).send({ showName: false }).expect(200);
    expect((await http().get(`/api/challenges/${c.slug}`).expect(200)).body).toMatchObject({ finishers: 2, finisherNames: [] });
    // A deleted account stops counting at once; anonymisation removes the entry (and the points and badge).
    await prisma.user.update({ where: { id: hidden.id }, data: { deletedAt: new Date() } });
    expect((await http().get(`/api/challenges/${c.slug}`).expect(200)).body.finishers).toBe(1);
    const account = app.get(AccountService);
    expect(await account.export(shown.id)).toMatchObject({ challengeEntries: [{ url: 'https://example.com/a', status: 'APPROVED', challenge: { slug: c.slug } }] });
    await account.anonymize(hidden.id);
    expect(await prisma.challengeEntry.count({ where: { userId: hidden.id } })).toBe(0);
    expect(await prisma.pointsEntry.count({ where: { userId: hidden.id } })).toBe(0);
  });

  it('keeps the admin routes for the academic preset', async () => {
    const c = await create();
    for (const preset of ['ADMISSIONS', 'FINANCE', 'CONTENT', 'SPEAKERS'] as const) {
      const other = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: [preset], prefix: `chl-${preset.toLowerCase()}` });
      await http().get('/api/admin/challenges').set('Cookie', other.cookie).expect(403);
      await http().post('/api/admin/challenges').set('Cookie', other.cookie).send(body()).expect(403);
      await http().get(`/api/admin/challenges/${c.id}/entries`).set('Cookie', other.cookie).expect(403);
    }
    const s = await student();
    await http().get('/api/admin/challenges').set('Cookie', s.cookie).expect(403);
  });

  it('lets course staff run their course’s challenges by permission, and nothing else', async () => {
    const course = await createCourse(prisma);
    const otherCourse = await createCourse(prisma);
    const addRole = async (name: string, permissions: CoursePermission[]) => {
      const dto = (await http().post(`/api/admin/courses/${course.id}/staff/roles`).set('Cookie', admin.cookie).send({ name, permissions, visibility: 'ANONYMOUS' }).expect(201)).body;
      return dto.roles.find((r: { name: string }) => r.name === name)!.id as string;
    };
    const staff = async (permissions: CoursePermission[]) => {
      const who = await createUser(app, prisma, { prefix: 'chl-staff' });
      const roleId = await addRole(`R${++n}`, permissions);
      await http().post(`/api/admin/courses/${course.id}/staff`).set('Cookie', admin.cookie).send({ roleId, email: who.email }).expect(201);
      return who;
    };
    const base = `/api/teach/courses/${course.id}/challenges`;
    const roster = await staff(['VIEW_ROSTER']);
    expect((await http().get(base).set('Cookie', roster.cookie).expect(403)).body.code).toBe('COURSE_PERMISSION');
    expect((await http().post(base).set('Cookie', roster.cookie).send(body()).expect(403)).body.code).toBe('COURSE_PERMISSION');

    const author = await staff(['MANAGE_ASSESSMENTS']);
    // Always for this course, whatever the body says.
    const c = (await http().post(base).set('Cookie', author.cookie).send(body({ courseId: otherCourse.id })).expect(201)).body;
    expect(c.courseId).toBe(course.id);
    const s = await student('Course Student', course.id);
    await submit(c.slug, s).expect(200);
    const e = await entryOf(c.slug, s.id);
    // Authoring isn't reviewing.
    expect((await http().post(`${base}/${c.id}/entries/${e.id}/review`).set('Cookie', author.cookie).send({ decision: 'APPROVE' }).expect(403)).body.code).toBe('COURSE_PERMISSION');

    const grader = await staff(['GRADE']);
    await http().post(base).set('Cookie', grader.cookie).send(body()).expect(403);
    const entries = (await http().get(`${base}/${c.id}/entries`).set('Cookie', grader.cookie).expect(200)).body;
    // Course staff see the name, not the email.
    expect(entries).toEqual([expect.objectContaining({ id: e.id, status: 'PENDING', student: { id: s.id, name: 'Course Student', email: null } })]);
    await http().post(`${base}/${c.id}/entries/${e.id}/review`).set('Cookie', grader.cookie).send({ decision: 'APPROVE' }).expect(201);
    expect(await challengePoints(s.id)).toBe(40);

    // Another course's challenge is a 404 here, and staff of this course aren't staff there.
    const elsewhere = await create({ courseId: otherCourse.id });
    await http().get(`${base}/${elsewhere.id}/entries`).set('Cookie', grader.cookie).expect(404);
    await http().get(`/api/teach/courses/${otherCourse.id}/challenges`).set('Cookie', grader.cookie).expect(403);
    // A challenge open to everyone isn't any course's.
    const global = await create();
    await http().put(`${base}/${global.id}`).set('Cookie', author.cookie).send(body()).expect(404);
  });
});
