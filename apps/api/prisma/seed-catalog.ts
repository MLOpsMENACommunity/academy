/* eslint-disable no-console */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SeedCourse } from './seed-data';

/** Setting row listing every slug the seed has ever created (not a user-facing setting). */
const SEEDED_KEY = '__seededCourses';
const PLACEHOLDER = '[PLACEHOLDER]';

/**
 * Creates the seed catalog. Safe to run on every start:
 * - a course is created once; if an admin later renames or deletes it, it is not recreated;
 * - questions, sessions and instructors are only added to a course that has none;
 * - a course still holding the old placeholder content, never touched by an admin, is
 *   replaced in place by the real seed (see `isUntouchedPlaceholder`).
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
      if (!seed.placeholder && (await isUntouchedPlaceholder(prisma, existing))) {
        await refreshPlaceholder(prisma, existing.id, seed, data);
      } else {
        console.log(`Course kept as is: ${course.slug}`);
      }
      continue;
    }
    if (seeded.has(course.slug)) {
      // Seeded before, then renamed or deleted by an admin: respect that.
      console.log(`Course not recreated (renamed or deleted since it was seeded): ${course.slug}`);
      continue;
    }

    const created = await prisma.course.create({ data });
    if (instructor) {
      const inst = await prisma.instructor.create({ data: instructor });
      await prisma.courseInstructor.create({ data: { courseId: created.id, instructorId: inst.id } });
    }
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
 * True only for a course created by the old placeholder seed that no admin has touched:
 * placeholder text, every session still a placeholder, and no admin action on the course
 * or its sessions in the audit log (every admin edit is audited).
 */
export async function isUntouchedPlaceholder(prisma: PrismaClient, c: { id: string; longDescriptionEn: string }): Promise<boolean> {
  if (!c.longDescriptionEn.startsWith(PLACEHOLDER)) return false;
  const sessions = await prisma.courseSession.findMany({ where: { courseId: c.id }, select: { id: true, titleEn: true } });
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
 * Replaces an untouched placeholder course with the real seed. Questions are only replaced
 * while nobody has applied, and sessions only while nobody has progress or feedback.
 */
async function refreshPlaceholder(prisma: PrismaClient, courseId: string, seed: SeedCourse, data: Prisma.CourseCreateInput): Promise<void> {
  const kept: string[] = [];
  await prisma.$transaction(async (tx) => {
    // Serialise concurrent container starts on this course.
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
    const { slug: _slug, ...fields } = data;
    await tx.course.update({ where: { id: courseId }, data: fields as Prisma.CourseUpdateInput });

    const links = await tx.courseInstructor.findMany({ where: { courseId }, include: { instructor: true } });
    for (const l of links.filter((x) => x.instructor.name.startsWith(PLACEHOLDER))) {
      await tx.courseInstructor.delete({ where: { courseId_instructorId: { courseId, instructorId: l.instructorId } } });
      if (!(await tx.courseInstructor.count({ where: { instructorId: l.instructorId } }))) {
        await tx.instructor.delete({ where: { id: l.instructorId } });
      }
    }
    if (seed.instructor && links.every((l) => l.instructor.name.startsWith(PLACEHOLDER))) {
      const inst = await tx.instructor.create({ data: seed.instructor });
      await tx.courseInstructor.create({ data: { courseId, instructorId: inst.id } });
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
  console.log(`Course replaced (was an untouched placeholder): ${seed.course.slug}${kept.length ? `; kept ${kept.join(', ')}` : ''}`);
}
