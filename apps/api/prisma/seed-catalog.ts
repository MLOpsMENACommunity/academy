/* eslint-disable no-console */
import type { Prisma, PrismaClient } from '@prisma/client';
import { setCourseInstructors } from '../src/course-staff/staff-sync';
import type { SeedCourse, SeedInstructorRevision, SeedRevision } from './seed-data';

/** Setting row listing every slug the seed has ever created (not a user-facing setting). */
const SEEDED_KEY = '__seededCourses';
const PLACEHOLDER = '[PLACEHOLDER]';

/**
 * Creates the seed catalog. Safe to run on every start:
 * - a course is created once; if an admin later renames or deletes it, it is not recreated;
 * - questions, sessions and instructors are only added to a course that has none;
 * - a course still holding the old placeholder content, or an earlier version of its seed
 *   (`supersedes`), never touched by an admin, is replaced in place by the current seed
 *   (see `isUntouchedPlaceholder`). Once replaced it holds the current content, so later
 *   starts leave it alone;
 * - a single field changed in a later version of the seed (`revisions`) reaches a course that
 *   still holds exactly the earlier values and that no admin has saved (see applyRevisions).
 */
export async function seedCatalog(prisma: PrismaClient, courses: SeedCourse[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const seeded = new Set(await readSeeded(prisma));

  for (const seed of courses) {
    const { course, instructor, questions, sessions } = seed;
    const status = seedStatus(seed, env);
    const data = { ...course, ...jsonFields(seed), status } as Prisma.CourseCreateInput;

    const existing = await prisma.course.findUnique({ where: { slug: course.slug } });
    if (existing) {
      seeded.add(course.slug);
      if (!seed.placeholder && (await isUntouchedPlaceholder(prisma, existing, seed.supersedes))) {
        await refreshPlaceholder(prisma, existing.id, seed, data);
      } else {
        console.log(`Course kept as is: ${course.slug}`);
      }
      await applyRevisions(prisma, existing.id, course.slug, seed.revisions ?? []);
      if (seed.instructor) await applyInstructorRevisions(prisma, existing.id, seed.instructor.name, seed.instructorRevisions ?? []);
      continue;
    }
    if (seeded.has(course.slug)) {
      // Seeded before, then renamed or deleted by an admin: respect that.
      console.log(`Course not recreated (renamed or deleted since it was seeded): ${course.slug}`);
      continue;
    }

    const created = await prisma.course.create({ data });
    const inst = instructor ? await prisma.instructor.create({ data: instructor }) : null;
    // Course staff: the built-in roles, and the seeded instructor as the Main instructor.
    await prisma.$transaction((tx) => setCourseInstructors(tx, created.id, inst ? [inst.id] : []));
    if (questions.length) {
      await prisma.screeningQuestion.createMany({
        data: questions.map((q, order) => ({ ...q, order, courseId: created.id })) as Prisma.ScreeningQuestionCreateManyInput[],
      });
    }
    if (sessions.length) {
      await prisma.courseSession.createMany({
        data: sessions.map((s, i) => ({ ...s, order: i + 1, courseId: created.id })) as Prisma.CourseSessionCreateManyInput[],
      });
    }
    seeded.add(course.slug);
    console.log(`Course created: ${course.slug}`);
  }

  await prisma.setting.upsert({
    where: { key: SEEDED_KEY },
    update: { value: [...seeded] },
    create: { key: SEEDED_KEY, value: [...seeded] },
  });
}

async function readSeeded(prisma: PrismaClient): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: SEEDED_KEY } });
  return Array.isArray(row?.value) ? (row.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Placeholder seeds never go live by accident: drafts in production unless
 * SEED_PLACEHOLDER_STATUS says otherwise. Real seeds use their own status.
 */
function seedStatus(seed: SeedCourse, env: NodeJS.ProcessEnv): SeedCourse['course']['status'] {
  if (!seed.placeholder) return seed.course.status;
  const override = env.SEED_PLACEHOLDER_STATUS;
  if (override === 'OPEN' || override === 'DRAFT') return override;
  return env.NODE_ENV === 'production' ? 'DRAFT' : seed.course.status;
}

function jsonFields(seed: SeedCourse) {
  const c = seed.course;
  return {
    targetAudience: c.targetAudience,
    notFor: c.notFor,
    preparation: c.preparation,
    learningOutcomes: c.learningOutcomes,
    prerequisites: c.prerequisites,
    outline: c.outline,
    faq: c.faq,
    included: c.included,
  } as unknown as Record<string, Prisma.InputJsonValue>;
}

/**
 * True only for a course the seed created that no admin has touched since: placeholder text
 * (or, word for word, an earlier version of its seed listed in `supersedes`), every session
 * still a placeholder, and no admin action on the course or its sessions in the audit log
 * (every admin edit is audited).
 */
export async function isUntouchedPlaceholder(
  prisma: PrismaClient,
  c: { id: string; longDescriptionEn: string },
  supersedes: readonly string[] = [],
): Promise<boolean> {
  if (!c.longDescriptionEn.startsWith(PLACEHOLDER) && !supersedes.includes(c.longDescriptionEn))
    return false;
  const sessions = await prisma.courseSession.findMany({
    where: { courseId: c.id },
    select: { id: true, titleEn: true },
  });
  if (sessions.some((s) => !s.titleEn.startsWith(PLACEHOLDER))) return false;
  const edits = await prisma.auditLog.count({
    where: {
      actorId: { not: null },
      OR: [
        { entityType: 'Course', entityId: c.id },
        { entityType: 'CourseSession', entityId: { in: sessions.map((s) => s.id) } },
      ],
    },
  });
  return edits === 0;
}

/**
 * Replaces an untouched placeholder (or earlier seed version) with the current seed. Questions
 * are only replaced while nobody has applied, and sessions only while nobody has progress or
 * feedback. The waiting list (CourseInterest) belongs to the course and is kept.
 */
async function refreshPlaceholder(prisma: PrismaClient, courseId: string, seed: SeedCourse, data: Prisma.CourseCreateInput): Promise<void> {
  const kept: string[] = [];
  await prisma.$transaction(async (tx) => {
    // Serialise concurrent container starts on this course.
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
    const { slug: _slug, ...fields } = data;
    await tx.course.update({ where: { id: courseId }, data: fields as Prisma.CourseUpdateInput });

    // The Main instructor and Co-instructors with a profile (shown or not), in order.
    const links = (
      await tx.courseStaff.findMany({
        where: { courseId, instructorId: { not: null }, role: { builtin: { in: ['MAIN', 'CO'] } } },
        select: { instructorId: true, order: true, role: { select: { order: true } }, instructor: { select: { name: true } } },
      })
    ).sort((a, b) => a.role.order - b.role.order || a.order - b.order);
    // A course created before course staff existed (only CourseInstructor rows): read those.
    const legacy = links.length ? [] : await tx.courseInstructor.findMany({ where: { courseId }, orderBy: { order: 'asc' }, include: { instructor: { select: { name: true } } } });
    const all = [...links.map((l) => ({ instructorId: l.instructorId!, name: l.instructor!.name })), ...legacy.map((l) => ({ instructorId: l.instructorId, name: l.instructor.name }))];
    const placeholders = all.filter((x) => x.name.startsWith(PLACEHOLDER));
    const keep = all.filter((x) => !x.name.startsWith(PLACEHOLDER)).map((x) => x.instructorId);
    const added = seed.instructor && keep.length === 0 ? await tx.instructor.create({ data: seed.instructor }) : null;
    // Course staff (CourseInstructor follows): placeholders out, the seeded instructor in.
    await setCourseInstructors(tx, courseId, added ? [added.id] : keep);
    for (const l of placeholders) {
      if (!(await tx.courseInstructor.count({ where: { instructorId: l.instructorId } })) && !(await tx.courseStaff.count({ where: { instructorId: l.instructorId } }))) {
        await tx.instructor.delete({ where: { id: l.instructorId } });
      }
    }

    if ((await tx.application.count({ where: { courseId } })) === 0) {
      await tx.screeningQuestion.deleteMany({ where: { courseId } });
      if (seed.questions.length) {
        await tx.screeningQuestion.createMany({
          data: seed.questions.map((q, order) => ({ ...q, order, courseId })) as Prisma.ScreeningQuestionCreateManyInput[],
        });
      }
    } else {
      kept.push('questions (people have applied)');
    }

    const used =
      (await tx.sessionProgress.count({ where: { session: { courseId } } })) + (await tx.sessionFeedback.count({ where: { courseId } }));
    if (used === 0) {
      await tx.courseSession.deleteMany({ where: { courseId } });
      if (seed.sessions.length) {
        await tx.courseSession.createMany({
          data: seed.sessions.map((s, i) => ({ ...s, order: i + 1, courseId })) as Prisma.CourseSessionCreateManyInput[],
        });
      }
    } else {
      kept.push('sessions (students have progress or feedback)');
    }

    await tx.auditLog.create({
      data: { action: 'seed.course_replaced', entityType: 'Course', entityId: courseId, metadata: { slug: seed.course.slug, kept } },
    });
  });
  console.log(`Course replaced (untouched placeholder or earlier seed version): ${seed.course.slug}${kept.length ? `; kept ${kept.join(', ')}` : ''}`);
}

/** Same value, for the scalar and enum-list fields revisions compare. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** True when an admin has saved this record (every admin save is audited with the admin as actor). */
async function adminSaved(prisma: Prisma.TransactionClient, entityType: 'Course' | 'Instructor', id: string, actions: string[]): Promise<boolean> {
  return (await prisma.auditLog.count({ where: { actorId: { not: null }, entityType, entityId: id, action: { in: actions } } })) > 0;
}

/**
 * Brings a seeded course up to later versions of its seed, field by field. A revision is
 * applied only when the course still holds every one of its `from` values and no admin has
 * ever saved the course; otherwise it is left alone and logged (the owner makes that change in
 * the admin). Applied revisions are audited (actor: none). Idempotent: once applied, `from`
 * no longer matches.
 */
export async function applyRevisions(prisma: PrismaClient, courseId: string, slug: string, revisions: SeedRevision[]): Promise<string[]> {
  const applied: string[] = [];
  for (const r of revisions) {
    const result = await prisma.$transaction(async (tx) => {
      // Serialise concurrent container starts on this course.
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
      const c = await tx.course.findUnique({ where: { id: courseId } });
      if (!c || c.source !== null) return 'not seeded';
      const current = c as unknown as Record<string, unknown>;
      if (Object.entries(r.to).every(([k, v]) => same(current[k], v))) return 'already applied';
      if (!Object.entries(r.from).every(([k, v]) => same(current[k], v))) return 'changed since it was seeded';
      if (await adminSaved(tx, 'Course', courseId, ['course.created', 'course.updated'])) return 'edited by an admin';
      await tx.course.update({ where: { id: courseId }, data: r.to as Prisma.CourseUpdateInput });
      await tx.auditLog.create({ data: { action: 'seed.course_revised', entityType: 'Course', entityId: courseId, metadata: { slug, revision: r.name } } });
      return 'applied';
    });
    if (result === 'applied') {
      applied.push(r.name);
      console.log(`Course updated (${r.name}): ${slug}`);
    } else if (result !== 'already applied') {
      console.log(`Course update "${r.name}" not applied to ${slug}: ${result}. Make it in the admin if it still applies.`);
    }
  }
  return applied;
}

/** The same for the course's seeded instructor, found by its seeded name among the course's instructors. */
export async function applyInstructorRevisions(prisma: PrismaClient, courseId: string, name: string, revisions: SeedInstructorRevision[]): Promise<string[]> {
  const applied: string[] = [];
  for (const r of revisions) {
    const result = await prisma.$transaction(async (tx) => {
      const link = await tx.courseInstructor.findFirst({ where: { courseId, instructor: { name } }, include: { instructor: true } });
      const i = link?.instructor;
      if (!i || i.source !== null) return 'not found';
      const current = i as unknown as Record<string, unknown>;
      if (Object.entries(r.to).every(([k, v]) => same(current[k], v))) return 'already applied';
      if (!Object.entries(r.from).every(([k, v]) => same(current[k], v))) return 'changed since it was seeded';
      if (await adminSaved(tx, 'Instructor', i.id, ['instructor.created', 'instructor.updated'])) return 'edited by an admin';
      if (r.to.slug && (await tx.instructor.count({ where: { slug: r.to.slug, id: { not: i.id } } }))) return `the slug ${r.to.slug} is taken`;
      await tx.instructor.update({ where: { id: i.id }, data: r.to });
      await tx.auditLog.create({ data: { action: 'seed.instructor_revised', entityType: 'Instructor', entityId: i.id, metadata: { name, revision: r.name } } });
      return 'applied';
    });
    if (result === 'applied') {
      applied.push(r.name);
      console.log(`Instructor updated (${r.name}): ${name}`);
    } else if (result !== 'already applied') {
      console.log(`Instructor update "${r.name}" not applied to ${name}: ${result}. Make it in the admin if it still applies.`);
    }
  }
  return applied;
}
