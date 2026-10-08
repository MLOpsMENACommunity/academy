/* eslint-disable no-console */
import '../src/load-env';
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_SETTINGS } from '@academy/shared';
import { seedCourses } from './seed-data';

/**
 * Idempotent: safe to run repeatedly. Courses are upserted by slug; their
 * questions and sessions are only created when the course has none, so admin
 * edits are never overwritten.
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

async function seedCatalog(): Promise<void> {
  for (const { course, instructor, questions, sessions } of seedCourses) {
    const json = {
      targetAudience: course.targetAudience,
      notFor: course.notFor,
      learningOutcomes: course.learningOutcomes,
      prerequisites: course.prerequisites,
      outline: course.outline,
      faq: course.faq,
      included: course.included,
    } as unknown as Prisma.CourseCreateInput;

    // Placeholder courses must not go live by accident: in production they start as drafts,
    // unless SEED_PLACEHOLDER_STATUS says otherwise (e.g. OPEN on a staging deployment).
    const override = process.env.SEED_PLACEHOLDER_STATUS;
    const status =
      override === 'OPEN' || override === 'DRAFT' ? override : process.env.NODE_ENV === 'production' ? 'DRAFT' : course.status;
    const saved = await prisma.course.upsert({
      where: { slug: course.slug },
      update: {},
      create: { ...course, ...json, status },
      include: { _count: { select: { instructors: true, screeningQuestions: true, sessions: true } } },
    });

    if (saved._count.instructors === 0) {
      const inst = await prisma.instructor.create({ data: instructor });
      await prisma.courseInstructor.create({ data: { courseId: saved.id, instructorId: inst.id } });
    }
    if (saved._count.screeningQuestions === 0) {
      await prisma.screeningQuestion.createMany({
        data: questions.map((q, order) => ({ ...q, order, courseId: saved.id })) as Prisma.ScreeningQuestionCreateManyInput[],
      });
    }
    if (saved._count.sessions === 0) {
      await prisma.courseSession.createMany({
        data: sessions.map((s, i) => ({ ...s, order: i + 1, courseId: saved.id })) as Prisma.CourseSessionCreateManyInput[],
      });
    }
    console.log(`Course ready: ${course.slug}`);
  }
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
