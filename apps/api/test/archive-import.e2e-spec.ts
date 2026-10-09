import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  // The owner's past sessions: new ones are added, existing entries corrected, hosts and guests linked.
  it("brings in the owner's past sessions with their hosts and guests, idempotently", async () => {
    const committed = readArchive();
    await importArchive(prisma, committed, { force: true });
    const llm = await prisma.liveEvent.findUnique({
      where: { slug: 'introduction-to-llm-inference-engines' },
      include: { speaker: true, coSpeakers: { include: { instructor: true }, orderBy: { order: 'asc' } } },
    });
    // Only checked where the import owns the row (an earlier run of this suite may have created it).
    if (llm?.source === 'import' && llm.importHash) {
      expect(llm).toMatchObject({ status: 'PUBLISHED', durationMin: 90, recordingUrl: null });
      expect(llm.startsAt.toISOString()).toBe('2026-10-08T17:00:00.000Z');
      expect(llm.speaker?.slug).toBe('mohamed-rashad');
      expect(llm.coSpeakers.map((c) => [c.instructor.slug, c.role])).toEqual([['aya-nasser-salama', 'HOST']]);
    }
    const fastapi = await prisma.liveEvent.findUniqueOrThrow({ where: { slug: 'hands-on-fastapi-backend-for-mlops' } });
    if (fastapi.importHash) expect(fastapi.startsAt.toISOString()).toBe('2026-09-12T16:00:00.000Z');

    const before = await prisma.liveEventSpeaker.findMany({ orderBy: [{ eventId: 'asc' }, { order: 'asc' }] });
    const again = await importArchive(prisma, committed, { force: true });
    expect(again.updated).toEqual([]);
    expect(await prisma.liveEventSpeaker.findMany({ orderBy: [{ eventId: 'asc' }, { order: 'asc' }] })).toEqual(before);
    expect(JSON.stringify(await prisma.liveEvent.findMany({ where: { source: 'import' } }))).not.toContain('zomra');
  });

  it('replaces hosts and guests when an entry changes, and leaves an admin-edited session alone', async () => {
    const withHost = (role: 'HOST' | 'GUEST', title = 'Hosted talk') =>
      parseArchive([
        {
          name: 'co.json',
          data: {
            version: 1,
            speakers: [
              { slug: slug('main'), name: 'Main Speaker', titleEn: 'Engineer' },
              { slug: slug('host'), name: 'The Host', nameAr: 'المضيف' },
            ],
            sessions: [
              {
                slug: slug('hosted'),
                titleEn: title,
                speaker: slug('main'),
                // The main speaker listed again is ignored; they are the speaker already.
                coSpeakers: [{ speaker: slug('host'), role }, { speaker: slug('main'), role: 'GUEST' }],
                startsAt: '2026-08-29T19:00:00+03:00',
              },
            ],
          },
        },
      ]);
    await importArchive(prisma, withHost('HOST'));
    const event = await prisma.liveEvent.findUniqueOrThrow({ where: { slug: slug('hosted') }, include: { coSpeakers: { include: { instructor: true } } } });
    expect(event.coSpeakers.map((c) => [c.instructor.slug, c.role])).toEqual([[slug('host'), 'HOST']]);
    expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: slug('host') } })).toMatchObject({ titleEn: '', nameAr: 'المضيف' });

    expect((await importArchive(prisma, withHost('GUEST'))).updated).toEqual([`session:${slug('hosted')}`]);
    expect((await prisma.liveEventSpeaker.findMany({ where: { eventId: event.id } })).map((c) => c.role)).toEqual(['GUEST']);

    // An admin takes the session over: the import no longer changes its people.
    await prisma.liveEvent.update({ where: { id: event.id }, data: { importHash: null } });
    await prisma.liveEventSpeaker.deleteMany({ where: { eventId: event.id } });
    const report = await importArchive(prisma, withHost('HOST', 'Hosted talk, renamed'));
    expect(report.skipped).toContain(`session:${slug('hosted')}: edited by an admin since it was imported`);
    expect(await prisma.liveEventSpeaker.count({ where: { eventId: event.id } })).toBe(0);
  });

  // Owner (10 Oct 2026): the Practitioner's weeks, language and levels, speakers' LinkedIn, Omar
  // Khalil, and recording categories reach a database imported from the previous archive.
  describe('upgrading from the previous archive version', () => {
    /** The committed archive as it was before these changes. */
    function previousArchive(): Archive {
      const a = structuredClone(readArchive());
      const course = a.courses.find((c) => c.slug === 'mlops-practitioner')!;
      Object.assign(course, { durationWeeks: 6, language: 'BILINGUAL', level: 'INTERMEDIATE' });
      delete course.levels;
      for (const s of a.sessions) delete s.category;
      const redis = a.sessions.find((s) => s.slug === 'redis-for-semantic-caching')!;
      delete redis.speaker;
      Object.assign(redis, { speakerName: 'Omar Khalil', speakerNameAr: 'عمر خليل', speakerLinkedinUrl: 'https://www.linkedin.com/in/omar-khalil-10om01/' });
      a.speakers = a.speakers.filter((s) => s.slug !== 'omar-khalil');
      for (const s of a.speakers) if (['mohamed-rashad', 'mahmoud-sharif', 'abdallah-almalawany'].includes(s.slug)) delete s.linkedinUrl;
      // Before the owner's photos and bios, and while Mariam Qotob was a guest speaker.
      for (const s of a.speakers) if (s.slug !== 'aya-nasser-salama') Object.assign(s, { photoUrl: undefined });
      Object.assign(a.speakers.find((s) => s.slug === 'mohamed-samy')!, { titleEn: '', bioEn: '', titleAr: undefined, bioAr: undefined });
      a.speakers.find((s) => s.slug === 'abdallah-almalawany')!.name = 'Abdallah Almalawany';
      a.speakers.push({ slug: 'mariam-qotob', name: 'Mariam Qotob', titleEn: 'AI Engineer', bioEn: 'AI/ML engineer.', linkedinUrl: 'https://www.linkedin.com/in/mariamqotob/' });
      for (const slugOf of ['docker-deep-dive', 'hands-on-fastapi-backend-for-mlops']) a.sessions.find((s) => s.slug === slugOf)!.coSpeakers.push({ speaker: 'mariam-qotob', role: 'GUEST' });
      a.removedSpeakers = [];
      return a;
    }
    /** The category backfill of the migration (prisma/migrations/*_course_levels_event_categories). */
    async function runCategoryBackfill() {
      const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261015090000_course_levels_event_categories', 'migration.sql'), 'utf8');
      const statements = sql.split(';').map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter((x) => x.startsWith('UPDATE "LiveEvent"'));
      expect(statements).toHaveLength(2);
      for (const st of statements) await prisma.$executeRawUnsafe(st);
    }

    it('updates what the import still owns, and the migration categorises what an admin edited', async () => {
      // Production before this change: the previous archive, one session edited by an admin.
      await importArchive(prisma, previousArchive(), { force: true });
      await prisma.liveEvent.updateMany({ where: { source: 'import' }, data: { category: null } });
      const docker = await prisma.liveEvent.findUniqueOrThrow({ where: { slug: 'docker-deep-dive' } });
      await prisma.liveEvent.update({ where: { id: docker.id }, data: { titleEn: 'Docker (edited)', importHash: null } });

      await runCategoryBackfill();
      await importArchive(prisma, readArchive());

      const practitioner = await prisma.course.findUniqueOrThrow({ where: { slug: 'mlops-practitioner' } });
      if (practitioner.importHash) {
        expect(practitioner).toMatchObject({ durationWeeks: 5, language: 'AR', levels: ['JUNIOR', 'MID'], level: 'INTERMEDIATE' });
      }
      const redis = await prisma.liveEvent.findUniqueOrThrow({ where: { slug: 'redis-for-semantic-caching' }, include: { speaker: true } });
      expect(redis).toMatchObject({ category: 'HANDS_ON', speakerName: '', speakerLinkedinUrl: null });
      expect(redis.speaker).toMatchObject({ slug: 'omar-khalil', linkedinUrl: 'https://www.linkedin.com/in/omar-khalil-10om01', titleEn: 'AI Engineer' });
      expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: 'mohamed-rashad' } })).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/rashaddism' });
      expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: 'aya-nasser-salama' } })).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/ayanasser/' });
      expect(await prisma.liveEvent.findUniqueOrThrow({ where: { slug: 'on-prem-mlops-playbook' } })).toMatchObject({ category: 'INDUSTRY' });
      // The admin's session: its edits kept, its category from the migration.
      expect(await prisma.liveEvent.findUniqueOrThrow({ where: { id: docker.id } })).toMatchObject({ titleEn: 'Docker (edited)', category: 'HANDS_ON', importHash: null });

      // Photos, bios and the corrected name.
      expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: 'abdallah-almalawany' } })).toMatchObject({ name: 'Abdallah Elmalawany', photoUrl: '/speakers/abdallah-almalawany.webp', titleEn: 'DevOps Engineer · CKA' });
      expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: 'omar-khalil' } })).toMatchObject({ photoUrl: '/speakers/omar-khalil.webp', titleEn: 'AI Engineer' });
      // Mohamed Samy: photo, title, bio and LinkedIn.
      expect(await prisma.instructor.findUniqueOrThrow({ where: { slug: 'mohamed-samy' } })).toMatchObject({
        photoUrl: '/speakers/mohamed-samy.webp',
        titleEn: 'AI Engineer & Data Scientist',
        nameAr: 'محمد سامي',
        linkedinUrl: 'https://www.linkedin.com/in/mohamed-samy-122137189',
      });
      // Mariam: dropped from the FastAPI session the import owns, but still a guest on the Docker
      // session an admin edited, so her record stays (and the import says why).
      const mariam = await prisma.instructor.findUniqueOrThrow({ where: { slug: 'mariam-qotob' }, include: { coSpeaking: { include: { event: true } } } });
      expect(mariam.coSpeaking.map((c) => c.event.slug)).toEqual(['docker-deep-dive']);
      // Once the admin removes her from that session too, the next import deletes her.
      await prisma.liveEventSpeaker.deleteMany({ where: { instructorId: mariam.id } });
      const removal = await importArchive(prisma, readArchive(), { force: true });
      expect(removal.removed).toEqual(['speaker:mariam-qotob']);
      expect(await prisma.instructor.findUnique({ where: { slug: 'mariam-qotob' } })).toBeNull();

      // Idempotent: a second import and a second backfill change nothing.
      const again = await importArchive(prisma, readArchive(), { force: true });
      expect(again.created).toEqual([]);
      expect(again.updated).toEqual([]);
      await prisma.liveEvent.update({ where: { id: docker.id }, data: { category: 'TALK' } });
      await runCategoryBackfill();
      expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: docker.id } })).category).toBe('TALK');
    });
  });
});

