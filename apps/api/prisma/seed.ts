/* eslint-disable no-console */
import '../src/load-env';
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_SETTINGS } from '@academy/shared';
import { seedCourses, type SeedCourse } from './seed-data';

/**
 * Idempotent: safe to run repeatedly. Courses are created by slug when missing;
 * their questions and sessions are only created when the course has none, so
 * admin edits are never overwritten. The one exception: a course still holding
 * the old untouched placeholder content is replaced by the real seed.
 */
const prisma = new PrismaClient();

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping admin user');
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Never promote an existing account: someone could have registered the admin email first.
    if (existing.role !== 'ADMIN') {
      console.warn(`WARNING: ${email} exists but is not an admin; NOT promoting it. Resolve manually.`);
    }
    return;
  }
  const passwordHash = await hash(password);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      profile: { create: { fullNameEn: 'Academy Admin' } },
    },
  });
  console.log(`Admin ready: ${email}`);
}

async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }
}

/** Courses created from the old placeholder seed and never edited still start with this. */
const isUntouchedPlaceholder = (c: { longDescriptionEn: string }) => c.longDescriptionEn.startsWith('[PLACEHOLDER]');

async function seedCatalog(): Promise<void> {
  for (const seed of seedCourses) {
    const { course, instructor, questions, sessions } = seed;
    const json = {
      targetAudience: course.targetAudience,
      notFor: course.notFor,
      preparation: course.preparation,
      learningOutcomes: course.learningOutcomes,
      prerequisites: course.prerequisites,
      outline: course.outline,
      faq: course.faq,
      included: course.included,
    } as unknown as Prisma.CourseCreateInput;

    // Placeholder courses must not go live by accident: in production they start as drafts,
    // unless SEED_PLACEHOLDER_STATUS says otherwise (e.g. OPEN on a staging deployment).
    const override = process.env.SEED_PLACEHOLDER_STATUS;
    const status = !seed.placeholder
      ? course.status
      : override === 'OPEN' || override === 'DRAFT'
        ? override
        : process.env.NODE_ENV === 'production'
          ? 'DRAFT'
          : course.status;

    const existing = await prisma.course.findUnique({ where: { slug: course.slug } });
    if (existing && isUntouchedPlaceholder(existing) && !seed.placeholder) {
      await refreshPlaceholder(existing.id, seed, { ...course, ...json, status });
      console.log(`Course replaced (was an untouched placeholder): ${course.slug}`);
      continue;
    }

    const saved = await prisma.course.upsert({
      where: { slug: course.slug },
      update: {},
      create: { ...course, ...json, status },
      include: { _count: { select: { instructors: true, screeningQuestions: true, sessions: true } } },
    });

    if (instructor && saved._count.instructors === 0) {
      const inst = await prisma.instructor.create({ data: instructor });
      await prisma.courseInstructor.create({ data: { courseId: saved.id, instructorId: inst.id } });
    }
    if (questions.length && saved._count.screeningQuestions === 0) {
      await prisma.screeningQuestion.createMany({
        data: questions.map((q, order) => ({ ...q, order, courseId: saved.id })) as Prisma.ScreeningQuestionCreateManyInput[],
      });
    }
    if (sessions.length && saved._count.sessions === 0) {
      await prisma.courseSession.createMany({
        data: sessions.map((s, i) => ({ ...s, order: i + 1, courseId: saved.id })) as Prisma.CourseSessionCreateManyInput[],
      });
    }
    console.log(`Course ready: ${course.slug}`);
  }
}

/**
 * Replaces a course still holding the old placeholder seed content (never edited in the
 * admin panel) with the real seed. Questions are only replaced while nobody has applied,
 * and sessions only while no student has progress or feedback on them.
 */
async function refreshPlaceholder(courseId: string, seed: SeedCourse, data: Prisma.CourseUpdateInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { slug: _slug, ...fields } = data as Prisma.CourseUpdateInput & { slug?: string };
    await tx.course.update({ where: { id: courseId }, data: fields });

    // Instructors: drop placeholder ones, add the real one.
    const links = await tx.courseInstructor.findMany({ where: { courseId }, include: { instructor: true } });
    for (const l of links.filter((x) => x.instructor.name.startsWith('[PLACEHOLDER]'))) {
      await tx.courseInstructor.delete({ where: { courseId_instructorId: { courseId, instructorId: l.instructorId } } });
      const stillUsed = await tx.courseInstructor.count({ where: { instructorId: l.instructorId } });
      if (!stillUsed) await tx.instructor.delete({ where: { id: l.instructorId } });
    }
    if (seed.instructor && links.every((l) => l.instructor.name.startsWith('[PLACEHOLDER]'))) {
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
    }

    const used =
      (await tx.sessionProgress.count({ where: { session: { courseId } } })) +
      (await tx.sessionFeedback.count({ where: { courseId } }));
    if (used === 0) {
      await tx.courseSession.deleteMany({ where: { courseId } });
      if (seed.sessions.length) {
        await tx.courseSession.createMany({
          data: seed.sessions.map((s, i) => ({ ...s, order: i + 1, courseId })) as Prisma.CourseSessionCreateManyInput[],
        });
      }
    }
  });
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedSettings();
  await seedCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
