import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

describe('recordings library and speaker pages (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  const http = () => request(app.getHttpServer());
  const run = Date.now().toString(36);
  // A tag unique to this run, so other tests' data can't change the counts.
  const tag = `t${run}`;
  const days = (n: number) => new Date(Date.now() + n * 86_400_000);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'arc-admin' });

    const speaker = await prisma.instructor.create({
      data: { slug: `speaker-${run}`, name: `Speaker ${run}`, titleEn: 'Engineer', bioEn: 'Builds things.', githubUrl: 'https://github.com/x' },
    });
    const event = (slug: string, over: Record<string, unknown> = {}) =>
      prisma.liveEvent.create({
        data: {
          slug: `${slug}-${run}`,
          status: 'PUBLISHED',
          titleEn: `${slug} talk ${run}`,
          titleAr: 'محاضرة',
          startsAt: days(-10),
          durationMin: 60,
          recordingUrl: `https://www.youtube.com/watch?v=${slug}`,
          topics: [tag],
          ...over,
        },
      });
    await event('older', { startsAt: days(-20), speakerId: speaker.id, topics: [tag, 'docker'] });
    await event('newer', { startsAt: days(-5), speakerName: 'Guest Person' });
    await event('draft', { status: 'DRAFT' });
    await event('norec', { recordingUrl: null });
    await event('soon', { startsAt: days(3), speakerId: speaker.id });

    const course = (slug: string, publicRecordings: boolean) =>
      prisma.course.create({
        data: {
          slug: `${slug}-${run}`,
          titleEn: `${slug} course`,
          titleAr: 'دورة',
          shortDescriptionEn: 'x',
          shortDescriptionAr: 'x',
          longDescriptionEn: '',
          longDescriptionAr: '',
          type: 'FREE',
          status: 'COMPLETED',
          publicRecordings,
          cohortNumber: 1,
          targetAudience: { en: '', ar: '' },
          notFor: { en: '', ar: '' },
          learningOutcomes: { en: [], ar: [] },
          prerequisites: { en: [], ar: [] },
          outline: [],
          faq: [],
          included: {},
          instructors: { create: { instructorId: speaker.id } },
          sessions: {
            create: [
              { order: 1, titleEn: `${slug} lesson 1`, titleAr: 'درس', startsAt: days(-8), recordingUrl: `https://www.youtube.com/watch?v=${slug}PRIVATE`, topics: [tag] },
            ],
          },
        },
      });
    await course('public', true);
    await course('private', false);
  });
  afterAll(() => app.close());

  it('lists past sessions and public course lessons with a recording, newest first', async () => {
    const res = await http().get(`/api/recordings?topic=${tag}`).expect(200);
    const ids = (res.body.items as { id: string }[]).map((i) => i.id);
    expect(ids).toEqual([`event:newer-${run}`, `course:public-${run}:1`, `event:older-${run}`]);
    // Drafts, sessions without a recording, upcoming ones and private course recordings never show.
    expect(JSON.stringify(res.body)).not.toMatch(/draft-|norec-|soon-|privatePRIVATE/);
    const older = res.body.items.find((i: { id: string }) => i.id === `event:older-${run}`);
    expect(older).toMatchObject({ path: `/sessions/older-${run}`, youtubeId: 'older', speakers: [{ slug: `speaker-${run}`, name: `Speaker ${run}` }] });
    const lesson = res.body.items.find((i: { id: string }) => i.id === `course:public-${run}:1`);
    expect(lesson).toMatchObject({ path: `/courses/public-${run}`, course: { slug: `public-${run}`, order: 1 }, speakers: [{ slug: `speaker-${run}` }] });
    expect(res.body.items.find((i: { id: string }) => i.id === `event:newer-${run}`).speakers).toEqual([expect.objectContaining({ slug: null, name: 'Guest Person' })]);
    expect(res.body.topics).toEqual(expect.arrayContaining([{ tag, count: 3 }]));
  });

  it('filters by topic and by text', async () => {
    const docker = await http().get(`/api/recordings?topic=docker&q=${run}`).expect(200);
    expect(docker.body.items.map((i: { id: string }) => i.id)).toEqual([`event:older-${run}`]);
    const bySpeaker = await http().get(`/api/recordings?topic=${tag}&q=guest%20person`).expect(200);
    expect(bySpeaker.body.items.map((i: { id: string }) => i.id)).toEqual([`event:newer-${run}`]);
    const byCourse = await http().get(`/api/recordings?topic=${tag}&q=public%20course`).expect(200);
    expect(byCourse.body.items.map((i: { id: string }) => i.id)).toEqual([`course:public-${run}:1`]);
    await http().get('/api/recordings?topic=Not%20A%20Tag!').expect(400);
  });

  it('serves a speaker page with their sessions and courses', async () => {
    const res = await http().get(`/api/speakers/speaker-${run}`).expect(200);
    expect(res.body).toMatchObject({ slug: `speaker-${run}`, name: `Speaker ${run}`, githubUrl: 'https://github.com/x' });
    expect(res.body.events.map((e: { slug: string }) => e.slug)).toEqual([`soon-${run}`, `older-${run}`]);
    expect(res.body.events[0]).toMatchObject({ past: false, recordingUrl: null });
    expect(res.body.courses.map((c: { slug: string }) => c.slug).sort()).toEqual([`private-${run}`, `public-${run}`]);
    expect(res.body.courses[0]).toMatchObject({ completed: true, cohortNumber: 1 });
    const slugs = await http().get('/api/speakers').expect(200);
    expect(slugs.body.map((s: { slug: string }) => s.slug)).toContain(`speaker-${run}`);
  });

  it('hides speakers with nothing public', async () => {
    await prisma.instructor.create({ data: { slug: `hidden-${run}`, name: 'Hidden', titleEn: 'x', bioEn: '' } });
    await http().get(`/api/speakers/hidden-${run}`).expect(404);
    await http().get('/api/speakers/does-not-exist').expect(404);
  });

  it('links a session to its speaker profile and exposes a completed course\'s public recordings', async () => {
    const ev = await http().get(`/api/events/older-${run}`).expect(200);
    expect(ev.body).toMatchObject({ speakerName: `Speaker ${run}`, speaker: { slug: `speaker-${run}` }, topics: [tag, 'docker'] });
    const pub = await http().get(`/api/courses/public-${run}`).expect(200);
    expect(pub.body).toMatchObject({ completed: true, cohortNumber: 1, publicRecordings: true });
    expect(pub.body.sessions[0].recordingUrl).toBe('https://www.youtube.com/watch?v=publicPRIVATE');
    expect(pub.body.instructors[0].slug).toBe(`speaker-${run}`);
    const priv = await http().get(`/api/courses/private-${run}`).expect(200);
    expect(priv.body.sessions[0].recordingUrl).toBeNull();
    // Nobody can apply to a completed cohort.
    const student = await createUser(app, prisma, { prefix: 'arc-st' });
    await http().post('/api/applications').set('Cookie', student.cookie).send({ courseSlug: `public-${run}`, answers: {} }).expect(409);
  });

  it('lets admins save a past session without a join link, with topics and a speaker', async () => {
    const speaker = await prisma.instructor.findUniqueOrThrow({ where: { slug: `speaker-${run}` } });
    const body = {
      slug: `archived-${run}`,
      status: 'PUBLISHED',
      titleEn: 'Archived talk',
      titleAr: 'محاضرة مؤرشفة',
      startsAt: days(-30).toISOString(),
      durationMin: 60,
      language: 'AR',
      platform: 'YOUTUBE_LIVE',
      recordingUrl: 'https://www.youtube.com/watch?v=abc',
      topics: ['Model Serving', 'docker', 'docker'],
      speakerId: speaker.id,
    };
    const created = await http().post('/api/admin/events').set('Cookie', admin.cookie).send(body).expect(201);
    expect(created.body).toMatchObject({ topics: ['model-serving', 'docker'], speakerId: speaker.id, liveUrl: null });
    // An upcoming session still needs one.
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send({ ...body, slug: `upcoming-${run}`, startsAt: days(2).toISOString() }).expect(400);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send({ ...body, slug: 'recordings' }).expect(400);
    await http().post('/api/admin/events').set('Cookie', admin.cookie).send({ ...body, slug: `ghost-${run}`, speakerId: 'nope' }).expect(400);
  });

  it('lets admins manage speakers, with a slug made from the name', async () => {
    const created = await http()
      .post('/api/admin/instructors')
      .set('Cookie', admin.cookie)
      .send({ name: `New Speaker ${run}`, titleEn: 'Engineer', photoUrl: '/speakers/new.webp', githubUrl: 'https://github.com/new' })
      .expect(201);
    expect(created.body).toMatchObject({ slug: `new-speaker-${run}`, bioEn: '', photoUrl: '/speakers/new.webp' });
    const again = await http().post('/api/admin/instructors').set('Cookie', admin.cookie).send({ name: `New Speaker ${run}`, titleEn: 'Engineer' }).expect(201);
    expect(again.body.slug).toBe(`new-speaker-${run}-2`);
    await http().put(`/api/admin/instructors/${again.body.id}`).set('Cookie', admin.cookie).send({ name: 'x y', titleEn: 'Engineer', slug: `new-speaker-${run}` }).expect(409);
    const one = await http().get(`/api/admin/instructors/${created.body.id}`).set('Cookie', admin.cookie).expect(200);
    expect(one.body).toMatchObject({ source: null, courses: 0, events: 0 });
    await http().post('/api/admin/instructors').set('Cookie', admin.cookie).send({ name: 'Bad Photo', titleEn: 'x x', photoUrl: 'javascript:alert(1)' }).expect(400);
  });
});
