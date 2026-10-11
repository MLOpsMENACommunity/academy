import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

const TEAM = ['pub-team@example.test'];
const DAY = 86_400_000;

/**
 * From a speaker's booking to something public: a session (or podcast) booking becomes a
 * draft session the team publishes (and the speaker hears); a course booking becomes a draft
 * course, prefilled and linked, that the team finishes and publishes in Courses.
 */
describe('publishing speaker bookings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; template: EmailTemplate; bulk: boolean }[] = [];
  let previous: Record<string, unknown>;
  const http = () => request(app.getHttpServer());
  const mails = (name: EmailTemplate['name'], to?: string) => sent.filter((m) => m.template.name === name && (!to || m.to === to));
  /** Emails are sent without waiting: give them a moment. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  const application = (fullName: string) => ({
    fullName,
    phone: '+201001234567',
    linkedinUrl: 'https://www.linkedin.com/in/pub-speaker',
    title: 'Staff ML Engineer',
    company: 'Acme',
    country: 'EG',
    bio: 'Ten years shipping models to production across fintech and telecom.',
    areas: ['MLOPS'],
    sessionTitle: 'Feature stores in practice',
    abstract: 'How we run a feature store for real-time fraud models, and what we would do differently today.',
    format: 'TALK',
    language: 'AR',
    preferredMonths: ['2026-12'],
    referralSource: 'LINKEDIN',
  });
  const abstract = 'Feature pipelines, online and offline stores, and the monitoring that keeps them honest in production.';

  async function approvedSpeaker(name: string): Promise<{ id: string; cookie: string; email: string; instructorId: string }> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'pub-spk', coreComplete: false });
    const res = await http().put('/api/speaker/application').set('Cookie', s.cookie).send(application(`${name} ${Date.now()}`)).expect(200);
    await http().post(`/api/admin/speaker-applications/${res.body.id}/review`).set('Cookie', admin.cookie).send({ decision: 'APPROVE' }).expect(200);
    const instructor = await prisma.instructor.findUniqueOrThrow({ where: { userId: s.id } });
    return { ...s, instructorId: instructor.id };
  }
  /** A slot of its own, far enough ahead to be bookable and cancellable. */
  const slotAt = (days: number, durationMin = 60) => prisma.speakingSlot.create({ data: { startsAt: new Date(Date.now() + days * DAY + Math.floor(Math.random() * 3_600_000)), durationMin } });
  const book = (cookie: string, slotId: string, body: Record<string, unknown>) => http().post(`/api/speaker/slots/${slotId}/booking`).set('Cookie', cookie).send(body);

  /** The admin course editor's body, from what the admin API returns (what the editor does). */
  function coursePayload(c: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
    const keys = [
      'slug', 'titleEn', 'titleAr', 'shortDescriptionEn', 'shortDescriptionAr', 'longDescriptionEn', 'longDescriptionAr', 'type', 'price', 'currency',
      'requiresApproval', 'capacity', 'status', 'levels', 'levelProgression', 'language', 'startDate', 'applicationsOpenAt', 'applicationDeadline',
      'durationWeeks', 'hoursPerWeek', 'coverImageUrl', 'targetAudience', 'notFor', 'preparation', 'learningOutcomes', 'prerequisites', 'outline', 'faq',
      'included', 'deliveryPlatform', 'recordingsPlatform', 'driveFolderUrl', 'youtubePlaylistUrl', 'instructorIds', 'topics', 'cohortNumber', 'endDate',
      'externalPlatform', 'externalUrl', 'publicRecordings',
    ];
    return { ...Object.fromEntries(keys.map((k) => [k, c[k]])), ...over };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'pub-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template, opts) => {
      sent.push({ to, template, bulk: Boolean(opts?.bulk) });
      return true;
    });
    previous = (await http().get('/api/admin/settings').set('Cookie', admin.cookie).expect(200)).body;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ sessionTeamEmails: TEAM, speakerMaxOpenBookings: 5, speakerCancelDays: 3 }).expect(200);
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await http()
      .put('/api/admin/settings')
      .set('Cookie', admin.cookie)
      .send({ sessionTeamEmails: previous.sessionTeamEmails, speakerMaxOpenBookings: previous.speakerMaxOpenBookings, speakerCancelDays: previous.speakerCancelDays });
    await app.close();
  });

  describe('a session booking', () => {
    it('is a draft until published; publishing needs the Meet link, then it is public and the speaker hears', async () => {
      const s = await approvedSpeaker('Publisher');
      const slot = await slotAt(30);
      await book(s.cookie, slot.id, { title: 'Feature stores in practice', abstract }).expect(201);
      const { eventId } = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } });
      const draft = (await http().get(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).expect(200)).body;
      expect(draft).toMatchObject({ status: 'DRAFT', speakingSlot: { id: slot.id, kind: 'SESSION', course: null, bookedBy: { email: s.email } } });
      // Saved as a draft: not public.
      const body = {
        slug: draft.slug,
        status: 'DRAFT',
        titleEn: draft.titleEn,
        titleAr: 'متاجر الميزات عمليًا',
        descriptionEn: draft.descriptionEn,
        startsAt: draft.startsAt,
        durationMin: draft.durationMin,
        language: draft.language,
        platform: draft.platform,
        speakerId: draft.speakerId,
      };
      await http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send(body).expect(200);
      await http().get(`/api/events/${draft.slug}`).expect(404);

      // Publish without the Meet link: refused, saying what is missing (and nothing changes).
      const refused = await http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send({ ...body, status: 'PUBLISHED' }).expect(400);
      expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'liveUrl', message: 'A live link is required to publish' })]);
      expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: eventId! } })).status).toBe('DRAFT');
      // The Arabic title is checked the same way.
      const noArabic = await http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send({ ...body, titleAr: '', status: 'PUBLISHED' }).expect(400);
      expect(noArabic.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['liveUrl', 'titleAr']);
      expect(mails('speakerSessionPublished')).toHaveLength(0);

      // With the link: published, public, and the speaker is told (email in their language, notification).
      await http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send({ ...body, status: 'PUBLISHED', liveUrl: 'https://meet.google.com/abc-defg-hij' }).expect(200);
      const list = await http().get('/api/events').expect(200);
      expect(list.body.upcoming.map((e: { slug: string }) => e.slug)).toContain(draft.slug);
      await settle();
      expect(mails('speakerSessionPublished')).toEqual([
        expect.objectContaining({ to: s.email, bulk: false, template: expect.objectContaining({ title: 'Feature stores in practice', url: expect.stringContaining(`/en/sessions/${draft.slug}`) }) }),
      ]);
      expect(await prisma.notification.count({ where: { userId: s.id, type: 'speaker_session_published', link: `/sessions/${draft.slug}` } })).toBe(1);
      const portal = await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);
      expect(portal.body.bookings.find((b: { slotId: string }) => b.slotId === slot.id)).toMatchObject({ canEdit: false, course: null, event: { status: 'PUBLISHED', slug: draft.slug } });

      // Saving it again doesn't tell the speaker twice.
      sent = [];
      await http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send({ ...body, status: 'PUBLISHED', liveUrl: 'https://meet.google.com/abc-defg-hij', descriptionEn: 'Updated.' }).expect(200);
      await settle();
      expect(mails('speakerSessionPublished')).toHaveLength(0);
    });

    it('keeps a podcast booking a session, labelled Podcast, published the same way', async () => {
      const s = await approvedSpeaker('Podcaster');
      const slot = await slotAt(31);
      await book(s.cookie, slot.id, { title: 'MLOps in MENA, episode 1', abstract, kind: 'PODCAST', details: { podcast: { host: 'Host' } } }).expect(201);
      const saved = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { event: true } });
      expect(saved).toMatchObject({ courseId: null, event: { status: 'DRAFT', details: { kind: 'PODCAST' } } });
      const list = (await http().get('/api/admin/events').set('Cookie', admin.cookie).expect(200)).body as { id: string; speakingSlot: { kind: string } | null }[];
      expect(list.find((e) => e.id === saved.eventId)?.speakingSlot).toMatchObject({ kind: 'PODCAST' });
    });
  });

  describe('a course booking', () => {
    it('becomes a draft course, prefilled from the booking, linked, with the speaker as instructor; the team publishes it', async () => {
      const s = await approvedSpeaker('Course author');
      const slot = await slotAt(35, 90);
      const details = {
        audience: 'Data scientists moving models to production',
        prerequisites: '- Python\n- Docker basics',
        outcomes: ['Package a model', 'Serve it behind an API'],
        level: 'INTERMEDIATE',
        language: 'EN',
        tags: ['Docker', 'model serving'],
        course: {
          modules: [{ title: 'Packaging', description: 'Containers for models' }, { title: 'Serving', description: '' }],
          weeklyHours: 2.5,
          durationWeeks: 6,
          materialsUrl: 'https://github.com/example/course',
        },
      };
      const res = await book(s.cookie, slot.id, { title: 'Shipping models, a course', abstract, kind: 'COURSE', details }).expect(201);
      expect(res.body).toMatchObject({ kind: 'COURSE', event: null, course: { status: 'DRAFT' }, canEdit: true });

      // No draft session: a draft course instead, linked to the booking.
      const linked = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(linked.eventId).toBeNull();
      expect(linked.courseId).toBeTruthy();
      const course = (await http().get(`/api/admin/courses/${linked.courseId}`).set('Cookie', admin.cookie).expect(200)).body;
      expect(course).toMatchObject({
        status: 'DRAFT',
        source: 'speaker-booking',
        type: 'FREE',
        price: 0,
        titleEn: 'Shipping models, a course',
        titleAr: '',
        shortDescriptionEn: abstract,
        longDescriptionEn: abstract,
        levels: ['MID'],
        language: 'EN',
        durationWeeks: 6,
        hoursPerWeek: 3,
        startDate: slot.startsAt.toISOString(),
        targetAudience: { en: details.audience, ar: '' },
        prerequisites: { en: ['Python', 'Docker basics'], ar: [] },
        learningOutcomes: { en: details.outcomes, ar: [] },
        outline: [
          { titleEn: 'Packaging', titleAr: 'Packaging', descriptionEn: 'Containers for models' },
          { titleEn: 'Serving', titleAr: 'Serving' },
        ],
        preparation: { en: 'Course materials: https://github.com/example/course', ar: '' },
        topics: ['docker', 'model-serving'],
        instructorIds: [s.instructorId],
      });
      // Not public while a draft.
      await http().get(`/api/courses/${course.slug}`).expect(404);

      // The team sees the link in Availability, and was emailed the course (not a session).
      const slots = (await http().get('/api/admin/speaking-slots?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z').set('Cookie', admin.cookie).expect(200)).body as { id: string; course: unknown; event: unknown }[];
      expect(slots.find((x) => x.id === slot.id)).toMatchObject({ event: null, course: { id: course.id, slug: course.slug, status: 'DRAFT' } });
      await settle();
      expect(mails('speakerBookingTeam')).toEqual([
        expect.objectContaining({ to: TEAM[0], template: expect.objectContaining({ kind: 'booked', draft: 'course', url: expect.stringContaining(`/admin/courses/${course.id}`) }) }),
      ]);
      expect(mails('speakerBookingConfirmed', s.email)).toEqual([expect.objectContaining({ template: expect.objectContaining({ course: true }) })]);
      expect(await prisma.notification.count({ where: { userId: admin.id, type: 'speaker_booking', link: `/admin/courses/${course.id}` } })).toBe(1);

      // The editor saves the draft as it is (the course model's own checks).
      await http().put(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).send(coursePayload(course)).expect(200);
      // The speaker's edits reach the draft course.
      await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send({ title: 'Shipping models to production', abstract, kind: 'COURSE', details }).expect(200);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).titleEn).toBe('Shipping models to production');

      // Publishing needs the Arabic texts, as for any course; then it is public.
      const fresh = (await http().get(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).expect(200)).body;
      const missing = await http().put(`/api/admin/courses/${course.id}`).set('Cookie', admin.cookie).send(coursePayload(fresh, { status: 'OPEN' })).expect(400);
      expect(missing.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['titleAr', 'shortDescriptionAr']));
      await http()
        .put(`/api/admin/courses/${course.id}`)
        .set('Cookie', admin.cookie)
        .send(coursePayload(fresh, { status: 'OPEN', titleAr: 'نشر النماذج في الإنتاج', shortDescriptionAr: 'دورة عملية عن تغليف النماذج وتقديمها في بيئة الإنتاج.' }))
        .expect(200);
      const pub = await http().get(`/api/courses/${course.slug}`).expect(200);
      expect(pub.body).toMatchObject({ slug: course.slug, titleEn: 'Shipping models to production' });
      expect(pub.body.instructors.map((i: { id: string }) => i.id)).toEqual([s.instructorId]);

      // Published: the speaker can't edit it any more, and sees it is public.
      const locked = await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send({ title: 'Too late', abstract, kind: 'COURSE', details }).expect(409);
      expect(locked.body.code).toBe('BOOKING_LOCKED');
      const portal = await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);
      expect(portal.body.bookings.find((b: { slotId: string }) => b.slotId === slot.id)).toMatchObject({ canEdit: false, course: { slug: course.slug, status: 'OPEN' } });
    });

    it('creates the course draft for an existing course booking, idempotently, replacing its draft session', async () => {
      const s = await approvedSpeaker('Before drafts');
      const slot = await slotAt(40, 120);
      // A course booked before this change: a draft session, no course.
      await book(s.cookie, slot.id, { title: 'Old course booking', abstract, kind: 'SESSION' }).expect(201);
      const before = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } });
      await prisma.speakingSlot.update({ where: { id: slot.id }, data: { kind: 'COURSE', details: { course: { durationWeeks: 4 } } } });
      await prisma.liveEvent.update({ where: { id: before.eventId! }, data: { titleAr: 'دورة قديمة', details: { kind: 'COURSE', details: {} } } });

      await http().post(`/api/admin/speaking-slots/${slot.id}/course-draft`).set('Cookie', s.cookie).expect(403);
      const first = await http().post(`/api/admin/speaking-slots/${slot.id}/course-draft`).set('Cookie', admin.cookie).expect(200);
      expect(first.body).toMatchObject({ created: true, removedDraftEventId: before.eventId });
      const again = await http().post(`/api/admin/speaking-slots/${slot.id}/course-draft`).set('Cookie', admin.cookie).expect(200);
      expect(again.body).toMatchObject({ created: false, courseId: first.body.courseId, removedDraftEventId: null });
      expect(await prisma.course.count({ where: { speakingSlot: { id: slot.id } } })).toBe(1);

      // What the team wrote on the session carries over; the draft session is gone.
      const course = await prisma.course.findUniqueOrThrow({ where: { id: first.body.courseId }, include: { instructors: true } });
      expect(course).toMatchObject({ status: 'DRAFT', titleEn: 'Old course booking', titleAr: 'دورة قديمة', durationWeeks: 4 });
      expect(course.instructors.map((i) => i.instructorId)).toEqual([s.instructorId]);
      expect(await prisma.liveEvent.findUnique({ where: { id: before.eventId! } })).toBeNull();
      expect(await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({ courseId: course.id, eventId: null });

      // Only course bookings become courses.
      const other = await slotAt(41);
      await book(s.cookie, other.id, { title: 'A plain session', abstract }).expect(201);
      const refused = await http().post(`/api/admin/speaking-slots/${other.id}/course-draft`).set('Cookie', admin.cookie).expect(409);
      expect(refused.body.code).toBe('NOT_A_COURSE_BOOKING');
      await http().post(`/api/admin/speaking-slots/${(await slotAt(42)).id}/course-draft`).set('Cookie', admin.cookie).expect(404);
    });

    it('swaps the draft session for a draft course (and back) when the kind changes', async () => {
      const s = await approvedSpeaker('Changer');
      const slot = await slotAt(44);
      await book(s.cookie, slot.id, { title: 'Started as a talk', abstract }).expect(201);
      const { eventId } = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } });
      await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send({ title: 'Now a course', abstract, kind: 'COURSE' }).expect(200);
      const asCourse = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(asCourse).toMatchObject({ kind: 'COURSE', eventId: null });
      expect(await prisma.liveEvent.findUnique({ where: { id: eventId! } })).toBeNull();
      expect(await prisma.course.findUniqueOrThrow({ where: { id: asCourse.courseId! } })).toMatchObject({ status: 'DRAFT', titleEn: 'Now a course' });

      await http().put(`/api/admin/speaking-slots/${slot.id}/booking`).set('Cookie', admin.cookie).send({ title: 'A talk after all', abstract, kind: 'SESSION' }).expect(200);
      const asSession = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { event: true } });
      expect(asSession).toMatchObject({ kind: 'SESSION', courseId: null, event: { status: 'DRAFT', titleEn: 'A talk after all' } });
      expect(await prisma.course.findUnique({ where: { id: asCourse.courseId! } })).toBeNull();
    });

    it('deletes a draft course when the booking is cancelled, and keeps a published one (telling the team)', async () => {
      const s = await approvedSpeaker('Withdrawer');
      const draftSlot = await slotAt(46);
      await book(s.cookie, draftSlot.id, { title: 'A course that will not happen', abstract, kind: 'COURSE' }).expect(201);
      const draftCourseId = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: draftSlot.id } })).courseId!;
      sent = [];
      await http().delete(`/api/speaker/slots/${draftSlot.id}/booking`).set('Cookie', s.cookie).expect(204);
      expect(await prisma.course.findUnique({ where: { id: draftCourseId } })).toBeNull();
      expect(await prisma.speakingSlot.findUniqueOrThrow({ where: { id: draftSlot.id } })).toMatchObject({ status: 'OPEN', courseId: null, eventId: null });
      await settle();
      expect(mails('speakerBookingTeam')).toEqual([expect.objectContaining({ template: expect.objectContaining({ kind: 'cancelled', draft: 'course', courseKept: null }) })]);

      const pubSlot = await slotAt(48);
      await book(s.cookie, pubSlot.id, { title: 'A course the team published', abstract, kind: 'COURSE' }).expect(201);
      const pubCourseId = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: pubSlot.id } })).courseId!;
      await prisma.course.update({ where: { id: pubCourseId }, data: { status: 'OPEN', titleAr: 'دورة', shortDescriptionAr: 'دورة منشورة بالفعل.' } });
      sent = [];
      await http().post(`/api/admin/speaking-slots/${pubSlot.id}/release`).set('Cookie', admin.cookie).expect(204);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: pubCourseId } })).status).toBe('OPEN');
      expect(await prisma.speakingSlot.findUniqueOrThrow({ where: { id: pubSlot.id } })).toMatchObject({ status: 'OPEN', courseId: null });
      await settle();
      expect(mails('speakerBookingTeam')).toEqual([
        expect.objectContaining({ template: expect.objectContaining({ kind: 'cancelled', courseKept: 'OPEN', url: expect.stringContaining(`/admin/courses/${pubCourseId}`) }) }),
      ]);
      expect(await prisma.notification.count({ where: { userId: admin.id, type: 'speaker_booking_cancelled', link: `/admin/courses/${pubCourseId}` } })).toBe(1);
    });
  });
});
