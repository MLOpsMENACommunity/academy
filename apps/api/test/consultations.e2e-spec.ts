import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AdminCoursesService } from '../src/admin/admin-courses.service';
import { ConsultationJobs } from '../src/consultations/consultations.jobs';
import { GoogleCalendar, GoogleCalendarExpired } from '../src/consultations/google-calendar';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/users/account.service';
import { createTestApp, createUser } from './helpers';

const HOUR = 3_600_000;
const ALL_WEEK = Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' }));
/** A tiny PNG (the upload checks the file's signature, not its name). */
const png = (salt = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`consultation-proof-${salt}-${Math.random()}`)]);

/**
 * Consultations, pay first then book: the student sees an expert's open times, pays and uploads
 * the transfer screenshot; FINANCE approves (the student is told to book) or rejects it; the
 * student books an open time and both sides get the link. No refunds: a booked call can move
 * once. Plus Google Calendar, reminders, retention, deleted accounts and who may do what.
 */
describe('consultations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { id: string; cookie: string };
  let finance: { id: string; cookie: string };
  let speakersTeam: { id: string; cookie: string };
  let content: { id: string; cookie: string };
  let expert: { id: string; cookie: string; instructorId: string; slug: string };
  let previous: Record<string, unknown>;
  const http = () => request(app.getHttpServer());
  const emails = (prefix: string) => prisma.outboundEmail.findMany({ where: { dedupeKey: { startsWith: prefix } } });

  const settings = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    price30Egp: 400,
    price60Egp: 700,
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    timezone: 'UTC',
    minNoticeHours: 3,
    horizonDays: 7,
    availability: ALL_WEEK,
    ...over,
  });
  const slots = async (slug = expert.slug, duration = 30): Promise<string[]> => (await http().get(`/api/consultations/experts/${slug}/slots?duration=${duration}`).expect(200)).body;
  const pay = (cookie: string, opts: { slug?: string; durationMin?: string; method?: string; ref?: string; file?: Buffer | null } = {}) => {
    const r = http()
      .post(`/api/consultations/experts/${opts.slug ?? expert.slug}/purchases`)
      .set('Cookie', cookie)
      .field('durationMin', opts.durationMin ?? '30')
      .field('method', opts.method ?? 'INSTAPAY')
      .field('transactionRef', opts.ref ?? '')
      .field('note', 'Feature store design review');
    return opts.file === null ? r : r.attach('screenshot', opts.file ?? png(), 'proof.png');
  };
  const approve = (id: string, cookie = finance.cookie) => http().post(`/api/admin/consultations/bookings/${id}/approve`).set('Cookie', cookie);
  /** A student with a paid (approved) call, ready to book. */
  async function paidCall(prefix: string, slug = expert.slug): Promise<{ student: { id: string; email: string; cookie: string }; id: string }> {
    const student = await createUser(app, prisma, { prefix });
    const id = (await pay(student.cookie, { slug }).expect(201)).body.id as string;
    await approve(id).expect(200);
    return { student, id };
  }
  const bookTime = (cookie: string, id: string, startsAt: string) => http().post(`/api/consultations/bookings/${id}/book`).set('Cookie', cookie).send({ startsAt });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createUser(app, prisma, { role: 'ADMIN', prefix: 'cons-admin' });
    finance = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['FINANCE'], prefix: 'cons-fin' });
    speakersTeam = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['SPEAKERS'], prefix: 'cons-spk-team' });
    content = await createUser(app, prisma, { role: 'ADMIN', adminPermissions: ['CONTENT'], prefix: 'cons-content' });
    const u = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-expert' });
    const slug = `cons-expert-${Date.now()}`;
    const i = await prisma.instructor.create({ data: { slug, name: 'Sameh Expert', titleEn: 'Principal ML Engineer', bioEn: 'Builds ML platforms.', userId: u.id } });
    expert = { ...u, instructorId: i.id, slug };
    previous = (await http().get('/api/admin/settings').set('Cookie', admin.cookie).expect(200)).body;
    await http()
      .put('/api/admin/settings')
      .set('Cookie', admin.cookie)
      .send({ instapayHandle: 'academy@instapay', instapayName: 'MLOps MENA', orangeCashNumber: '01200000000', orangeCashName: 'Academy', supportWhatsapp: '+20 100 123 4567' })
      .expect(200);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
  });

  afterAll(async () => {
    const { instapayHandle, instapayName, orangeCashNumber, orangeCashName, supportWhatsapp } = previous;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ instapayHandle, instapayName, orangeCashNumber, orangeCashName, supportWhatsapp }).expect(200);
    await app.close();
  });

  it('lists a speaker only once the speakers team enables them with a price and a link', async () => {
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(400);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', finance.cookie).send(settings()).expect(403);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings({ enabled: false })).expect(200);
    expect(((await http().get('/api/consultations/experts').expect(200)).body as { slug: string }[]).map((e) => e.slug)).not.toContain(expert.slug);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    const list = (await http().get('/api/consultations/experts').expect(200)).body as { slug: string }[];
    expect(list.find((e) => e.slug === expert.slug)).toMatchObject({ name: 'Sameh Expert', price30Egp: 400, price60Egp: 700 });
    expect((await http().get(`/api/consultations/experts/${expert.slug}`).expect(200)).body).not.toHaveProperty('meetingUrl');
    // A save that leaves out the weekly hours is refused, not taken as "no hours".
    const { availability: _hours, ...noHours } = settings();
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(noHours).expect(400);
  });

  it('shows the open times and how to pay before paying; paying uploads the proof for review', async () => {
    const before = await slots();
    expect(before.length).toBeGreaterThan(10);
    const student = await createUser(app, prisma, { prefix: 'cons-pay' });
    expect((await http().get('/api/consultations/payment').set('Cookie', student.cookie).expect(200)).body).toEqual({
      methods: [
        { kind: 'INSTAPAY', handle: 'academy@instapay', name: 'MLOps MENA' },
        { kind: 'ORANGE_CASH', handle: '01200000000', name: 'Academy' },
      ],
      supportWhatsapp: '+20 100 123 4567',
    });

    expect((await pay(student.cookie, { file: null }).expect(400)).body.code).toBe('FILE_REQUIRED');
    expect((await pay(student.cookie, { method: 'VODAFONE_CASH' }).expect(400)).body.code).toBe('METHOD_NOT_AVAILABLE');
    expect((await pay(student.cookie, { file: Buffer.from('not an image') }).expect(400)).body.code).toBe('FILE_TYPE');
    const unverified = await createUser(app, prisma, { verified: false, prefix: 'cons-unv' });
    await pay(unverified.cookie).expect(403);

    const res = await pay(student.cookie, { method: 'ORANGE_CASH', ref: 'TX-123' }).expect(201);
    expect(res.body).toMatchObject({ status: 'PAYMENT_REVIEW', priceEgp: 400, method: 'ORANGE_CASH', transactionRef: 'TX-123', startsAt: null, meetingUrl: null, canBook: false });
    expect(res.body.reference).toMatch(/^C-[A-Z2-9]{6}$/);
    expect(await emails(`consultation-received:${res.body.id}`)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: finance.id, type: 'consultation.payment' } })).toBeGreaterThan(0);
    // Nothing is held before the call is paid and booked.
    expect(await slots()).toEqual(before);
    // Only their own.
    const other = await createUser(app, prisma, { prefix: 'cons-other' });
    await http().get(`/api/consultations/bookings/${res.body.id}`).set('Cookie', other.cookie).expect(404);
    // At most 3 unbooked calls at a time (another student: uploads are also limited to 5 a minute).
    const keen = await createUser(app, prisma, { prefix: 'cons-keen' });
    for (let i = 0; i < 3; i++) await pay(keen.cookie).expect(201);
    expect((await pay(keen.cookie).expect(409)).body.code).toBe('TOO_MANY_UNBOOKED');
  });

  it('FINANCE reviews the proof: rejects with a reason, or approves and the student is told to book', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-review' });
    const proof = png('reused');
    const a = (await pay(student.cookie, { file: proof, ref: 'REF-77' }).expect(201)).body;
    const b = (await pay(student.cookie, { file: proof }).expect(201)).body;

    await http().get('/api/admin/consultations/bookings').set('Cookie', content.cookie).expect(403);
    await approve(a.id, speakersTeam.cookie).expect(403);
    const queue = (await http().get('/api/admin/consultations/bookings?status=PAYMENT_REVIEW').set('Cookie', finance.cookie).expect(200)).body as {
      id: string;
      sameProofAs: string[];
      student: { email: string };
    }[];
    const row = queue.find((x) => x.id === b.id)!;
    expect(row.sameProofAs).toEqual([a.reference]);
    expect(row.student.email).toBe(student.email);
    const shot = (await http().get(`/api/admin/consultations/bookings/${a.id}/screenshot`).set('Cookie', finance.cookie).expect(200)).body;
    expect(shot).toMatchObject({ mime: 'image/png' });
    expect(await prisma.auditLog.count({ where: { action: 'consultation.screenshot_viewed', entityId: a.id } })).toBe(1);

    await http().post(`/api/admin/consultations/bookings/${b.id}/reject`).set('Cookie', finance.cookie).send({ reason: '' }).expect(400);
    const rejected = (await http().post(`/api/admin/consultations/bookings/${b.id}/reject`).set('Cookie', finance.cookie).send({ reason: 'The same screenshot as another booking' }).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'The same screenshot as another booking' });
    expect(await emails(`consultation-rejected:${b.id}`)).toHaveLength(1);

    expect((await approve(a.id).expect(200)).body).toMatchObject({ status: 'PAID' });
    await approve(a.id).expect(409);
    expect(await emails(`consultation-approved:${a.id}`)).toHaveLength(1);
    expect(await prisma.notification.findFirst({ where: { userId: student.id, type: 'consultation.paid' } })).toMatchObject({ link: `/consultations/bookings/${a.id}` });
    expect((await http().get(`/api/consultations/bookings/${a.id}`).set('Cookie', student.cookie).expect(200)).body).toMatchObject({ status: 'PAID', canBook: true });

    // An admin's own payment is reviewed by someone else.
    const own = (await pay(finance.cookie).expect(201)).body;
    expect((await approve(own.id).expect(403)).body.code).toBe('OWN_BOOKING');
  });

  it('books a time once the payment is approved; both sides get the link and a calendar file', async () => {
    const pending = await createUser(app, prisma, { prefix: 'cons-notyet' });
    const p = (await pay(pending.cookie).expect(201)).body;
    expect((await bookTime(pending.cookie, p.id, (await slots())[0]!).expect(409)).body.code).toBe('NOT_PAID');

    const { student, id } = await paidCall('cons-book');
    const mine = (await http().get(`/api/consultations/bookings/${id}/slots`).set('Cookie', student.cookie).expect(200)).body as string[];
    const at = mine[2]!;
    await bookTime(student.cookie, id, new Date(Date.now() + 5 * HOUR + 7 * 60_000).toISOString()).expect(409);
    const booked = (await bookTime(student.cookie, id, at).expect(200)).body;
    expect(booked).toMatchObject({ status: 'CONFIRMED', startsAt: at, meetingUrl: 'https://meet.google.com/abc-defg-hij', canBook: false });
    expect((await emails(`consultation-confirmed:${id}:`)).map((e) => e.dedupeKey).sort()).toEqual([`consultation-confirmed:${id}:expert`, `consultation-confirmed:${id}:student`]);
    expect(await slots()).not.toContain(at);
    await bookTime(student.cookie, id, mine[5]!).expect(409);

    for (const cookie of [student.cookie, expert.cookie]) {
      const ics = await http().get(`/api/consultations/bookings/${id}/calendar.ics`).set('Cookie', cookie).expect(200);
      expect(ics.text).toContain('BEGIN:VEVENT');
      expect(ics.text).not.toContain('meet.google.com');
    }
    // The expert sees who and why, never the student's email or the payment proof.
    const overview = (await http().get('/api/consultations/expert').set('Cookie', expert.cookie).expect(200)).body;
    expect(overview.bookings.find((x: { id: string }) => x.id === id)).toMatchObject({ note: 'Feature store design review', transactionRef: '', student: { name: 'Test Person', email: null } });
    await http().get('/api/consultations/expert').set('Cookie', student.cookie).expect(404);
  });

  it('gives a time to exactly one of two paid students booking at once', async () => {
    const [a, b] = await Promise.all([paidCall('cons-race1'), paidCall('cons-race2')]);
    const at = (await slots())[3]!;
    const results = await Promise.all([bookTime(a.student.cookie, a.id, at), bookTime(b.student.cookie, b.id, at)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('has no refunds for the student but lets a booked call move once, 24 hours ahead; expert or academy cancelling is refunded', async () => {
    const { student, id } = await paidCall('cons-move');
    const later = (await slots()).find((s) => new Date(s).getTime() > Date.now() + 30 * HOUR)!;
    await bookTime(student.cookie, id, later).expect(200);
    await http().post(`/api/consultations/bookings/${id}/cancel`).set('Cookie', student.cookie).send({}).expect(404);
    expect((await http().get(`/api/consultations/bookings/${id}`).set('Cookie', student.cookie).expect(200)).body).toMatchObject({ canReschedule: true, canCancel: false });
    const newTime = (await slots()).find((s) => new Date(s).getTime() > new Date(later).getTime() + 2 * HOUR)!;
    const moved = (await http().post(`/api/consultations/bookings/${id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: newTime }).expect(200)).body;
    expect(moved).toMatchObject({ startsAt: newTime, rescheduleCount: 1, canReschedule: false });
    expect((await emails(`consultation-moved:${id}:`)).length).toBe(2);
    expect(await slots()).toContain(later);
    const again = (await slots()).find((s) => new Date(s).getTime() > Date.now() + 30 * HOUR)!;
    expect((await http().post(`/api/consultations/bookings/${id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: again }).expect(409)).body.code).toBe('CANNOT_RESCHEDULE');

    await http().post(`/api/consultations/expert/bookings/${id}/cancel`).set('Cookie', expert.cookie).send({ reason: 'Travelling' }).expect(200);
    expect((await emails(`consultation-cancelled:${id}:student`))[0]?.template).toMatchObject({ by: 'expert', wasPaid: true });
    // The academy cancels a paid call that has no time yet.
    const unbooked = await paidCall('cons-unbooked');
    expect((await http().post(`/api/admin/consultations/bookings/${unbooked.id}/cancel`).set('Cookie', finance.cookie).send({ reason: 'Expert unavailable' }).expect(200)).body).toMatchObject({ status: 'CANCELLED' });
  });

  it('with Google Calendar: busy times hide slots, booking makes a Meet event, moving and cancelling update it, expiry falls back', async () => {
    const google = app.get(GoogleCalendar);
    const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.events'];
    jest.spyOn(google, 'isEnabled').mockReturnValue(true);
    jest.spyOn(google, 'exchange').mockResolvedValue({ refreshToken: 'refresh-1', email: 'expert@gmail.com', scopes });
    jest.spyOn(google, 'revoke').mockResolvedValue();
    const busy = jest.spyOn(google, 'busy').mockResolvedValue([]);
    const create = jest.spyOn(google, 'createEvent').mockResolvedValue({ eventId: 'ev-1', meetUrl: 'https://meet.google.com/new-call-abc' });
    const move = jest.spyOn(google, 'moveEvent').mockResolvedValue();
    const remove = jest.spyOn(google, 'deleteEvent').mockResolvedValue();
    try {
      const u = await createUser(app, prisma, { role: 'ADMIN', prefix: 'cons-gexpert' });
      const slugG = `cons-google-${Date.now()}`;
      const ig = await prisma.instructor.create({ data: { slug: slugG, name: 'Google Expert', titleEn: 'ML Lead', bioEn: 'Ships models.', userId: u.id } });
      expect((await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(400)).body.code).toBe('LINK_OR_GOOGLE_NEEDED');
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '', enabled: false })).expect(200);

      // An admin account can be an expert: the expert page is for whoever owns the profile.
      const { url } = (await http().post('/api/consultations/expert/google/connect').set('Cookie', u.cookie).expect(200)).body;
      const state = new URL(url).searchParams.get('state')!;
      const stranger = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-gstranger' });
      await prisma.instructor.create({ data: { slug: `cons-gs-${Date.now()}`, name: 'Other', titleEn: 'x', bioEn: 'x', userId: stranger.id, consultant: { create: {} } } });
      expect((await http().get(`/api/consultations/google/callback?code=c&state=${encodeURIComponent(state)}`).set('Cookie', stranger.cookie).expect(303)).headers.location).toMatch(/google=failed$/);
      expect((await http().get(`/api/consultations/google/callback?code=c&state=${encodeURIComponent(state)}`).set('Cookie', u.cookie).expect(303)).headers.location).toMatch(
        /\/consultations\/expert\?google=connected$/,
      );
      const stored = await prisma.consultantProfile.findUniqueOrThrow({ where: { instructorId: ig.id } });
      expect(stored.googleRefreshToken).not.toContain('refresh-1');
      expect((await http().get('/api/consultations/expert').set('Cookie', u.cookie).expect(200)).body.google).toMatchObject({ available: true, connected: true, email: 'expert@gmail.com', error: null });
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(200);

      // Busy in Google: those times disappear (and are refused when booking).
      const first = (await slots(slugG))[0]!;
      busy.mockResolvedValue([{ startsAt: new Date(first), endsAt: new Date(new Date(first).getTime() + HOUR) }]);
      const { student, id } = await paidCall('cons-gstudent', slugG);
      expect((await bookTime(student.cookie, id, first).expect(409)).body.code).toBe('SLOT_TAKEN');
      busy.mockResolvedValue([]);

      const at = (await slots(slugG)).find((x) => new Date(x).getTime() > Date.now() + 30 * HOUR)!;
      expect((await bookTime(student.cookie, id, at).expect(200)).body.meetingUrl).toBe('https://meet.google.com/new-call-abc');
      expect(create).toHaveBeenCalledWith('refresh-1', expect.objectContaining({ attendeeEmail: student.email, start: new Date(at) }));
      const to = (await slots(slugG)).find((x) => new Date(x).getTime() > new Date(at).getTime() + 2 * HOUR)!;
      await http().post(`/api/consultations/bookings/${id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: to }).expect(200);
      expect(move).toHaveBeenCalledWith('refresh-1', 'ev-1', new Date(to), new Date(new Date(to).getTime() + 30 * 60_000));
      await http().post(`/api/consultations/expert/bookings/${id}/cancel`).set('Cookie', u.cookie).send({}).expect(200);
      expect(remove).toHaveBeenCalledWith('refresh-1', 'ev-1');

      // The connection expires: times still load, the expert is told once, and booking needs a fixed link.
      busy.mockRejectedValue(new GoogleCalendarExpired());
      const second = await paidCall('cons-gstudent2', slugG);
      const at2 = (await slots(slugG))[5]!;
      expect((await prisma.consultantProfile.findUniqueOrThrow({ where: { instructorId: ig.id } })).googleError).toBe('EXPIRED');
      expect(await emails(`consultation-google-expired:${stored.id}:`)).toHaveLength(1);
      expect((await bookTime(second.student.cookie, second.id, at2).expect(409)).body.code).toBe('NO_MEETING_LINK');
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
      expect((await bookTime(second.student.cookie, second.id, at2).expect(200)).body.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
      expect((await http().delete('/api/consultations/expert/google').set('Cookie', u.cookie).expect(200)).body).toMatchObject({ connected: false });
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('reminds both sides once, a day ahead, and deletes old screenshots (keeping the record)', async () => {
    const { student, id } = await paidCall('cons-remind');
    await bookTime(student.cookie, id, (await slots())[30]!).expect(200);
    const start = new Date(Date.now() + 23 * HOUR);
    await prisma.consultationBooking.update({ where: { id }, data: { startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000) } });
    const jobs = app.get(ConsultationJobs);
    // Just booked: the confirmation went out, no "tomorrow" email on top.
    await jobs.run();
    expect(await emails(`consultation-reminder24:${id}:`)).toHaveLength(0);
    // Booked 3 hours ago (an explicit updatedAt is kept by Prisma).
    await prisma.consultationBooking.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 3 * HOUR) } });
    await jobs.run();
    await jobs.run();
    expect((await emails(`consultation-reminder24:${id}:`)).length).toBe(2);

    await prisma.consultationBooking.update({ where: { id }, data: { createdAt: new Date(Date.now() - 400 * 24 * HOUR) } });
    expect((await jobs.run()).consultationScreenshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.consultationBooking.findUniqueOrThrow({ where: { id } })).toMatchObject({ screenshotKey: null, status: 'CONFIRMED' });
    await http().get(`/api/admin/consultations/bookings/${id}/screenshot`).set('Cookie', finance.cookie).expect(404);
  });

  it('closing an account cancels its calls (the other side told), exports them, and anonymisation drops the proof', async () => {
    const { student, id } = await paidCall('cons-closed');
    await bookTime(student.cookie, id, (await slots())[50]!).expect(200);
    const pendingId = (await pay(student.cookie).expect(201)).body.id as string;
    const exp = (await http().get('/api/me/export').set('Cookie', student.cookie).expect(200)).body;
    expect(exp.consultations.map((c: { status: string }) => c.status).sort()).toEqual(['CONFIRMED', 'PAYMENT_REVIEW']);

    await app.get(AccountService).deleteByAdmin(student.id, student.email, admin.id);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('CANCELLED');
    expect(await emails(`consultation-cancelled:${id}:expert`)).toHaveLength(1);
    await app.get(AccountService).anonymize(student.id);
    expect(await prisma.consultationBooking.findUniqueOrThrow({ where: { id: pendingId } })).toMatchObject({ note: '', transactionRef: '', screenshotKey: null });

    // An expert closing their account: unlisted, their calls cancelled and the students told.
    const u = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-leaving' });
    const slug3 = `cons-leaving-${Date.now()}`;
    const i3 = await prisma.instructor.create({ data: { slug: slug3, name: 'Leaving Expert', titleEn: 'ML Lead', bioEn: 'Ships models.', userId: u.id } });
    await http().put(`/api/admin/consultations/experts/${i3.id}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    const c = await paidCall('cons-orphan', slug3);
    // A profile with bookings can't be deleted (they're kept for accounting).
    await expect(app.get(AdminCoursesService).deleteInstructor(i3.id, 'Leaving Expert', { id: admin.id, role: 'ADMIN' })).rejects.toMatchObject({ status: 409 });
    await app.get(AccountService).deleteByAdmin(u.id, u.email, admin.id);
    await http().get(`/api/consultations/experts/${slug3}`).expect(404);
    expect(await prisma.consultationBooking.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'CANCELLED', cancelledBy: 'expert' });
    expect(await emails(`consultation-cancelled:${c.id}:student`)).toHaveLength(1);
  });
});
