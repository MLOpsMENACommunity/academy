import { PrismaClient } from '@prisma/client';
import { isUntouchedPlaceholder, seedCatalog } from '../prisma/seed-catalog';
import { seedCourses, type SeedCourse } from '../prisma/seed-data';

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

  // The Kubernetes course was seeded as "coming soon" text; the owner's content replaces it on
  // staging and production through `supersedes`, unless an admin has edited the course.
  describe('a course still holding an earlier seed version', () => {
    const k8s = seedCourses.find((x) => x.course.slug === 'kubernetes')!;
    const earlier = k8s.supersedes![0]!;
    const k8sAt = (slug: string): SeedCourse => ({ ...k8s, course: { ...k8s.course, slug } });
    async function earlierCourse(slug: string) {
      return prisma.course.create({
        data: {
          slug,
          titleEn: 'Kubernetes for AI',
          titleAr: 'Kubernetes للذكاء الاصطناعي',
          shortDescriptionEn: 'Run AI on Kubernetes. Details soon.',
          shortDescriptionAr: 'قريبًا',
          longDescriptionEn: earlier,
          longDescriptionAr: 'ستنطلق هذه الدورة قريبًا.',
          type: 'PAID',
          price: 0,
          status: 'COMING_SOON',
          targetAudience: { en: 'ML engineers', ar: 'مهندسو تعلم الآلة' },
          notFor: empty,
          learningOutcomes: { en: [], ar: [] },
          prerequisites: { en: [], ar: [] },
          outline: [],
          faq: [],
          included: {
            liveSessions: true,
            recordings: true,
            assignments: false,
            finalProject: false,
            certificate: false,
          },
          interests: { create: { email: `${slug}@example.test` } },
        },
      });
    }

    it('is updated in place to the current seed, keeping its waiting list, once', async () => {
      const slug = `seed-k8s-${Date.now()}`;
      const old = await earlierCourse(slug);
      await seedCatalog(prisma, [k8sAt(slug)]);
      const c = await prisma.course.findUniqueOrThrow({
        where: { id: old.id },
        include: { _count: { select: { interests: true } } },
      });
      expect(c).toMatchObject({
        titleEn: k8s.course.titleEn,
        status: 'COMING_SOON',
        type: 'PAID',
        price: 0,
        startDate: null,
        durationWeeks: null,
      });
      expect((c.outline as unknown[]).length).toBe(23);
      expect(c._count.interests).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: old.id, action: 'seed.course_replaced' },
        }),
      ).toBe(1);

      await seedCatalog(prisma, [k8sAt(slug)]);
      expect(
        await prisma.auditLog.count({
          where: { entityId: old.id, action: 'seed.course_replaced' },
        }),
      ).toBe(1);
    });

    it('is left alone once an admin has edited it', async () => {
      const slug = `seed-k8s-edited-${Date.now()}`;
      const old = await earlierCourse(slug);
      const admin = await prisma.user.create({
        data: { email: `${slug}-admin@example.test`, role: 'ADMIN' },
      });
      await prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'course.updated',
          entityType: 'Course',
          entityId: old.id,
        },
      });
      await seedCatalog(prisma, [k8sAt(slug)]);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: old.id } })).titleEn).toBe(
        'Kubernetes for AI',
      );
    });

    it('is left alone when its text differs from every earlier version', async () => {
      const slug = `seed-k8s-other-${Date.now()}`;
      const old = await earlierCourse(slug);
      await prisma.course.update({
        where: { id: old.id },
        data: { longDescriptionEn: `${earlier}\n\nEdited.` },
      });
      await seedCatalog(prisma, [k8sAt(slug)]);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: old.id } })).titleEn).toBe(
        'Kubernetes for AI',
      );
    });
  });

  // Owner (10 Oct 2026): AI Architecture Design is for Mid → Senior and Senior → Lead, in Arabic,
  // and Eng. Sameh gets his LinkedIn. Field-level revisions reach a course seeded before that.
  describe('a seeded course still holding the values of an earlier seed version', () => {
    const ai = seedCourses.find((x) => x.course.slug === 'ai-architecture-design')!;
    const at = (slug: string): SeedCourse => ({
      ...ai,
      course: { ...ai.course, slug },
      instructor: { ...ai.instructor!, slug: `${slug}-sameh` },
      instructorRevisions: ai.instructorRevisions!.map((r) => ({ ...r, to: { ...r.to, slug: `${slug}-sameh` } })),
    });
    /** The course as the first AI Architecture seed left it (after the levels migration). */
    async function seededBefore(slug: string) {
      return prisma.course.create({
        data: {
          slug, titleEn: ai.course.titleEn, titleAr: ai.course.titleAr, shortDescriptionEn: 'x', shortDescriptionAr: 'x',
          longDescriptionEn: ai.course.longDescriptionEn, longDescriptionAr: 'x', type: 'FREE', price: 0, status: 'OPEN',
          level: 'ADVANCED', levels: ['SENIOR'], language: 'BILINGUAL',
          targetAudience: empty, notFor: empty, learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] }, outline: [], faq: [], included: {},
          instructors: { create: { order: 0, instructor: { create: { name: ai.instructor!.name, titleEn: 'Head of AI', bioEn: 'Bio' } } } },
          sessions: { create: { order: 1, titleEn: 'Session 1: Real', titleAr: 'x', startsAt: new Date('2026-10-18T16:00:00Z') } },
        },
        include: { instructors: true },
      });
    }

    it('gets the new levels, language and LinkedIn once, and nothing else changes', async () => {
      const slug = `seed-revise-${Date.now()}`;
      const old = await seededBefore(slug);
      await seedCatalog(prisma, [at(slug)]);
      const c = await prisma.course.findUniqueOrThrow({ where: { id: old.id }, include: { instructors: { include: { instructor: true } }, sessions: true } });
      expect(c).toMatchObject({ levels: ['MID', 'SENIOR'], levelProgression: true, level: 'INTERMEDIATE', language: 'AR', shortDescriptionEn: 'x' });
      expect(c.sessions.map((x) => x.titleEn)).toEqual(['Session 1: Real']);
      expect(c.instructors[0]!.instructor).toMatchObject({ slug: `${slug}-sameh`, linkedinUrl: 'https://www.linkedin.com/in/sameh-amin', titleEn: 'Head of AI' });
      const audits = () => prisma.auditLog.count({ where: { action: { in: ['seed.course_revised', 'seed.instructor_revised'] }, entityId: { in: [old.id, c.instructors[0]!.instructorId] } } });
      expect(await audits()).toBe(2);

      await seedCatalog(prisma, [at(slug)]);
      expect(await audits()).toBe(2);
    });

    it('is left alone once an admin has saved the course or the instructor', async () => {
      const slug = `seed-revise-admin-${Date.now()}`;
      const old = await seededBefore(slug);
      const admin = await prisma.user.create({ data: { email: `${slug}-admin@example.test`, role: 'ADMIN' } });
      await prisma.auditLog.createMany({
        data: [
          { actorId: admin.id, action: 'course.updated', entityType: 'Course', entityId: old.id },
          { actorId: admin.id, action: 'instructor.updated', entityType: 'Instructor', entityId: old.instructors[0]!.instructorId },
        ],
      });
      await seedCatalog(prisma, [at(slug)]);
      const c = await prisma.course.findUniqueOrThrow({ where: { id: old.id }, include: { instructors: { include: { instructor: true } } } });
      expect(c).toMatchObject({ levels: ['SENIOR'], level: 'ADVANCED', language: 'BILINGUAL' });
      expect(c.instructors[0]!.instructor).toMatchObject({ slug: null, linkedinUrl: null });
    });

    it('is left alone when a field no longer holds the earlier value', async () => {
      const slug = `seed-revise-changed-${Date.now()}`;
      const old = await seededBefore(slug);
      await prisma.course.update({ where: { id: old.id }, data: { language: 'EN' } });
      await seedCatalog(prisma, [at(slug)]);
      expect(await prisma.course.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ levels: ['SENIOR'], language: 'EN' });
    });

    it('a fresh database gets the current values straight away', async () => {
      const slug = `seed-fresh-${Date.now()}`;
      await seedCatalog(prisma, [at(slug)]);
      const c = await prisma.course.findUniqueOrThrow({ where: { slug }, include: { instructors: { include: { instructor: true } } } });
      expect(c).toMatchObject({ levels: ['MID', 'SENIOR'], levelProgression: true, language: 'AR' });
      expect(c.instructors[0]!.instructor.linkedinUrl).toBe('https://www.linkedin.com/in/sameh-amin');
      expect(await prisma.auditLog.count({ where: { action: 'seed.course_revised', entityId: c.id } })).toBe(0);
    });
  });
});

