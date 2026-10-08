import { PrismaClient } from '@prisma/client';
import { parseArchive, type Archive } from '../prisma/archive-schema';
import { importArchive, readArchive } from '../prisma/import-archive';

/** The archive import runs on every container start: it must be idempotent and never clobber admin work. */
describe('archive import (e2e)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  const run = Date.now().toString(36);
  const slug = (s: string) => `${s}-${run}`;
  const archive = (over: { title?: string; lessons?: number } = {}): Archive =>
    parseArchive([
      {
        name: 'test.json',
        data: {
          version: 1,
          speakers: [{ slug: slug('speaker'), name: 'Test Speaker', titleEn: 'Engineer', bioEn: 'Bio' }],
          sessions: [
            {
              slug: slug('past'),
              titleEn: over.title ?? 'Past talk',
              speaker: slug('speaker'),
              startsAt: '2026-08-22T20:00:00+03:00',
              durationMin: 90,
              topics: ['docker'],
              recordingUrl: 'https://www.youtube.com/watch?v=AFcoKDtyhec',
            },
            { slug: slug('upcoming'), titleEn: 'Future talk', startsAt: '2099-01-01T18:00:00Z' },
          ],
          courses: [
            {
              slug: slug('course'),
              titleEn: 'Past course',
              titleAr: 'دورة سابقة',
              shortDescriptionEn: 'A course that already ran.',
              shortDescriptionAr: 'دورة أُقيمت من قبل.',
              status: 'COMPLETED',
              cohortNumber: 1,
              startDate: '2026-08-15',
              endDate: '2026-10-02',
              instructors: [slug('speaker')],
              sessions: Array.from({ length: over.lessons ?? 2 }, (_, i) => ({
                titleEn: `Lesson ${i + 1}`,
                startsAt: new Date(Date.UTC(2026, 7, 16 + i * 7, 16)).toISOString(),
                recordingUrl: `https://www.youtube.com/watch?v=lesson${i + 1}xx`,
              })),
            },
          ],
        },
      },
    ]);
  const snapshot = async () => ({
    speaker: await prisma.instructor.findUniqueOrThrow({ where: { slug: slug('speaker') } }),
    past: await prisma.liveEvent.findUniqueOrThrow({ where: { slug: slug('past') } }),
    course: await prisma.course.findUniqueOrThrow({ where: { slug: slug('course') }, include: { sessions: true, instructors: true } }),
  });

  it('creates everything once, then changes nothing on a second run', async () => {
    const first = await importArchive(prisma, archive());
    expect(first.created.sort()).toEqual([`course:${slug('course')}`, `session:${slug('past')}`, `session:${slug('upcoming')}`, `speaker:${slug('speaker')}`]);
    const a = await snapshot();
    expect(a.past).toMatchObject({ status: 'PUBLISHED', source: 'import', speakerId: a.speaker.id, topics: ['docker'], liveUrl: null });
    expect(a.course).toMatchObject({ status: 'COMPLETED', publicRecordings: true, cohortNumber: 1, source: 'import' });
    expect(a.course.sessions).toHaveLength(2);
    expect(a.course.instructors.map((i) => i.instructorId)).toEqual([a.speaker.id]);
    // An upcoming session has no join link in the archive: it waits as a draft for an admin.
    expect((await prisma.liveEvent.findUniqueOrThrow({ where: { slug: slug('upcoming') } })).status).toBe('DRAFT');

    // Same files: nothing is even read.
    expect(await importArchive(prisma, archive())).toMatchObject({ created: [], updated: [], unchangedArchive: true });
    // Forced, every entry is checked and found unchanged.
    const second = await importArchive(prisma, archive(), { force: true });
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    const b = await snapshot();
    expect(b.past.updatedAt).toEqual(a.past.updatedAt);
    expect(b.speaker.updatedAt).toEqual(a.speaker.updatedAt);
    expect(b.course.updatedAt).toEqual(a.course.updatedAt);
    expect(b.course.sessions.map((s) => s.id).sort()).toEqual(a.course.sessions.map((s) => s.id).sort());
  });

  it('updates an untouched imported record when its entry changes', async () => {
    const report = await importArchive(prisma, archive({ title: 'Past talk (corrected)', lessons: 3 }));
    expect(report.updated.sort()).toEqual([`course:${slug('course')}`, `session:${slug('past')}`]);
    const s = await snapshot();
    expect(s.past.titleEn).toBe('Past talk (corrected)');
    expect(s.course.sessions).toHaveLength(3);
  });

  it('never auto-publishes an imported draft once its date has passed', async () => {
    const later = new Date('2099-06-01T00:00:00Z');
    const report = await importArchive(prisma, archive({ title: 'Past talk (corrected)', lessons: 3 }), { now: later, force: true });
    expect(report.updated).toEqual([]);
    expect((await prisma.liveEvent.findUniqueOrThrow({ where: { slug: slug('upcoming') } })).status).toBe('DRAFT');
  });

  it('holds back lesson changes on a course students have progress on', async () => {
    const { course } = await snapshot();
    const student = await prisma.user.create({ data: { email: `archive-st-${run}@example.test` } });
    await prisma.sessionProgress.create({ data: { userId: student.id, sessionId: course.sessions[0]!.id } });
    const report = await importArchive(prisma, archive({ title: 'Past talk (corrected)', lessons: 4 }), { force: true });
    expect(report.skipped).toContain(`course:${slug('course')}: its lessons changed, but students have progress on them: update it in the admin`);
    const after = await snapshot();
    expect(after.course.sessions).toHaveLength(3);
    expect(after.course.importHash).toBe(course.importHash);
    await prisma.sessionProgress.deleteMany({ where: { userId: student.id } });
  });

  it('never overwrites a record an admin has edited since', async () => {
    const { past, course } = await snapshot();
    // What every admin save does (see archive.e2e-spec.ts): edit, and clear importHash.
    await prisma.liveEvent.update({ where: { id: past.id }, data: { titleEn: 'Edited by an admin', importHash: null } });
    const lesson = course.sessions.find((x) => x.order === 1)!;
    await prisma.courseSession.update({ where: { id: lesson.id }, data: { recordingUrl: 'https://www.youtube.com/watch?v=adminpasted' } });
    await prisma.course.update({ where: { id: course.id }, data: { importHash: null } });

    const report = await importArchive(prisma, archive({ title: 'Another correction', lessons: 2 }), { force: true });
    expect(report.skipped).toEqual(
      expect.arrayContaining([`session:${slug('past')}: edited by an admin since it was imported`, `course:${slug('course')}: edited by an admin since it was imported`]),
    );
    const after = await snapshot();
    expect(after.past.titleEn).toBe('Edited by an admin');
    expect(after.course.sessions).toHaveLength(3);
    expect(after.course.sessions.find((x) => x.id === lesson.id)!.recordingUrl).toBe('https://www.youtube.com/watch?v=adminpasted');
  });

  it('does not recreate a record an admin deleted, nor touch one it did not create', async () => {
    await prisma.liveEvent.delete({ where: { slug: slug('upcoming') } });
    const mine = await prisma.liveEvent.create({
      data: { slug: slug('admin-made'), status: 'PUBLISHED', titleEn: 'Scheduled by an admin', startsAt: new Date('2099-02-01T18:00:00Z'), liveUrl: 'https://meet.google.com/abc' },
    });
    const data = archive();
    data.sessions.push({ ...data.sessions[1]!, slug: slug('admin-made'), titleEn: 'From the archive' });
    const report = await importArchive(prisma, data, { force: true });
    expect(report.created).toEqual([]);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        `session:${slug('upcoming')}: deleted or renamed by an admin since it was imported`,
        `session:${slug('admin-made')}: already exists (not created by the import)`,
      ]),
    );
    expect(await prisma.liveEvent.findUnique({ where: { slug: slug('upcoming') } })).toBeNull();
    expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: mine.id } })).titleEn).toBe('Scheduled by an admin');
  });

  it('imports the committed archive cleanly, twice', async () => {
    const committed = readArchive();
    await importArchive(prisma, committed, { force: true });
    const again = await importArchive(prisma, committed, { force: true });
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(await prisma.course.findUnique({ where: { slug: 'mlops-practitioner' } })).toMatchObject({ status: 'COMPLETED', source: 'import' });
  });
});
