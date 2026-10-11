import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { GoogleService } from '../src/auth/google.service';
import { EmailService } from '../src/email/email.service';
import type { EmailTemplate } from '../src/email/templates/catalog';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { cookieHeader, createCourse, createTestApp, createUser, uniqueEmail } from './helpers';

const TEAM = ['team-a@example.test', 'team-b@example.test', 'team-c@example.test'];
const DAY = 86_400_000;

describe('speaker portal (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let sent: { to: string; template: EmailTemplate; bulk: boolean }[] = [];
  let previous: Record<string, unknown>;
  const http = () => request(app.getHttpServer());
  const mails = (name: EmailTemplate['name']) => sent.filter((m) => m.template.name === name);

  const application = (over: Record<string, unknown> = {}) => ({
    fullName: 'Mona Speaker',
    phone: '+201001234567',
    linkedinUrl: 'https://www.linkedin.com/in/mona-speaker?utm_source=share',
    title: 'Staff ML Engineer',
    company: 'Acme',
    country: 'EG',
    bio: 'Ten years shipping models to production across fintech and telecom.',
    areas: ['MLOPS', 'KUBERNETES'],
    sessionTitle: 'Serving LLMs on Kubernetes',
    abstract: 'A walk through GPU scheduling, autoscaling and observability for LLM inference in production.',
    format: 'HANDS_ON',
    language: 'AR',
    preferredMonths: ['2026-11'],
    referralSource: 'LINKEDIN',
    ...over,
  });
  const booking = { title: 'Serving LLMs on Kubernetes', abstract: 'A walk through GPU scheduling, autoscaling and observability for LLM inference.' };

  /** A speaker account with an approved application (through the API, as the team would). */
  async function approvedSpeaker(name = 'Approved Speaker'): Promise<{ id: string; cookie: string; email: string; instructorId: string }> {
    const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'spk', coreComplete: false });
    const res = await http().put('/api/speaker/application').set('Cookie', s.cookie).send(application({ fullName: `${name} ${Date.now()}` })).expect(200);
    await http().post(`/api/admin/speaker-applications/${res.body.id}/review`).set('Cookie', admin.cookie).send({ decision: 'APPROVE' }).expect(200);
    const instructor = await prisma.instructor.findUniqueOrThrow({ where: { userId: s.id } });
    return { ...s, instructorId: instructor.id };
  }
  const slotAt = (startsAt: Date, durationMin = 60) => prisma.speakingSlot.create({ data: { startsAt, durationMin } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'spk-admin' });
    jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template, opts) => {
      sent.push({ to, template, bulk: Boolean(opts?.bulk) });
      return true;
    });
    previous = (await http().get('/api/admin/settings').set('Cookie', admin.cookie).expect(200)).body;
    await http()
      .put('/api/admin/settings')
      .set('Cookie', admin.cookie)
      .send({ sessionTeamEmails: TEAM, speakerMaxOpenBookings: 2, speakerCancelDays: 3 })
      .expect(200);
    // The slot tests count what they create: start from none (this is a scratch database).
    await prisma.speakingSlot.deleteMany();
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

  describe('signing up as a speaker', () => {
    it('registers a speaker by email, a student by default, and never an admin', async () => {
      const spk = await http().post('/api/auth/register').send({ email: uniqueEmail('reg-spk'), password: 'speaker-password-1', role: 'SPEAKER' }).expect(201);
      expect(spk.body.role).toBe('SPEAKER');
      const stu = await http().post('/api/auth/register').send({ email: uniqueEmail('reg-stu'), password: 'student-password-1' }).expect(201);
      expect(stu.body.role).toBe('STUDENT');
      const email = uniqueEmail('reg-adm');
      await http().post('/api/auth/register').send({ email, password: 'admin-password-12', role: 'ADMIN' }).expect(400);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('carries the choice through the Google sign-in state, for new accounts only', async () => {
      const google = app.get(GoogleService);
      jest.spyOn(google, 'enabled', 'get').mockReturnValue(true);
      jest.spyOn(google, 'authUrl').mockImplementation((nonce: string) => `https://accounts.example.test/o?state=${nonce}`);
      const exchange = jest.spyOn(google, 'exchange');
      const state = (cookie: string) => JSON.parse(Buffer.from(decodeURIComponent(/oauth_state=([^;]+)/.exec(cookie)![1]!), 'base64url').toString());

      // Speaker: the state says so, and the new account is a speaker landing on the portal.
      const start = await http().get('/api/auth/google?locale=ar&as=speaker&returnTo=%2Far%2Fonboarding').expect(302);
      const jar = cookieHeader(start.headers['set-cookie']);
      const s = state(jar);
      expect(s).toMatchObject({ role: 'SPEAKER', locale: 'ar' });
      const email = uniqueEmail('g-spk');
      exchange.mockResolvedValueOnce({ sub: `g-${Date.now()}`, email, emailVerified: true, name: 'Google Speaker' });
      const cb = await http().get(`/api/auth/google/callback?code=c&state=${s.nonce}`).set('Cookie', jar).expect(302);
      // Speakers skip student onboarding.
      expect(cb.headers.location).toMatch(/\/ar\/speaker$/);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe('SPEAKER');

      // Anything else in `as` (an admin attempt) is a student.
      const adm = await http().get('/api/auth/google?locale=en&as=ADMIN').expect(302);
      expect(state(cookieHeader(adm.headers['set-cookie']))).toMatchObject({ role: 'STUDENT', returnTo: '/en/dashboard' });

      // An existing student who picks "speaker" stays a student.
      const student = await createUser(app, prisma, { prefix: 'g-stu' });
      const again = await http().get('/api/auth/google?locale=en&as=speaker').expect(302);
      const jar2 = cookieHeader(again.headers['set-cookie']);
      const googleId = `g2-${Date.now()}`;
      await prisma.user.update({ where: { id: student.id }, data: { googleId } });
      exchange.mockResolvedValueOnce({ sub: googleId, email: student.email, emailVerified: true, name: 'Student' });
      await http().get(`/api/auth/google/callback?code=c&state=${state(jar2).nonce}`).set('Cookie', jar2).expect(302);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: student.id } })).role).toBe('STUDENT');
      jest.restoreAllMocks();
      jest.spyOn(app.get(EmailService), 'send').mockImplementation(async (to, _locale, template, opts) => {
        sent.push({ to, template, bulk: Boolean(opts?.bulk) });
        return true;
      });
    });
  });

  describe('applying and review', () => {
    it('applies, is rejected with a note, resubmits and is approved into a linked speaker profile', async () => {
      const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'apply', coreComplete: false });
      const bad = await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application({ linkedinUrl: '' })).expect(400);
      expect(JSON.stringify(bad.body)).toContain('linkedinUrl');
      await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application({ areas: ['BLOCKCHAIN'] })).expect(400);

      const name = `Mona ${Date.now()}`;
      const first = await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application({ fullName: name })).expect(200);
      expect(first.body).toMatchObject({ status: 'SUBMITTED', linkedinUrl: 'https://www.linkedin.com/in/mona-speaker', submissions: 1, email: speaker.email });
      expect(await prisma.notification.count({ where: { userId: admin.id, type: 'speaker_application', link: `/admin/speakers/applications/${first.body.id}` } })).toBe(1);
      // Not approved yet: no slots, no booking.
      await http().get('/api/speaker/slots').set('Cookie', speaker.cookie).expect(403);

      const list = await http().get('/api/admin/speaker-applications?status=SUBMITTED&area=KUBERNETES').set('Cookie', admin.cookie).expect(200);
      expect(list.body.map((a: { id: string }) => a.id)).toContain(first.body.id);
      const none = await http().get('/api/admin/speaker-applications?area=OTHER').set('Cookie', admin.cookie).expect(200);
      expect(none.body.map((a: { id: string }) => a.id)).not.toContain(first.body.id);
      const search = await http().get(`/api/admin/speaker-applications?q=${encodeURIComponent(name)}`).set('Cookie', admin.cookie).expect(200);
      expect(search.body).toHaveLength(1);

      const review = (body: Record<string, unknown>) => http().post(`/api/admin/speaker-applications/${first.body.id}/review`).set('Cookie', admin.cookie).send(body);
      await review({ decision: 'REJECT', note: '' }).expect(400);
      const rejected = await review({ decision: 'REJECT', note: 'We covered this topic last month.' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', reviewNote: 'We covered this topic last month.' });
      expect(mails('speakerReviewed')).toEqual([expect.objectContaining({ to: speaker.email, template: expect.objectContaining({ decision: 'REJECTED', note: 'We covered this topic last month.' }) })]);
      await review({ decision: 'APPROVE' }).expect(409);

      const again = await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application({ fullName: name, sessionTitle: 'Evaluating LLM apps' })).expect(200);
      expect(again.body).toMatchObject({ status: 'SUBMITTED', submissions: 2, reviewNote: null });

      sent = [];
      const approved = await review({ decision: 'APPROVE' }).expect(200);
      expect(approved.body.status).toBe('APPROVED');
      const instructor = await prisma.instructor.findUniqueOrThrow({ where: { userId: speaker.id } });
      expect(instructor).toMatchObject({ name, titleEn: 'Staff ML Engineer, Acme', linkedinUrl: 'https://www.linkedin.com/in/mona-speaker', source: 'speaker-portal' });
      expect(instructor.slug).toMatch(/^mona-\d+$/);
      expect(approved.body.instructor).toMatchObject({ id: instructor.id, slug: instructor.slug });
      expect(mails('speakerReviewed')[0]?.template).toMatchObject({ decision: 'APPROVED' });
      // Approved applications can't be edited by the speaker any more.
      await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application()).expect(409);
      expect(await prisma.auditLog.count({ where: { entityId: first.body.id, action: { startsWith: 'speaker_application.' } } })).toBe(4);
    });

    it('can link an existing speaker profile instead of creating one', async () => {
      const existing = await prisma.instructor.create({ data: { slug: `archive-${Date.now()}`, name: 'Archive Speaker', titleEn: '', bioEn: '' } });
      const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'link', coreComplete: false });
      const res = await http().put('/api/speaker/application').set('Cookie', speaker.cookie).send(application()).expect(200);
      const other = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'link2', coreComplete: false });
      await prisma.instructor.update({ where: { id: existing.id }, data: { userId: other.id } });
      await http().post(`/api/admin/speaker-applications/${res.body.id}/review`).set('Cookie', admin.cookie).send({ decision: 'APPROVE', instructorId: existing.id }).expect(400);
      await prisma.instructor.update({ where: { id: existing.id }, data: { userId: null } });
      await http().post(`/api/admin/speaker-applications/${res.body.id}/review`).set('Cookie', admin.cookie).send({ decision: 'APPROVE', instructorId: existing.id }).expect(200);
      expect((await prisma.instructor.findUniqueOrThrow({ where: { id: existing.id } })).userId).toBe(speaker.id);
    });
  });

  describe('availability', () => {
    it('generates monthly slots in Cairo time without doubling them, adds and withdraws single ones', async () => {
      const year = new Date().getUTCFullYear() + 1;
      const months = [`${year}-03`, `${year}-04`];
      const gen = () => http().post('/api/admin/speaking-slots/generate').set('Cookie', admin.cookie).send({ weekdays: [6], time: '19:00', durationMin: 60, months });
      const first = await gen().expect(200);
      expect(first.body.created).toBeGreaterThanOrEqual(8);
      expect(first.body.skipped).toBe(0);
      const second = await gen().expect(200);
      expect(second.body).toEqual({ created: 0, skipped: first.body.created });
      const rows = await prisma.speakingSlot.findMany({ where: { startsAt: { gte: new Date(Date.UTC(year, 2, 1)), lt: new Date(Date.UTC(year, 4, 1)) } } });
      const cairo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', hour: '2-digit', minute: '2-digit' });
      expect(new Set(rows.map((r) => cairo.format(r.startsAt)))).toEqual(new Set(['Sat 19:00']));

      const at = new Date(Date.UTC(year, 5, 3, 16, 0));
      const one = await http().post('/api/admin/speaking-slots').set('Cookie', admin.cookie).send({ startsAt: at.toISOString(), durationMin: 90 }).expect(201);
      await http().post('/api/admin/speaking-slots').set('Cookie', admin.cookie).send({ startsAt: at.toISOString(), durationMin: 90 }).expect(409);
      await http().post('/api/admin/speaking-slots').set('Cookie', admin.cookie).send({ startsAt: new Date(Date.now() - DAY).toISOString(), durationMin: 60 }).expect(400);
      const listed = await http().get(`/api/admin/speaking-slots?from=${new Date(Date.UTC(year, 5, 1)).toISOString()}`).set('Cookie', admin.cookie).expect(200);
      expect(listed.body.map((s: { id: string }) => s.id)).toContain(one.body.id);

      await http().post(`/api/admin/speaking-slots/${one.body.id}/cancel`).set('Cookie', admin.cookie).expect(204);
      await http().post(`/api/admin/speaking-slots/${one.body.id}/cancel`).set('Cookie', admin.cookie).expect(409);
      await http().delete(`/api/admin/speaking-slots/${one.body.id}`).set('Cookie', admin.cookie).expect(204);
    });

    it('is admin only', async () => {
      const speaker = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'acl' });
      const student = await createUser(app, prisma, { prefix: 'acl-s' });
      for (const who of [speaker, student]) {
        await http().get('/api/admin/speaking-slots').set('Cookie', who.cookie).expect(403);
        await http().post('/api/admin/speaking-slots/generate').set('Cookie', who.cookie).send({ weekdays: [6], time: '19:00', durationMin: 60, months: ['2030-01'] }).expect(403);
        await http().get('/api/admin/speaker-applications').set('Cookie', who.cookie).expect(403);
      }
    });
  });

  describe('booking', () => {
    it('books atomically: two speakers racing for one slot, exactly one wins, and the team hears about it', async () => {
      const [a, b] = await Promise.all([approvedSpeaker('Racer A'), approvedSpeaker('Racer B')]);
      const slot = await slotAt(new Date(Date.now() + 20 * DAY));
      sent = [];
      const results = await Promise.all([a, b].map((s) => http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.code).toBe('SLOT_TAKEN');
      const winner = results[0]!.status === 201 ? a : b;
      const won = results.find((r) => r.status === 201)!.body;
      expect(won).toMatchObject({ slotId: slot.id, title: booking.title, canCancel: true, event: { status: 'DRAFT', registered: 0 } });
      expect(won.calendarUrl).toMatch(/^https:\/\/calendar\.google\.com\//);
      expect(won.icsUrl).toContain(`/api/speaker/slots/${slot.id}/calendar.ics`);

      const saved = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { event: true } });
      expect(saved).toMatchObject({ status: 'BOOKED', bookedById: winner.id });
      expect(saved.event).toMatchObject({ status: 'DRAFT', titleEn: booking.title, descriptionEn: booking.abstract, speakerId: winner.instructorId, startsAt: slot.startsAt, language: 'AR' });

      // Every session-team address gets its own email, on the bulk lane.
      await new Promise((r) => setTimeout(r, 50));
      const team = mails('speakerBookingTeam');
      expect(team.map((m) => m.to).sort()).toEqual([...TEAM].sort());
      expect(team.every((m) => m.bulk && m.template.name === 'speakerBookingTeam' && m.template.kind === 'booked')).toBe(true);
      expect(mails('speakerBookingConfirmed')).toEqual([expect.objectContaining({ to: winner.email, bulk: false })]);
      expect(await prisma.notification.count({ where: { userId: admin.id, type: 'speaker_booking', link: `/admin/sessions/${saved.eventId}` } })).toBe(1);

      // The calendar file is the booker's alone.
      const ics = await http().get(`/api/speaker/slots/${slot.id}/calendar.ics`).set('Cookie', winner.cookie).expect(200).expect('Content-Type', /text\/calendar/);
      expect(ics.text).toContain('BEGIN:VEVENT');
      await http().get(`/api/speaker/slots/${slot.id}/calendar.ics`).set('Cookie', (winner === a ? b : a).cookie).expect(404);
    });

    it('limits upcoming bookings per speaker, even when the requests race', async () => {
      const s = await approvedSpeaker('Limited');
      const slots = await Promise.all([30, 31, 32, 33].map((d) => slotAt(new Date(Date.now() + d * DAY))));
      const results = await Promise.all(slots.slice(0, 3).map((sl) => http().post(`/api/speaker/slots/${sl.id}/booking`).set('Cookie', s.cookie).send(booking)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('BOOKING_LIMIT');
      const portal = await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);
      expect(portal.body.bookings).toHaveLength(2);
      expect(portal.body.rules).toEqual({ maxOpenBookings: 2, cancelDays: 3 });
    });

    it('only offers slots outside the cancel window', async () => {
      const s = await approvedSpeaker('Too soon');
      const soon = await slotAt(new Date(Date.now() + 2 * DAY));
      const listed = await http().get('/api/speaker/slots').set('Cookie', s.cookie).expect(200);
      expect(listed.body.map((x: { id: string }) => x.id)).not.toContain(soon.id);
      const res = await http().post(`/api/speaker/slots/${soon.id}/booking`).set('Cookie', s.cookie).send(booking).expect(409);
      expect(res.body.code).toBe('SLOT_TAKEN');
      expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: soon.id } })).status).toBe('OPEN');
    });

    it('lets the speaker cancel until N days before: the slot reopens, the draft goes (never public), the team is told', async () => {
      const s = await approvedSpeaker('Canceller');
      // Booked earlier, now inside the window (e.g. the team moved it).
      const soon = await prisma.speakingSlot.create({ data: { startsAt: new Date(Date.now() + 2 * DAY), durationMin: 60, status: 'BOOKED', bookedById: s.id, title: 'Soon' } });
      const later = await slotAt(new Date(Date.now() + 10 * DAY));
      const booked = await http().post(`/api/speaker/slots/${later.id}/booking`).set('Cookie', s.cookie).send(booking).expect(201);
      expect(booked.body.canCancel).toBe(true);

      const closed = await http().delete(`/api/speaker/slots/${soon.id}/booking`).set('Cookie', s.cookie).expect(409);
      expect(closed.body.code).toBe('CANCEL_WINDOW_CLOSED');
      const other = await approvedSpeaker('Not the booker');
      await http().delete(`/api/speaker/slots/${later.id}/booking`).set('Cookie', other.cookie).expect(404);

      const event = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: later.id }, include: { event: true } })).event!;
      sent = [];
      await http().delete(`/api/speaker/slots/${later.id}/booking`).set('Cookie', s.cookie).expect(204);
      expect(await prisma.speakingSlot.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({ status: 'OPEN', bookedById: null, eventId: null });
      // A draft never reaches the public pages: it is deleted, not cancelled.
      expect(await prisma.liveEvent.findUnique({ where: { id: event.id } })).toBeNull();
      await http().get(`/api/events/${event.slug}`).expect(404);
      await new Promise((r) => setTimeout(r, 50));
      const team = mails('speakerBookingTeam');
      expect(team.map((m) => m.to).sort()).toEqual([...TEAM].sort());
      expect(team.every((m) => m.template.name === 'speakerBookingTeam' && m.template.kind === 'cancelled')).toBe(true);
      // The open slot can be booked again.
      await http().post(`/api/speaker/slots/${later.id}/booking`).set('Cookie', other.cookie).send(booking).expect(201);
    });

    it('cancels a session the team already published, and lets admins release any booking', async () => {
      const s = await approvedSpeaker('Published');
      const slot = await slotAt(new Date(Date.now() + 12 * DAY));
      await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(201);
      const eventId = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).eventId!;
      await prisma.liveEvent.update({ where: { id: eventId }, data: { status: 'PUBLISHED', titleAr: 'جلسة', liveUrl: 'https://meet.google.com/x' } });
      await http().delete(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).expect(204);
      expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('CANCELLED');

      // Inside the window the speaker can't cancel, but the team can release it.
      const late = await prisma.speakingSlot.create({ data: { startsAt: new Date(Date.now() + DAY), durationMin: 60, status: 'BOOKED', bookedById: s.id, title: 'Late' } });
      await http().delete(`/api/speaker/slots/${late.id}/booking`).set('Cookie', s.cookie).expect(409);
      await http().post(`/api/admin/speaking-slots/${late.id}/release`).set('Cookie', s.cookie).expect(403);
      await http().post(`/api/admin/speaking-slots/${late.id}/release`).set('Cookie', admin.cookie).expect(204);
      expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: late.id } })).status).toBe('OPEN');
      await http().post(`/api/admin/speaking-slots/${late.id}/release`).set('Cookie', admin.cookie).expect(404);
    });

    it('shows the recording and the number registered after the session', async () => {
      const s = await approvedSpeaker('Delivered');
      const startsAt = new Date(Date.now() - 3 * DAY);
      const event = await prisma.liveEvent.create({
        data: { slug: `delivered-${Date.now()}`, status: 'PUBLISHED', titleEn: 'Delivered talk', titleAr: 'محاضرة', startsAt, durationMin: 60, speakerId: s.instructorId, recordingUrl: 'https://youtube.com/watch?v=REC', liveUrl: 'https://meet.google.com/x' },
      });
      await prisma.speakingSlot.create({ data: { startsAt, durationMin: 60, status: 'BOOKED', bookedById: s.id, title: 'Delivered talk', eventId: event.id } });
      const student = await createUser(app, prisma, { prefix: 'attendee' });
      await prisma.eventRegistration.create({ data: { eventId: event.id, userId: student.id } });
      const portal = await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);
      expect(portal.body.bookings[0]).toMatchObject({ past: true, canCancel: false, event: { slug: event.slug, recordingUrl: 'https://youtube.com/watch?v=REC', registered: 1 } });
      expect(portal.body.speakerPageSlug).toBeTruthy();
      expect(JSON.stringify(portal.body)).not.toContain('meet.google.com');
    });
  });

  describe('access control', () => {
    it('keeps students, unapproved speakers and admins out of booking, and speakers out of course applications', async () => {
      const slot = await slotAt(new Date(Date.now() + 40 * DAY));
      const student = await createUser(app, prisma, { prefix: 'nb-stu' });
      const pending = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'nb-spk' });
      await http().put('/api/speaker/application').set('Cookie', pending.cookie).send(application()).expect(200);
      await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', student.cookie).send(booking).expect(403);
      await http().put('/api/speaker/application').set('Cookie', student.cookie).send(application()).expect(403);
      const unapproved = await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', pending.cookie).send(booking).expect(403);
      expect(unapproved.body.code).toBe('SPEAKER_NOT_APPROVED');
      await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', admin.cookie).send(booking).expect(403);
      expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('OPEN');

      await http().post('/api/applications').set('Cookie', pending.cookie).send({ courseId: 'x', answers: {} }).expect(403);
    });

    it('lets an admin switch a student and a speaker account, never to or from admin', async () => {
      const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'switch' });
      await http().put(`/api/admin/users/${s.id}/role`).set('Cookie', s.cookie).send({ role: 'STUDENT' }).expect(403);
      await http().put(`/api/admin/users/${s.id}/role`).set('Cookie', admin.cookie).send({ role: 'ADMIN' }).expect(400);
      await http().put(`/api/admin/users/${s.id}/role`).set('Cookie', admin.cookie).send({ role: 'STUDENT' }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).role).toBe('STUDENT');
      // The role is read from the database: the old session is now a student's.
      await http().get('/api/speaker').set('Cookie', s.cookie).expect(403);
      // A student with course applications stays a student (their dashboard holds them).
      const student = await createUser(app, prisma, { prefix: 'switch-stu' });
      const course = await createCourse(prisma);
      await prisma.application.create({ data: { userId: student.id, courseId: course.id, answers: {}, profileSnapshot: {} } });
      const busy = await http().put(`/api/admin/users/${student.id}/role`).set('Cookie', admin.cookie).send({ role: 'SPEAKER' }).expect(409);
      expect(busy.body.code).toBe('HAS_COURSES');
      await http().put(`/api/admin/users/${s.id}/role`).set('Cookie', admin.cookie).send({ role: 'SPEAKER' }).expect(200);
      const other = await createUser(app, prisma, { role: 'ADMIN', prefix: 'switch-adm' });
      await http().put(`/api/admin/users/${other.id}/role`).set('Cookie', admin.cookie).send({ role: 'STUDENT' }).expect(403);
    });
  });

  describe('privacy', () => {
    it('exports the application and bookings, and account deletion releases upcoming bookings', async () => {
      const s = await approvedSpeaker('Leaving');
      const slot = await slotAt(new Date(Date.now() + 50 * DAY));
      await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(201);
      const accounts = app.get(AccountService);
      const exported = await accounts.export(s.id);
      expect(exported.speakerApplication).toMatchObject({ status: 'APPROVED', phone: '+201001234567' });
      expect(exported.speakerBookings).toEqual([expect.objectContaining({ title: booking.title, status: 'BOOKED' })]);

      const eventId = (await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).eventId!;
      sent = [];
      await accounts.deleteAccount({ id: s.id, role: 'SPEAKER', amr: 'google', authTime: new Date() }, undefined);
      expect(await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({ status: 'OPEN', bookedById: null });
      expect(await prisma.liveEvent.findUnique({ where: { id: eventId } })).toBeNull();
      expect(mails('speakerBookingTeam').map((m) => m.to).sort()).toEqual([...TEAM].sort());

      await accounts.anonymize(s.id);
      expect(await prisma.speakerApplication.findUnique({ where: { userId: s.id } })).toBeNull();
      // The profile the portal created, with no session anywhere, is gone with the account.
      expect(await prisma.instructor.findUnique({ where: { id: s.instructorId } })).toBeNull();
    });
  });

  describe('referral, kinds and details', () => {
    it('applies with "An MLOps MENA member" and the member\'s name, which the team sees', async () => {
      const s = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'ref', coreComplete: false });
      const missing = await http().put('/api/speaker/application').set('Cookie', s.cookie).send(application({ referralSource: 'MLOPS_MENA_MEMBER' })).expect(400);
      expect(missing.body.errors.map((e: { path: string }) => e.path)).toEqual(['referralMemberName']);
      await http().put('/api/speaker/application').set('Cookie', s.cookie).send(application({ referralSource: undefined })).expect(400);
      const res = await http()
        .put('/api/speaker/application')
        .set('Cookie', s.cookie)
        .send(application({ referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: 'Layla Member', kind: 'PODCAST', format: 'PODCAST', githubUrl: '', details: { podcast: { host: 'Host Person', guests: [{ name: 'Sara' }] }, course: { modulesCount: 4 } } }))
        .expect(200);
      expect(res.body).toMatchObject({ referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: 'Layla Member', kind: 'PODCAST', format: 'PODCAST', githubUrl: null, details: { podcast: { host: 'Host Person', guests: [{ name: 'Sara' }] } } });
      expect(res.body.details).not.toHaveProperty('course');
      const seen = await http().get(`/api/admin/speaker-applications/${res.body.id}`).set('Cookie', admin.cookie).expect(200);
      expect(seen.body).toMatchObject({ referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: 'Layla Member', kind: 'PODCAST' });

      // The team corrects it (the decision and the speaker's status don't change).
      const edited = await http()
        .put(`/api/admin/speaker-applications/${res.body.id}`)
        .set('Cookie', admin.cookie)
        .send(application({ referralSource: 'EVENT', referralMemberName: 'Layla Member', kind: 'COURSE', githubUrl: 'https://github.com/mona' }))
        .expect(200);
      expect(edited.body).toMatchObject({ status: 'SUBMITTED', referralSource: 'EVENT', referralMemberName: null, kind: 'COURSE', githubUrl: 'https://github.com/mona' });
      await http().put(`/api/admin/speaker-applications/${res.body.id}`).set('Cookie', s.cookie).send(application()).expect(403);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'speaker_application.updated_by_admin', entityId: res.body.id } });
      expect(JSON.stringify(audit.metadata)).not.toContain('Layla');
    });

    it('books a course with optional details, copies them to the draft, and lets the speaker edit until it is published', async () => {
      const s = await approvedSpeaker('Course giver');
      const slot = await slotAt(new Date(Date.now() + 40 * DAY), 120);
      const details = { audience: 'Data scientists', outcomes: ['Ship a model'], level: 'BEGINNER', course: { modulesCount: 3, modules: [{ title: 'Packaging', description: 'Docker' }], durationWeeks: 3 }, podcast: { host: 'Nobody' } };
      const bad = await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send({ ...booking, kind: 'COURSE', details: { course: { materialsUrl: 'ftp://x' } } }).expect(400);
      expect(bad.body.errors[0].path).toBe('details.course.materialsUrl');
      const res = await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send({ ...booking, kind: 'COURSE', details }).expect(201);
      expect(res.body).toMatchObject({ kind: 'COURSE', canEdit: true, abstract: booking.abstract, details: { audience: 'Data scientists', course: { modulesCount: 3 } } });
      expect(res.body.details).not.toHaveProperty('podcast');
      const saved = await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { event: true } });
      expect(saved.kind).toBe('COURSE');
      // A label on the session, never a real course.
      expect(saved.event).toMatchObject({ status: 'DRAFT', titleEn: booking.title, durationMin: 120, details: { kind: 'COURSE', details: { level: 'BEGINNER' } } });

      // Every detail is optional; the speaker edits while it is a draft.
      const edit = { title: 'Shipping models, a course', abstract: booking.abstract, kind: 'COURSE', details: { audience: 'Everyone' } };
      const other = await approvedSpeaker('Someone else');
      await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', other.cookie).send(edit).expect(404);
      const edited = await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(edit).expect(200);
      expect(edited.body).toMatchObject({ title: edit.title, details: { audience: 'Everyone' } });
      expect(await prisma.liveEvent.findUniqueOrThrow({ where: { id: saved.eventId! } })).toMatchObject({ titleEn: edit.title, details: { kind: 'COURSE', details: { audience: 'Everyone' } } });

      // Published: the speaker can't change it any more; the team can (details only on the session).
      await prisma.liveEvent.update({ where: { id: saved.eventId! }, data: { status: 'PUBLISHED', titleAr: 'دورة', liveUrl: 'https://meet.google.com/x' } });
      const locked = await http().put(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(edit).expect(409);
      expect(locked.body.code).toBe('BOOKING_LOCKED');
      const portal = await http().get('/api/speaker').set('Cookie', s.cookie).expect(200);
      expect(portal.body.bookings.find((b: { slotId: string }) => b.slotId === slot.id).canEdit).toBe(false);
      await http().put(`/api/admin/speaking-slots/${slot.id}/booking`).set('Cookie', s.cookie).send(edit).expect(403);
      await http()
        .put(`/api/admin/speaking-slots/${slot.id}/booking`)
        .set('Cookie', admin.cookie)
        .send({ ...edit, title: 'Changed by the team', details: { audience: 'Engineers', prerequisites: 'Python', course: { modulesCount: 4 } } })
        .expect(200);
      const event = await prisma.liveEvent.findUniqueOrThrow({ where: { id: saved.eventId! } });
      expect(event.titleEn).toBe(edit.title); // a published title is edited on the session itself
      // The public page shows what is filled, nothing empty.
      const pub = await http().get(`/api/events/${event.slug}`).expect(200);
      expect(pub.body).toMatchObject({ kind: 'COURSE', details: { audience: 'Engineers', prerequisites: 'Python', course: { modulesCount: 4 } } });
      expect(pub.body.details).not.toHaveProperty('outcomes');
    });

    it('lets the team edit details on the session, and keeps them when an old client leaves them out', async () => {
      const event = await prisma.liveEvent.create({ data: { slug: `details-${Date.now()}`, status: 'DRAFT', titleEn: 'Panel', startsAt: new Date(Date.now() + 50 * DAY) } });
      const base = { slug: event.slug, status: 'DRAFT', titleEn: 'Panel', startsAt: event.startsAt.toISOString(), durationMin: 60, language: 'EN', platform: 'GOOGLE_MEET' };
      await http().put(`/api/admin/events/${event.id}`).set('Cookie', admin.cookie).send({ ...base, details: { kind: 'PODCAST', details: { podcast: { guests: [{ name: 'Sara', linkedinUrl: 'https://twitter.com/s' }] } } } }).expect(400);
      await http().put(`/api/admin/events/${event.id}`).set('Cookie', admin.cookie).send({ ...base, details: { kind: 'PODCAST', details: { podcast: { episodeFormat: 'PANEL', guests: [{ name: 'Sara' }] } } } }).expect(200);
      await http().put(`/api/admin/events/${event.id}`).set('Cookie', admin.cookie).send(base).expect(200);
      expect((await prisma.liveEvent.findUniqueOrThrow({ where: { id: event.id } })).details).toEqual({ kind: 'PODCAST', details: { podcast: { episodeFormat: 'PANEL', guests: [{ name: 'Sara' }] } } });
    });

    it('answers a failed booking with a code and a message, never a bare 500, and books nothing', async () => {
      const s = await approvedSpeaker('Unlucky');
      const slot = await slotAt(new Date(Date.now() + 45 * DAY), 120);
      const spy = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Transaction already closed', { code: 'P2028', clientVersion: 'test' }));
      const busy = await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(503);
      expect(busy.body).toMatchObject({ code: 'BOOKING_BUSY', message: expect.stringContaining('nothing was booked') });
      spy.mockRejectedValueOnce(new Error('boom'));
      const failed = await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(503);
      expect(failed.body.code).toBe('BOOKING_FAILED');
      spy.mockRestore();
      expect((await prisma.speakingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('OPEN');
      // A failure after the booking is saved (telling the team) doesn't turn it into an error.
      const notify = jest.spyOn(app.get(NotificationsService), 'notifyAdmins').mockRejectedValueOnce(new Error('down'));
      await http().post(`/api/speaker/slots/${slot.id}/booking`).set('Cookie', s.cookie).send(booking).expect(201);
      notify.mockRestore();
    });
  });

  describe('settings', () => {
    it('validates the session team list and keeps it out of the public settings', async () => {
      await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ sessionTeamEmails: ['ok@example.test', 'not-an-email'] }).expect(400);
      await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ sessionTeamEmails: ['a@example.test', 'A@example.test'] }).expect(400);
      const pub = await http().get('/api/settings/public').expect(200);
      expect(JSON.stringify(pub.body)).not.toContain('team-a@');
      expect(Object.keys(pub.body)).toEqual(['supportEmail', 'supportWhatsapp']);
    });
  });
});
