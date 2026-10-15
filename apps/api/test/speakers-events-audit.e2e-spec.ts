import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

const DAY = 86_400_000;

/**
 * Regressions from the audit of speakers, live sessions, the admin team and media: each test
 * pins down one bug that was found and fixed.
 */
describe('speakers and live sessions: audit regressions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; template: EmailTemplate }[] = [];
  const http = () => request(app.getHttpServer());

  const application = (fullName: string) => ({
    fullName,
    phone: '+201001234567',
    linkedinUrl: 'https://www.linkedin.com/in/audit-speaker',
    title: 'Staff ML Engineer',
    company: 'Acme',
    country: 'EG',
    bio: 'Ten years shipping models to production across fintech and telecom.',
    areas: ['MLOPS'],
    sessionTitle: 'Feature stores in practice',
    abstract: 'How we run a feature store for real-time fraud models, and what we would do differently today.',
    format: 'TALK',
    language: 'EN',
    preferredMonths: ['2026-12'],
    referralSource: 'LINKEDIN',
  });
  const booking = { title: 'Serving LLMs on Kubernetes', abstract: 'A walk through GPU scheduling, autoscaling and observability for LLM inference.' };

  async function approvedSpeaker(name: string): Promise<{ id: string; cookie: string; email: string; instructorId: string }> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'aud-spk', coreComplete: false });
    const res = await http().put('/api/speaker/application').set('Cookie', s.cookie).send(application(`${name} ${Date.now()}`)).expect(200);
    await http().post(`/api/admin/speaker-applications/${res.body.id}/review`).set('Cookie', admin.cookie).send({ decision: 'APPROVE' }).expect(200);
    const instructor = await prisma.instructor.findUniqueOrThrow({ where: { userId: s.id } });
    return { ...s, instructorId: instructor.id };
  }
  /** A slot of its own (random minutes, so runs never collide), `days` ahead. */
  const slotAt = (days: number) => prisma.speakingSlot.create({ data: { startsAt: new Date(Date.now() + days * DAY + Math.floor(Math.random() * 3_600_000)), durationMin: 60 } });
  /** Books a slot and returns the draft session made from it. */
  async function booked(s: { cookie: string }, days = 20) {
    const slot = await slotAt(days);
    await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(201);
    const eventId = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).eventId!;
    return { slot, eventId };
  }
  const publish = (eventId: string, data: Record<string, unknown> = {}) =>
    prisma.liveEvent.update({ where: { id: eventId }, data: { status: 'PUBLISHED', titleAr: 'جلسة', liveUrl: 'https://meet.google.com/abc-defg-hij', ...data } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'aud-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template) => {
      sent.push({ to, template });
      return true;
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  it('SPK-01: never releases a booking whose session already took place', async () => {
    const s = await approvedSpeaker('Ended');
    const { slot, eventId } = await booked(s);
    await publish(eventId, { recordingUrl: 'https://www.youtube.com/watch?v=REC' });
    const student = await createUser(app, prisma, { prefix: 'aud-reg' });
    await prisma.eventRegistration.create({ data: { eventId, userId: student.id } });
    // The session took place two days ago.
    const past = new Date(Date.now() - 2 * DAY);
    await prisma.liveEvent.update({ where: { id: eventId }, data: { startsAt: past } });
    await prisma.speakingSlot.update({ where: { id: slot.id }, data: { startsAt: past } });

    const res = await http().post(`/api/admin/speaking-slots/${slot.id}/release`).set('Cookie', admin.cookie).expect(409);
    expect(res.body.code).toBe('BOOKING_ENDED');
    expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('PUBLISHED');
    expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('BOOKED');
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((m) => m.template.name === 'eventCancelled')).toEqual([]);
  });
  /** The admin editor's body for a stored session (what the web form sends back). */
  async function editorBody(eventId: string, over: Record<string, unknown> = {}) {
    const e = (await http().get(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).expect(200)).body;
    const keep = ['slug', 'status', 'titleEn', 'titleAr', 'descriptionEn', 'descriptionAr', 'speakerName', 'speakerNameAr', 'speakerTitleEn', 'speakerTitleAr', 'speakerPhotoUrl', 'speakerLinkedinUrl', 'speakerId', 'topics', 'category', 'startsAt', 'durationMin', 'language', 'platform', 'liveUrl', 'recordingUrl', 'coverImageUrl', 'capacity'];
    return { ...Object.fromEntries(keep.map((k) => [k, e[k]])), ...over };
  }

  /** Saves a stored session through the admin editor's endpoint. The body is read first: one request at a time. */
  async function save(eventId: string, over: Record<string, unknown>) {
    const body = await editorBody(eventId, over);
    return http().put(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).send(body);
  }

  it('SPK-02: refuses to put a published session with registrants back to draft (cancel tells them)', async () => {
    const event = await prisma.liveEvent.create({
      data: { slug: `aud-unpub-${Date.now()}`, status: 'PUBLISHED', titleEn: 'Unpublish me', titleAr: 'جلسة', startsAt: new Date(Date.now() + 5 * DAY), durationMin: 60, liveUrl: 'https://meet.google.com/abc-defg-hij' },
    });
    // Nobody registered yet: back to draft is fine.
    expect((await save(event.id, { status: 'DRAFT' })).status).toBe(200);
    expect((await save(event.id, { status: 'PUBLISHED' })).status).toBe(200);
    const student = await createUser(app, prisma, { prefix: 'aud-unpub' });
    await http().post(`/api/events/${event.slug}/registration`).set('Cookie', student.cookie).expect(201);

    const res = await save(event.id, { status: 'DRAFT' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_UNPUBLISH_HAS_REGISTRATIONS');
    expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PUBLISHED');
    // Cancelling still works, and tells them.
    sent = [];
    expect((await save(event.id, { status: 'CANCELLED' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((m) => m.template.name === 'eventCancelled').map((m) => m.to)).toEqual([student.email]);
  });

  it('SPK-03: refuses to delete a session a speaker booking holds (release the booking instead)', async () => {
    const s = await approvedSpeaker('Deleted');
    const { slot, eventId } = await booked(s);
    const res = await http().delete(`/api/admin/events/${eventId}`).set('Cookie', admin.cookie).expect(409);
    expect(res.body.code).toBe('EVENT_FROM_BOOKING');
    expect(await prisma.liveEvent.findUnique({ where: { id: eventId } })).not.toBeNull();
    // Releasing the booking removes the draft and reopens the slot.
    await http().post(`/api/admin/speaking-slots/${slot.id}/release`).set('Cookie', admin.cookie).expect(204);
    expect(await prisma.liveEvent.findUnique({ where: { id: eventId } })).toBeNull();
    expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('OPEN');
    // A session made by hand can still be deleted.
    const own = await prisma.liveEvent.create({ data: { slug: `aud-own-${Date.now()}`, titleEn: 'Own draft', startsAt: new Date(Date.now() + 9 * DAY) } });
    await http().delete(`/api/admin/events/${own.id}`).set('Cookie', admin.cookie).expect(204);
  });
  it('SPK-04: a speaker with upcoming bookings is not promoted, and a speaker removed from the team is a speaker again', async () => {
    const s = await approvedSpeaker('Promoted');
    const { slot } = await booked(s);
    const refused = await http().post('/api/admin/team').set('Cookie', admin.cookie).send({ email: s.email, permissions: ['CONTENT'] }).expect(409);
    expect(refused.body.code).toBe('SPEAKER_HAS_BOOKINGS');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).role).toBe('SPEAKER');

    await http().post(`/api/admin/speaking-slots/${slot.id}/release`).set('Cookie', admin.cookie).expect(204);
    await http().post('/api/admin/team').set('Cookie', admin.cookie).send({ email: s.email, permissions: ['CONTENT'] }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).role).toBe('ADMIN');
    await http().post(`/api/admin/team/${s.id}/remove`).set('Cookie', admin.cookie).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: s.id }, select: { role: true, adminPermissions: true } })).toEqual({ role: 'SPEAKER', adminPermissions: [] });
    await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);

    // Anyone else goes back to a student account, as before.
    const student = await createUser(app, prisma, { prefix: 'aud-promo' });
    await http().post('/api/admin/team').set('Cookie', admin.cookie).send({ email: student.email, permissions: ['FINANCE'] }).expect(201);
    await http().post(`/api/admin/team/${student.id}/remove`).set('Cookie', admin.cookie).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: student.id } })).role).toBe('STUDENT');
  });
  it('SPK-05: booking notifications reach the academic team too, each with a page that admin can open', async () => {
    const speakersOnly = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['SPEAKERS'], prefix: 'aud-n-spk' });
    const academic = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['ACADEMIC'], prefix: 'aud-n-aca' });
    const finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'aud-n-fin' });
    const s = await approvedSpeaker('Notified');
    const { slot, eventId } = await booked(s);
    const links = async (type: string) =>
      Object.fromEntries(
        (await prisma.notification.findMany({ where: { type, userId: { in: [admin.id, speakersOnly.id, academic.id, finance.id] } }, orderBy: { createdAt: 'desc' } }))
          .reverse()
          .map((n) => [n.userId, n.link]),
      );
    expect(await links('speaker_booking')).toEqual({
      [admin.id]: `/admin/sessions/${eventId}`,
      [academic.id]: `/admin/sessions/${eventId}`,
      [speakersOnly.id]: '/admin/speakers/availability',
    });
    await http().post(`/api/admin/speaking-slots/${slot.id}/release`).set('Cookie', admin.cookie).expect(204);
    expect(await links('speaker_booking_cancelled')).toEqual({
      [admin.id]: '/admin/speakers/availability',
      [speakersOnly.id]: '/admin/speakers/availability',
      [academic.id]: '/admin/sessions',
    });
  });
});
