import { PrismaClient } from '@prisma/client';
import { isUntouchedPlaceholder, seedCatalog } from '../prisma/seed-catalog';
import type { SeedCourse } from '../prisma/seed-data';

/** The catalog seed runs on every container start, so it must never clobber admin work. */
describe('catalog seed (e2e)', () => {
  const prisma = new PrismaClient();
  const quiet = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  afterAll(async () => {
    quiet.mockRestore();
    await prisma.$disconnect();
  });

  const empty = { en: '', ar: '' };
  const seedFor = (slug: string): SeedCourse => ({
    course: {
      slug, titleEn: 'Real course', titleAr: 'دورة حقيقية', shortDescriptionEn: 'Real', shortDescriptionAr: 'حقيقية',
      longDescriptionEn: 'Real content', longDescriptionAr: 'محتوى حقيقي', type: 'FREE', price: 0, requiresApproval: true, status: 'OPEN',
      startDate: null, applicationDeadline: null,
      targetAudience: empty, notFor: empty, preparation: { en: 'Prep', ar: 'تحضير' }, learningOutcomes: { en: [], ar: [] },
      prerequisites: { en: [], ar: [] }, outline: [], faq: [],
      included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
    },
    instructor: { name: 'Real Instructor', titleEn: 'Engineer', bioEn: 'Bio' },
    questions: [{ type: 'SHORT_TEXT', labelEn: 'Why?', labelAr: 'لماذا؟', required: true }],
    sessions: [{ titleEn: 'Session 1', titleAr: 'الجلسة 1', startsAt: new Date('2026-10-18T16:00:00Z'), durationMin: 90 }],
  });

  async function placeholderCourse(slug: string) {
    return prisma.course.create({
      data: {
        slug, titleEn: 'Old', titleAr: 'قديم', shortDescriptionEn: 'x', shortDescriptionAr: 'x',
        longDescriptionEn: '[PLACEHOLDER] old text', longDescriptionAr: 'x', type: 'PAID', price: 0, status: 'OPEN',
        startDate: new Date('2026-11-01T00:00:00Z'), durationWeeks: 6, driveFolderUrl: 'https://drive.google.com/drive/folders/PLACEHOLDER',
        targetAudience: empty, notFor: empty, learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] }, outline: [], faq: [], included: {},
        instructors: { create: { order: 0, instructor: { create: { name: '[PLACEHOLDER] Someone', titleEn: 'x', bioEn: 'x' } } } },
        screeningQuestions: { create: { order: 0, type: 'YES_NO', labelEn: 'Old?', labelAr: 'قديم؟', required: true } },
        sessions: { create: { order: 1, titleEn: '[PLACEHOLDER] Old session', titleAr: 'x', startsAt: new Date() } },
      },
    });
  }

  it('replaces an untouched placeholder course, clearing its old fields, and is idempotent', async () => {
    const slug = `seed-refresh-${Date.now()}`;
    const old = await placeholderCourse(slug);
    const oldInstructor = await prisma.courseInstructor.findFirstOrThrow({ where: { courseId: old.id } });
    await seedCatalog(prisma, [seedFor(slug)]);
    const c = await prisma.course.findUniqueOrThrow({
      where: { id: old.id },
      include: { sessions: true, screeningQuestions: true, instructors: { include: { instructor: true } } },
    });
    expect(c).toMatchObject({ titleEn: 'Real course', longDescriptionEn: 'Real content', startDate: null, preparation: { en: 'Prep', ar: 'تحضير' } });
    expect(c.sessions.map((s) => s.titleEn)).toEqual(['Session 1']);
    expect(c.screeningQuestions.map((q) => q.labelEn)).toEqual(['Why?']);
    expect(c.instructors.map((i) => i.instructor.name)).toEqual(['Real Instructor']);
    expect(await prisma.instructor.findUnique({ where: { id: oldInstructor.instructorId } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: old.id, action: 'seed.course_replaced' } })).toBe(1);

    await seedCatalog(prisma, [seedFor(slug)]);
    expect(await prisma.courseSession.count({ where: { courseId: old.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: old.id, action: 'seed.course_replaced' } })).toBe(1);
  });

  it('leaves a placeholder course alone once an admin has edited it', async () => {
    const slug = `seed-touched-${Date.now()}`;
    const old = await placeholderCourse(slug);
    const admin = await prisma.user.create({ data: { email: `${slug}@example.test`, role: 'ADMIN' } });
    await prisma.auditLog.create({ data: { actorId: admin.id, action: 'course.updated', entityType: 'Course', entityId: old.id } });
    expect(await isUntouchedPlaceholder(prisma, old)).toBe(false);
    await seedCatalog(prisma, [seedFor(slug)]);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: old.id } })).titleEn).toBe('Old');
  });

  it('leaves it alone when a session was edited to real content', async () => {
    const slug = `seed-session-${Date.now()}`;
    const old = await placeholderCourse(slug);
    await prisma.courseSession.updateMany({ where: { courseId: old.id }, data: { titleEn: 'Real session title' } });
    await seedCatalog(prisma, [seedFor(slug)]);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: old.id } })).titleEn).toBe('Old');
  });

  it('creates a seed course once, and does not recreate it after a rename', async () => {
    const slug = `seed-once-${Date.now()}`;
    await seedCatalog(prisma, [seedFor(slug)]);
    const created = await prisma.course.findUniqueOrThrow({ where: { slug }, include: { _count: { select: { sessions: true } } } });
    expect(created._count.sessions).toBe(1);
    await prisma.course.update({ where: { id: created.id }, data: { slug: `${slug}-renamed` } });
    await seedCatalog(prisma, [seedFor(slug)]);
    expect(await prisma.course.findUnique({ where: { slug } })).toBeNull();
  });
});
