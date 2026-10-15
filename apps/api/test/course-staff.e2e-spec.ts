import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { COURSE_PERMISSIONS, type CoursePermission } from '@academy/shared';
import request from 'supertest';
import { ANY_STAFF, COURSE_CAN_KEY } from '../src/course-access/course-permission.guard';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TeachManageController } from '../src/teaching/teach-manage.controller';
import { TeachingController } from '../src/teaching/teaching.controller';
import { createCourse, createTestApp, createUser } from './helpers';

type Account = { id: string; email: string; cookie: string };
type StaffDto = {
  roles: { id: string; name: string; builtin: string | null; permissions: string[]; visibility: string; members: number }[];
  staff: { id: string; roleId: string; user: { id: string; email: string } | null; instructor: { id: string } | null; displayOnly: boolean; shown: boolean }[];
  noMainInstructor: boolean;
  multipleMainInstructors: boolean;
};

const lab = (extra: Record<string, unknown> = {}) => ({ type: 'LAB', status: 'PUBLISHED', titleEn: 'Lab 1', submissionKind: 'LINK', maxPoints: 20, ...extra });
let keyN = 0;
const message = () => ({ subjectEn: 'Room change', bodyEn: 'We meet in the other room today.', idempotencyKey: `staff-e2e-${Date.now()}-${++keyN}-abcdef` });

/** Every Teaching route with its @CourseCan tag, read from the controllers (so a new route is covered too). */
function teachRoutes(): { method: string; path: string; can: string[] }[] {
  const out: { method: string; path: string; can: string[] }[] = [];
  for (const cls of [TeachingController, TeachManageController]) {
    const base = Reflect.getMetadata(PATH_METADATA, cls) as string | string[];
    const prefix = Array.isArray(base) ? base[0]! : base;
    for (const key of Object.getOwnPropertyNames(cls.prototype)) {
      const h = (cls.prototype as unknown as Record<string, object>)[key]!;
      const path = Reflect.getMetadata(PATH_METADATA, h) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, h) as RequestMethod | undefined;
      const can = Reflect.getMetadata(COURSE_CAN_KEY, h) as string[] | undefined;
      if (path === undefined || method === undefined || !can) continue;
      out.push({ method: RequestMethod[method], path: `/api/${prefix}/${path}`, can });
    }
  }
  return out;
}

describe('course staff, roles and permissions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Account;
  const http = () => request(app.getHttpServer());
  let n = 0;

  const staffOf = async (courseId: string) => (await http().get(`/api/admin/courses/${courseId}/staff`).set('Cookie', admin.cookie).expect(200)).body as StaffDto;
  const roleId = async (courseId: string, builtin: string) => (await staffOf(courseId)).roles.find((r) => r.builtin === builtin)!.id;
  async function addRole(courseId: string, name: string, permissions: CoursePermission[], visibility = 'SHOWN') {
    const dto = (await http().post(`/api/admin/courses/${courseId}/staff/roles`).set('Cookie', admin.cookie).send({ name, permissions, visibility }).expect(201)).body as StaffDto;
    return dto.roles.find((r) => r.name === name)!.id;
  }
  async function addStaff(courseId: string, role: string, who: { email?: string; instructorId?: string }) {
    return (await http().post(`/api/admin/courses/${courseId}/staff`).set('Cookie', admin.cookie).send({ roleId: role, ...who }).expect(201)).body as StaffDto;
  }
  async function enrolled(courseId: string, name = 'Enrolled Student'): Promise<Account> {
    const s = await createUser(app, prisma, { prefix: 'stf-stu' });
    await prisma.profile.update({ where: { userId: s.id }, data: { fullNameEn: name } });
    const a = await prisma.application.create({ data: { userId: s.id, courseId, status: 'ENROLLED', answers: {}, profileSnapshot: {} } });
    await prisma.enrollment.create({ data: { userId: s.id, courseId, applicationId: a.id } });
    return s;
  }
  async function profile(name: string, userId: string | null = null) {
    return prisma.instructor.create({ data: { slug: `stf-${Date.now()}-${++n}`, name, titleEn: 'ML Engineer', bioEn: 'Builds platforms.', userId } });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'stf-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(undefined as never);
  });
  afterAll(async () => {
    await app.close();
  });

  it('maps existing course instructors with the migration backfill: first in order Main instructor, the rest Co-instructors', async () => {
    const course = await createCourse(prisma);
    const linked = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'stf-bf' });
    const [a, b, c] = [await profile('Backfill First'), await profile('Backfill Second', linked.id), await profile('Backfill Third')];
    // A course as it was before course staff: CourseInstructor rows only.
    await prisma.courseInstructor.createMany({
      data: [
        { courseId: course.id, instructorId: b.id, order: 1 },
        { courseId: course.id, instructorId: a.id, order: 0 },
        { courseId: course.id, instructorId: c.id, order: 2 },
      ],
    });
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20261031090000_course_staff_roles/migration.sql'), 'utf8');
    const backfill = sql
      .split('-- ---------------------------------------------------------------- backfill')[1]!
      .split(/;\s*\n/)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
    expect(backfill).toHaveLength(2);
    const ROLLBACK = new Error('rollback');
    let result: { builtin: string | null; instructorId: string | null; userId: string | null; order: number }[] = [];
    let roles = 0;
    await prisma
      .$transaction(async (tx) => {
        // Replay it on an empty staff table (as on the day it ran), then undo everything.
        await tx.courseStaff.deleteMany({});
        await tx.courseRole.deleteMany({});
        for (const stmt of backfill) await tx.$executeRawUnsafe(stmt);
        roles = await tx.courseRole.count({ where: { courseId: course.id } });
        result = (
          await tx.courseStaff.findMany({ where: { courseId: course.id }, orderBy: { order: 'asc' }, include: { role: { select: { builtin: true } } } })
        ).map((s) => ({ builtin: s.role.builtin, instructorId: s.instructorId, userId: s.userId, order: s.order }));
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(roles).toBe(3);
    expect(result).toEqual([
      { builtin: 'MAIN', instructorId: a.id, userId: null, order: 0 },
      { builtin: 'CO', instructorId: b.id, userId: linked.id, order: 1 },
      { builtin: 'CO', instructorId: c.id, userId: null, order: 2 },
    ]);
  });

  it('starts every course with three editable built-in roles, warns without a Main instructor, and creates and assigns a custom role', async () => {
    const course = await createCourse(prisma);
    const dto = await staffOf(course.id);
    expect(dto.roles.map((r) => [r.builtin, r.name, r.visibility])).toEqual([
      ['MAIN', 'Main instructor', 'SHOWN'],
      ['CO', 'Co-instructor', 'SHOWN'],
      ['MODERATOR', 'Moderator', 'ANONYMOUS'],
    ]);
    expect(dto.roles[0]!.permissions).toEqual([...COURSE_PERMISSIONS]);
    expect(dto.noMainInstructor).toBe(true);

    const ta = await addRole(course.id, 'Teaching assistant', ['VIEW_ROSTER', 'GRADE']);
    const stored = await prisma.courseRole.findUniqueOrThrow({ where: { id: ta } });
    // Stored in the canonical order, whatever order they were sent in.
    expect(stored.permissions).toEqual(['GRADE', 'VIEW_ROSTER']);
    await http().post(`/api/admin/courses/${course.id}/staff/roles`).set('Cookie', admin.cookie).send({ name: 'teaching ASSISTANT', permissions: [], visibility: 'SHOWN' }).expect(409);

    const helper = await createUser(app, prisma, { prefix: 'stf-ta' });
    const after = await addStaff(course.id, ta, { email: helper.email.toUpperCase() });
    expect(after.staff).toEqual([expect.objectContaining({ roleId: ta, user: expect.objectContaining({ id: helper.id }), displayOnly: false })]);
    await http().post(`/api/admin/courses/${course.id}/staff`).set('Cookie', admin.cookie).send({ roleId: ta, email: helper.email }).expect(409);
    await http().post(`/api/admin/courses/${course.id}/staff`).set('Cookie', admin.cookie).send({ roleId: ta, email: 'nobody-here@example.test' }).expect(404);
    // A role id of another course is a 404.
    const other = await createCourse(prisma);
    await http().post(`/api/admin/courses/${other.id}/staff`).set('Cookie', admin.cookie).send({ roleId: ta, email: helper.email }).expect(404);

    // Main instructor stays; a role with people can't go.
    const main = await roleId(course.id, 'MAIN');
    expect((await http().delete(`/api/admin/courses/${course.id}/staff/roles/${main}`).set('Cookie', admin.cookie).expect(400)).body.code).toBe('MAIN_ROLE');
    expect((await http().delete(`/api/admin/courses/${course.id}/staff/roles/${ta}`).set('Cookie', admin.cookie).expect(409)).body.code).toBe('ROLE_HAS_STAFF');
    // Built-ins can be renamed and re-permissioned.
    const renamed = (await http().put(`/api/admin/courses/${course.id}/staff/roles/${main}`).set('Cookie', admin.cookie).send({ name: 'Lead instructor', permissions: ['GRADE'], visibility: 'SHOWN' }).expect(200)).body as StaffDto;
    expect(renamed.roles.find((r) => r.id === main)).toMatchObject({ name: 'Lead instructor', builtin: 'MAIN', permissions: ['GRADE'] });
    // The Moderator role can go once empty (and isn't brought back).
    const mod = await roleId(course.id, 'MODERATOR');
    await http().delete(`/api/admin/courses/${course.id}/staff/roles/${mod}`).set('Cookie', admin.cookie).expect(200);
    expect((await staffOf(course.id)).roles.some((r) => r.builtin === 'MODERATOR')).toBe(false);

    // Everything is audited.
    const actions = (await prisma.auditLog.findMany({ where: { entityId: course.id, actorId: admin.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['course_role.created', 'course_staff.added', 'course_role.updated', 'course_role.deleted']));

    // Only ACADEMIC (and SUPER) admins manage staff.
    const admissions = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'stf-adm' });
    await http().get(`/api/admin/courses/${course.id}/staff`).set('Cookie', admissions.cookie).expect(403);
    await http().get(`/api/admin/courses/${course.id}/staff`).set('Cookie', helper.cookie).expect(403);
  });

  it('checks every Teaching route against its permission (a matrix: each permission alone)', async () => {
    const course = await createCourse(prisma);
    const routes = teachRoutes().filter((r) => !r.can.includes(ANY_STAFF));
    expect(routes.length).toBeGreaterThan(40);
    const url = (path: string) => path.replace(':courseId', course.id).replace(/:[A-Za-z]+/g, 'not-an-id');
    const call = (method: string, path: string, cookie: string) => {
      const agent = http();
      const r = method === 'GET' ? agent.get(url(path)) : method === 'POST' ? agent.post(url(path)) : method === 'PUT' ? agent.put(url(path)) : method === 'PATCH' ? agent.patch(url(path)) : agent.delete(url(path));
      return r.set('Cookie', cookie).send({});
    };

    // Someone off the staff: 403 NOT_YOUR_COURSE everywhere (the course overview too).
    const outsider = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'stf-out' });
    for (const r of [...routes, { method: 'GET', path: '/api/teach/courses/:courseId', can: [] }]) {
      const res = await call(r.method, r.path, outsider.cookie);
      expect([r.method, r.path, res.status, res.body.code]).toEqual([r.method, r.path, 403, 'NOT_YOUR_COURSE']);
    }

    for (const p of COURSE_PERMISSIONS) {
      const role = await addRole(course.id, `Only ${p}`, [p], 'ANONYMOUS');
      const who = await createUser(app, prisma, { prefix: `stf-${p.toLowerCase().replace(/_/g, '-')}` });
      await addStaff(course.id, role, { email: who.email });
      // Any staff member sees the course overview, with exactly their permissions.
      const overview = (await http().get(`/api/teach/courses/${course.id}`).set('Cookie', who.cookie).expect(200)).body;
      expect(overview).toMatchObject({ permissions: [p], roleName: `Only ${p}` });
      for (const r of routes) {
        const res = await call(r.method, r.path, who.cookie);
        if (r.can.includes(p)) {
          expect([p, r.method, r.path, res.status === 403]).toEqual([p, r.method, r.path, false]);
        } else {
          expect([p, r.method, r.path, res.status, res.body.code]).toEqual([p, r.method, r.path, 403, 'COURSE_PERMISSION']);
        }
      }
    }
  }, 240_000);

  it('a student moderator with only ANNOUNCE can announce but not grade', async () => {
    const course = await createCourse(prisma);
    const student = await enrolled(course.id);
    const mod = await createUser(app, prisma, { prefix: 'stf-mod' });
    await prisma.profile.update({ where: { userId: mod.id }, data: { fullNameEn: 'Past Top Student', fullNameAr: 'طالب متميز' } });
    const role = await roleId(course.id, 'MODERATOR');
    await http().put(`/api/admin/courses/${course.id}/staff/roles/${role}`).set('Cookie', admin.cookie).send({ name: 'Moderator', permissions: ['ANNOUNCE'], visibility: 'ANONYMOUS' }).expect(200);
    await addStaff(course.id, role, { email: mod.email });

    const assessment = (await http().post(`/api/admin/courses/${course.id}/assessments`).set('Cookie', admin.cookie).send(lab()).expect(201)).body;
    const sub = (await http().post(`/api/learn/${course.slug}/assessments/${assessment.id}/submission`).set('Cookie', student.cookie).send({ url: 'https://example.org/lab', attested: true }).expect(200)).body;

    // My courses lists it for the student account.
    const mine = (await http().get('/api/teach/courses').set('Cookie', mod.cookie).expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ id: course.id, permissions: ['ANNOUNCE'], roleName: 'Moderator', toGrade: 0 })]);

    const sent = (await http().post(`/api/teach/courses/${course.id}/announcements`).set('Cookie', mod.cookie).send(message()).expect(201)).body;
    expect(sent.recipients).toBe(1);
    const a = await prisma.announcement.findUniqueOrThrow({ where: { id: sent.id } });
    expect(a).toMatchObject({ createdById: mod.id, fromName: 'Past Top Student', fromNameAr: 'طالب متميز' });
    expect(await prisma.auditLog.count({ where: { action: 'announcement.sent_by_speaker', actorId: mod.id, entityId: sent.id } })).toBe(1);
    const overview = (await http().get(`/api/teach/courses/${course.id}/announcements`).set('Cookie', mod.cookie).expect(200)).body;
    expect(overview).toMatchObject({ audience: 1, sentToday: 1 });

    const denied = await http().put(`/api/teach/courses/${course.id}/submissions/${sub.id}/grade`).set('Cookie', mod.cookie).send({ score: 5 }).expect(403);
    expect(denied.body.code).toBe('COURSE_PERMISSION');
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } })).gradedAt).toBeNull();
    await http().get(`/api/teach/courses/${course.id}/roster`).set('Cookie', mod.cookie).expect(403);
  });

  it('a co-instructor with GRADE grades only their own course', async () => {
    const [mine, theirs] = [await createCourse(prisma), await createCourse(prisma)];
    const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'stf-co' });
    const p = await profile('Co Grader', speaker.id);
    const main = await profile('Main Person');
    // The course editor's Instructors field: first Main instructor, then Co-instructor.
    const form = (await http().get(`/api/admin/courses/${mine.id}`).set('Cookie', admin.cookie).expect(200)).body;
    await http()
      .put(`/api/admin/courses/${mine.id}`)
      .set('Cookie', admin.cookie)
      .send({ ...form, shortDescriptionEn: 'A practical course for engineers.', shortDescriptionAr: 'دورة عملية للمهندسين.', instructorIds: [main.id, p.id] })
      .expect(200);
    const dto = await staffOf(mine.id);
    expect(dto.noMainInstructor).toBe(false);
    expect(dto.staff.map((s) => [dto.roles.find((r) => r.id === s.roleId)!.builtin, s.instructor?.id, s.user?.id ?? null])).toEqual([
      ['MAIN', main.id, null],
      ['CO', p.id, speaker.id],
    ]);
    // CourseInstructor follows (the old readers).
    expect((await prisma.courseInstructor.findMany({ where: { courseId: mine.id }, orderBy: { order: 'asc' } })).map((x) => x.instructorId)).toEqual([main.id, p.id]);

    const [s1, s2] = [await enrolled(mine.id), await enrolled(theirs.id)];
    const a1 = (await http().post(`/api/admin/courses/${mine.id}/assessments`).set('Cookie', admin.cookie).send(lab()).expect(201)).body;
    const a2 = (await http().post(`/api/admin/courses/${theirs.id}/assessments`).set('Cookie', admin.cookie).send(lab()).expect(201)).body;
    const sub1 = (await http().post(`/api/learn/${mine.slug}/assessments/${a1.id}/submission`).set('Cookie', s1.cookie).send({ url: 'https://example.org/a', attested: true }).expect(200)).body;
    const sub2 = (await http().post(`/api/learn/${theirs.slug}/assessments/${a2.id}/submission`).set('Cookie', s2.cookie).send({ url: 'https://example.org/b', attested: true }).expect(200)).body;

    await http().put(`/api/teach/courses/${mine.id}/submissions/${sub1.id}/grade`).set('Cookie', speaker.cookie).send({ score: 18, feedback: 'Nice' }).expect(200);
    // Another course's submission through my course: 404; through theirs: 403.
    await http().put(`/api/teach/courses/${mine.id}/submissions/${sub2.id}/grade`).set('Cookie', speaker.cookie).send({ score: 1 }).expect(404);
    expect((await http().put(`/api/teach/courses/${theirs.id}/submissions/${sub2.id}/grade`).set('Cookie', speaker.cookie).send({ score: 1 }).expect(403)).body.code).toBe('NOT_YOUR_COURSE');
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: sub2.id } })).gradedAt).toBeNull();
    // Without EDIT_COURSE (Co-instructor default), the course details are out of reach.
    expect((await http().get(`/api/teach/courses/${mine.id}/details`).set('Cookie', speaker.cookie).expect(403)).body.code).toBe('COURSE_PERMISSION');

    // The old speaker routes still work, the same rule behind them.
    await http().get(`/api/speaker/courses/${mine.id}/assessments`).set('Cookie', speaker.cookie).expect(200);
    await http().get(`/api/speaker/courses/${theirs.id}/assessments`).set('Cookie', speaker.cookie).expect(403);
    expect((await http().get('/api/speaker/courses').set('Cookie', speaker.cookie).expect(200)).body.map((c: { id: string }) => c.id)).toEqual([mine.id]);

    // Removing them (the speaker page's Assigned courses) applies at once.
    const speakersAdmin = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['SPEAKERS'], prefix: 'stf-spk-admin' });
    await http().delete(`/api/admin/instructors/${p.id}/courses/${mine.id}`).set('Cookie', speakersAdmin.cookie).expect(200);
    await http().get(`/api/teach/courses/${mine.id}/assessments`).set('Cookie', speaker.cookie).expect(403);
  });

  it('display-only staff (a profile without an account on the staff row) can do nothing', async () => {
    const course = await createCourse(prisma);
    const owner = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'stf-disp' });
    // Shown on the page through a profile row that has no account on it.
    const p = await profile('Display Only');
    const dto = await addStaff(course.id, await roleId(course.id, 'MAIN'), { instructorId: p.id });
    expect(dto.staff[0]).toMatchObject({ displayOnly: true, user: null });
    await http().get(`/api/teach/courses/${course.id}`).set('Cookie', owner.cookie).expect(403);
    expect((await http().get('/api/teach/courses').set('Cookie', owner.cookie).expect(200)).body).toEqual([]);
    // Even the account the profile is linked to later has nothing until it is on the row (approval links it).
    await prisma.instructor.update({ where: { id: p.id }, data: { userId: owner.id } });
    await http().get(`/api/teach/courses/${course.id}`).set('Cookie', owner.cookie).expect(403);
    // Adding the account joins the two into one row (no second person).
    const joined = await addStaff(course.id, await roleId(course.id, 'MAIN'), { email: owner.email });
    expect(joined.staff).toHaveLength(1);
    expect(joined.staff[0]).toMatchObject({ displayOnly: false, user: expect.objectContaining({ id: owner.id }), instructor: expect.objectContaining({ id: p.id }) });
    await http().get(`/api/teach/courses/${course.id}`).set('Cookie', owner.cookie).expect(200);
    // Deleting the profile keeps the account on the staff; deleting a display-only profile removes its row.
    const q = await profile('Gone Soon');
    await addStaff(course.id, await roleId(course.id, 'CO'), { instructorId: q.id });
    await prisma.instructor.delete({ where: { id: q.id } });
    await prisma.instructor.delete({ where: { id: p.id } });
    const left = await staffOf(course.id);
    expect(left.staff).toEqual([expect.objectContaining({ user: expect.objectContaining({ id: owner.id }), instructor: null })]);
  });

  it('shows Shown staff on the public course page grouped by role (Main instructor first), never anonymous staff or emails', async () => {
    const course = await createCourse(prisma);
    const main = await profile('Public Main');
    const coAccount = await createUser(app, prisma, { prefix: 'stf-pub-co' });
    await prisma.profile.update({ where: { userId: coAccount.id }, data: { fullNameEn: 'Account Name Only', fullNameAr: 'اسم الحساب' } });
    const hidden = await createUser(app, prisma, { prefix: 'stf-pub-hidden' });
    await prisma.profile.update({ where: { userId: hidden.id }, data: { fullNameEn: 'Secret Moderator' } });
    const guest = await addRole(course.id, 'Guest lecturer', [], 'SHOWN');
    await addStaff(course.id, guest, { email: coAccount.email });
    await addStaff(course.id, await roleId(course.id, 'MAIN'), { instructorId: main.id });
    await addStaff(course.id, await roleId(course.id, 'MODERATOR'), { email: hidden.email });

    const res = await http().get(`/api/courses/${course.slug}`).expect(200);
    expect(res.body.staff).toEqual([
      expect.objectContaining({ name: 'Main instructor', builtin: 'MAIN', people: [expect.objectContaining({ name: 'Public Main', titleEn: 'ML Engineer', slug: main.slug })] }),
      expect.objectContaining({ name: 'Guest lecturer', builtin: null, people: [expect.objectContaining({ name: 'Account Name Only', nameAr: 'اسم الحساب', photoUrl: null, slug: null })] }),
    ]);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Secret Moderator');
    for (const a of [coAccount, hidden]) {
      expect(json).not.toContain(a.email);
      expect(json).not.toContain(a.id);
    }
    // The old instructors list: Main and Co-instructors with a profile.
    expect(res.body.instructors.map((i: { name: string }) => i.name)).toEqual(['Public Main']);

    // Hiding the Main instructor role takes them off the page (and off the instructors list).
    const mainRole = await roleId(course.id, 'MAIN');
    await http().put(`/api/admin/courses/${course.id}/staff/roles/${mainRole}`).set('Cookie', admin.cookie).send({ name: 'Main instructor', permissions: [...COURSE_PERMISSIONS], visibility: 'ANONYMOUS' }).expect(200);
    const after = await http().get(`/api/courses/${course.slug}`).expect(200);
    expect(after.body.staff.map((g: { name: string }) => g.name)).toEqual(['Guest lecturer']);
    expect(after.body.instructors).toEqual([]);
    // The course editor still shows them in its Instructors field (hidden is not removed).
    expect((await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).expect(200)).body.instructorIds).toEqual([main.id]);
  });

  it('runs the course with management permissions, scoped to that course', async () => {
    const [course, other] = [await createCourse(prisma), await createCourse(prisma)];
    const manager = await createUser(app, prisma, { prefix: 'stf-mgr' });
    const role = await addRole(course.id, 'Course admin', ['EDIT_COURSE', 'MANAGE_SESSIONS', 'MANAGE_APPLICATIONS', 'ENROL', 'ISSUE_CERTIFICATES', 'VIEW_ROSTER']);
    await addStaff(course.id, role, { email: manager.email });
    const base = `/api/teach/courses/${course.id}`;

    // Details: the editor, but status, address, price and instructors stay as they are.
    const details = (await http().get(`${base}/details`).set('Cookie', manager.cookie).expect(200)).body;
    const saved = (await http().put(`${base}/details`).set('Cookie', manager.cookie).send({ ...details, shortDescriptionEn: 'A practical course for engineers.', shortDescriptionAr: 'دورة عملية للمهندسين.', titleEn: 'Renamed by staff', status: 'ARCHIVED', slug: 'stolen-slug', price: 999, type: 'PAID' }).expect(200)).body;
    expect(saved).toMatchObject({ titleEn: 'Renamed by staff', status: 'OPEN', slug: course.slug, price: 0, type: 'FREE' });
    expect(await prisma.auditLog.count({ where: { action: 'course.updated', actorId: manager.id, entityId: course.id } })).toBe(1);

    // Sessions: create, edit, delete; another course's session is a 404.
    const s = (await http().post(`${base}/sessions`).set('Cookie', manager.cookie).send({ titleEn: 'Kickoff', titleAr: 'البداية', startsAt: '2030-02-01T17:00:00Z', durationMin: 90, liveUrl: 'https://meet.google.com/abc-defg-hij', materials: [], topics: [] }).expect(201)).body;
    const foreign = await prisma.courseSession.create({ data: { courseId: other.id, order: 1, titleEn: 'Theirs', titleAr: 'لهم', startsAt: new Date('2030-01-01T17:00:00Z') } });
    await http().put(`${base}/sessions/${foreign.id}`).set('Cookie', manager.cookie).send({ titleEn: 'Hijack', titleAr: 'اختطاف', startsAt: '2030-02-01T17:00:00Z', durationMin: 90, materials: [], topics: [] }).expect(404);
    await http().delete(`${base}/sessions/${foreign.id}`).set('Cookie', manager.cookie).expect(404);
    await http().delete(`${base}/sessions/${s.id}`).set('Cookie', manager.cookie).expect(204);

    // Applications: this course's only; never their own.
    const applicant = await createUser(app, prisma, { prefix: 'stf-app' });
    const app1 = await prisma.application.create({ data: { userId: applicant.id, courseId: course.id, answers: {}, profileSnapshot: {} } });
    const app2 = await prisma.application.create({ data: { userId: applicant.id, courseId: other.id, answers: {}, profileSnapshot: {} } });
    const own = await prisma.application.create({ data: { userId: manager.id, courseId: course.id, answers: {}, profileSnapshot: {} } });
    const list = (await http().get(`${base}/applications?courseId=${other.id}`).set('Cookie', manager.cookie).expect(200)).body;
    expect(list.items.map((i: { id: string }) => i.id).sort()).toEqual([app1.id, own.id].sort());
    const detail = (await http().get(`${base}/applications/${app1.id}`).set('Cookie', manager.cookie).expect(200)).body;
    expect(detail).toMatchObject({ id: app1.id, notes: [], payments: [] });
    await http().get(`${base}/applications/${app2.id}`).set('Cookie', manager.cookie).expect(404);
    await http().post(`${base}/applications/${app2.id}/transition`).set('Cookie', manager.cookie).send({ event: 'SHORTLIST' }).expect(404);
    expect((await http().post(`${base}/applications/${own.id}/transition`).set('Cookie', manager.cookie).send({ event: 'SHORTLIST' }).expect(403)).body.code).toBe('OWN_APPLICATION');
    await http().post(`${base}/applications/bulk`).set('Cookie', manager.cookie).send({ ids: [app1.id, app2.id], event: 'SHORTLIST' }).expect(404);
    expect((await http().post(`${base}/applications/${app1.id}/transition`).set('Cookie', manager.cookie).send({ event: 'SHORTLIST' }).expect(200)).body.status).toBe('SHORTLISTED');
    expect(await prisma.auditLog.count({ where: { action: 'application.status_changed', actorId: manager.id, entityId: app1.id } })).toBe(1);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app2.id } })).status).toBe('SUBMITTED');

    // Enrolment and certificates: lists of this course; another course's certificate is a 404.
    await http().get(`${base}/invites`).set('Cookie', manager.cookie).expect(200);
    await http().get(`${base}/waitlist`).set('Cookie', manager.cookie).expect(200);
    await http().get(`${base}/certificates`).set('Cookie', manager.cookie).expect(200);
    const stranger = await enrolled(other.id);
    const enr = await prisma.enrollment.findFirstOrThrow({ where: { userId: stranger.id, courseId: other.id } });
    const cert = await prisma.certificate.create({ data: { enrollmentId: enr.id, serial: `MMA-2030-${String(Date.now()).slice(-8)}`, nameOnCertificate: 'Stranger', courseTitleEn: 'Other', courseTitleAr: 'أخرى' } });
    await http().post(`${base}/certificates/${cert.id}/revoke`).set('Cookie', manager.cookie).send({ reason: 'Not yours' }).expect(404);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: cert.id } })).revokedAt).toBeNull();

    // Roster: enrolled students' names and email, no one else's; viewing it is audited.
    const st = await enrolled(course.id, 'Roster Person');
    const roster = (await http().get(`${base}/roster`).set('Cookie', manager.cookie).expect(200)).body;
    expect(roster).toEqual([expect.objectContaining({ userId: st.id, name: 'Roster Person', email: st.email, telegram: null, discord: null })]);
    expect(await prisma.auditLog.count({ where: { action: 'course.roster_viewed', actorId: manager.id } })).toBeGreaterThan(0);

    // Off the staff: everything stops at once.
    const dto = await staffOf(course.id);
    await http().delete(`/api/admin/courses/${course.id}/staff/${dto.staff.find((x) => x.user?.id === manager.id)!.id}`).set('Cookie', admin.cookie).expect(200);
    await http().get(`${base}/roster`).set('Cookie', manager.cookie).expect(403);
  });

  it('only SUPER and ADMISSIONS admins on the staff may enrol by email on a paid course (it waives the payment)', async () => {
    const [paid, free] = [await createCourse(prisma, { type: 'PAID', price: 1500 }), await createCourse(prisma)];
    const main = await createUser(app, prisma, { prefix: 'stf-pay-main' });
    const admissions = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ADMISSIONS'], prefix: 'stf-pay-adm' });
    for (const c of [paid, free]) await addStaff(c.id, await roleId(c.id, 'MAIN'), { email: main.email });
    await addStaff(paid.id, await roleId(paid.id, 'MAIN'), { email: admissions.email });
    const [a, b, c] = [await createUser(app, prisma, { prefix: 'stf-pay-a' }), await createUser(app, prisma, { prefix: 'stf-pay-b' }), await createUser(app, prisma, { prefix: 'stf-pay-c' })];
    const enrol = (courseId: string, who: Account, email: string, skipPayment?: boolean) =>
      http().post(`/api/teach/courses/${courseId}/invites`).set('Cookie', who.cookie).send({ entries: [{ email }], sendEmail: false, ...(skipPayment === undefined ? {} : { skipPayment }) });

    // A Main instructor who isn't an admin: never on a paid course, with or without skipPayment.
    expect((await enrol(paid.id, main, a.email, true).expect(403)).body.code).toBe('PAYMENT_WAIVER_ADMIN_ONLY');
    expect((await enrol(paid.id, main, a.email).expect(403)).body.code).toBe('PAYMENT_WAIVER_ADMIN_ONLY');
    expect(await prisma.enrollment.count({ where: { courseId: paid.id } })).toBe(0);
    expect(await prisma.courseInvite.count({ where: { courseId: paid.id } })).toBe(0);
    // skipPayment on a free course is refused too (it is a waiver flag).
    expect((await enrol(free.id, main, b.email, true).expect(403)).body.code).toBe('PAYMENT_WAIVER_ADMIN_ONLY');
    // The overview tells the web app to hide the option.
    expect((await http().get(`/api/teach/courses/${paid.id}`).set('Cookie', main.cookie).expect(200)).body.canWaivePayment).toBe(false);

    // A free course: enrolled.
    expect((await enrol(free.id, main, b.email).expect(200)).body.enrolled).toBe(1);
    expect(await prisma.enrollment.count({ where: { courseId: free.id, userId: b.id } })).toBe(1);

    // An ADMISSIONS admin on the staff still can, as on the admin side.
    expect((await http().get(`/api/teach/courses/${paid.id}`).set('Cookie', admissions.cookie).expect(200)).body.canWaivePayment).toBe(true);
    expect((await enrol(paid.id, admissions, c.email, true).expect(200)).body.enrolled).toBe(1);
    expect(await prisma.enrollment.count({ where: { courseId: paid.id, userId: c.id } })).toBe(1);
  });

  it('archived courses close to staff, but not to SUPER and ACADEMIC admins', async () => {
    const course = await createCourse(prisma);
    const who = await createUser(app, prisma, { prefix: 'stf-arch' });
    await addStaff(course.id, await roleId(course.id, 'CO'), { email: who.email });
    await http().get(`/api/teach/courses/${course.id}/assessments`).set('Cookie', who.cookie).expect(200);
    await prisma.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
    await http().get(`/api/teach/courses/${course.id}/assessments`).set('Cookie', who.cookie).expect(403);
    await http().get(`/api/teach/courses/${course.id}/assessments`).set('Cookie', admin.cookie).expect(200);
  });
});
