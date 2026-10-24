import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ConsultationJobs } from '../src/consultations/consultations.jobs';
import { GoogleCalendar, GoogleCalendarExpired } from '../src/consultations/google-calendar';
import { AdminCoursesService } from '../src/admin/admin-courses.service';
import { AccountService } from '../src/users/account.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser } from './helpers';

const HOUR = 3_600_000;
const ALL_WEEK = Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' }));

/**
 * Consultations: an admin lists a speaker as an expert; a student reserves an open slot (held
 * while they pay by InstaPay); finance marks it paid and both sides get the meeting link;
 * cancellations, lapsed holds, reminders, and who may do what.
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
  const slots = async (duration = 30): Promise<string[]> => (await http().get(`/api/consultations/experts/${expert.slug}/slots?duration=${duration}`).expect(200)).body;
  const book = (cookie: string, startsAt: string, durationMin = 30) =>
    http().post(`/api/consultations/experts/${expert.slug}/bookings`).set('Cookie', cookie).send({ durationMin, startsAt, note: 'Feature store design review' });

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
  });

  afterAll(async () => {
    const { instapayHandle, instapayName, orangeCashNumber, orangeCashName, supportWhatsapp } = previous;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ instapayHandle, instapayName, orangeCashNumber, orangeCashName, supportWhatsapp }).expect(200);
    await app.close();
  });

  it('lists a speaker only once the speakers team enables them with a link and a price', async () => {
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(400);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', finance.cookie).send(settings()).expect(403);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings({ enabled: false })).expect(200);
    let list = (await http().get('/api/consultations/experts').expect(200)).body as { slug: string }[];
    expect(list.map((e) => e.slug)).not.toContain(expert.slug);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    list = (await http().get('/api/consultations/experts').expect(200)).body;
    expect(list.find((e) => e.slug === expert.slug)).toMatchObject({ name: 'Sameh Expert', price30Egp: 400, price60Egp: 700 });
    const detail = (await http().get(`/api/consultations/experts/${expert.slug}`).expect(200)).body;
    expect(detail).not.toHaveProperty('meetingUrl');
    const rows = (await http().get('/api/admin/consultations/experts').set('Cookie', speakersTeam.cookie).expect(200)).body as { instructorId: string; settings: unknown }[];
    expect(rows.find((r) => r.instructorId === expert.instructorId)?.settings).toMatchObject({ enabled: true });
  });

  it('reserves a slot, shows how to pay, and holds it against everyone else', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-stu' });
    const other = await createUser(app, prisma, { prefix: 'cons-stu2' });
    const open = await slots();
    expect(open.length).toBeGreaterThan(10);
    const at = open[0]!;
    expect(new Date(at).getTime()).toBeGreaterThanOrEqual(Date.now() + 3 * HOUR - 60_000);

    const res = await book(student.cookie, at).expect(201);
    expect(res.body).toMatchObject({
      status: 'AWAITING_PAYMENT',
      priceEgp: 400,
      durationMin: 30,
      meetingUrl: null,
      canCancel: true,
      payment: { supportWhatsapp: '+20 100 123 4567' },
    });
    expect(res.body.reference).toMatch(/^C-[A-Z2-9]{6}$/);
    expect(res.body.payment.methods).toEqual([{ kind: 'INSTAPAY', handle: 'academy@instapay', name: 'MLOps MENA' }, { kind: 'ORANGE_CASH', handle: '01200000000', name: 'Academy' }]);
    expect(new Date(res.body.holdUntil).getTime()).toBeLessThanOrEqual(new Date(at).getTime() - 2 * HOUR);
    expect(await emails(`consultation-reserved:${res.body.id}`)).toHaveLength(1);

    await book(other.cookie, at).expect(409);
    // A 60-minute call starting half an hour earlier would overlap it too.
    const before = new Date(new Date(at).getTime() - 30 * 60_000).toISOString();
    if ((await slots(60)).includes(before)) throw new Error('an overlapping 60-minute slot is still offered');
    expect(await slots()).not.toContain(at);

    // Their own booking only.
    await http().get(`/api/consultations/bookings/${res.body.id}`).set('Cookie', other.cookie).expect(404);
    const mine = (await http().get('/api/consultations/bookings').set('Cookie', student.cookie).expect(200)).body as { id: string }[];
    expect(mine.map((b) => b.id)).toEqual([res.body.id]);
  });

  it('gives a slot to exactly one of two students booking at once', async () => {
    const [a, b] = await Promise.all([createUser(app, prisma, { prefix: 'cons-race1' }), createUser(app, prisma, { prefix: 'cons-race2' })]);
    const at = (await slots())[3]!;
    const results = await Promise.all([book(a.cookie, at), book(b.cookie, at)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('refuses unverified accounts, unknown times, call lengths not offered, and a third unpaid hold', async () => {
    const unverified = await createUser(app, prisma, { verified: false, prefix: 'cons-unv' });
    const open = await slots();
    await book(unverified.cookie, open[5]!).expect(403);
    const student = await createUser(app, prisma, { prefix: 'cons-hoard' });
    await book(student.cookie, new Date(Date.now() + 5 * HOUR + 7 * 60_000).toISOString()).expect(409);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings({ price60Egp: null })).expect(200);
    await book(student.cookie, open[5]!, 60).expect(400);
    expect(await slots(60)).toEqual([]);
    await http().put(`/api/admin/consultations/experts/${expert.instructorId}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    await book(student.cookie, open[5]!).expect(201);
    await book(student.cookie, open[6]!).expect(201);
    const third = await book(student.cookie, open[7]!).expect(409);
    expect(third.body.code).toBe('TOO_MANY_HOLDS');
  });

  it('confirms on payment: the link goes to both sides, with a calendar file', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-paid' });
    const at = (await slots())[10]!;
    const b = (await book(student.cookie, at).expect(201)).body;

    await http().get('/api/admin/consultations/bookings').set('Cookie', content.cookie).expect(403);
    await http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', speakersTeam.cookie).expect(403);
    const waiting = (await http().get('/api/admin/consultations/bookings?status=AWAITING_PAYMENT').set('Cookie', finance.cookie).expect(200)).body as { id: string }[];
    expect(waiting.map((x) => x.id)).toContain(b.id);

    const paid = await http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', finance.cookie).expect(200);
    expect(paid.body).toMatchObject({ status: 'CONFIRMED', meetingUrl: 'https://meet.google.com/abc-defg-hij', student: { id: student.id } });
    await http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', finance.cookie).expect(409);

    const seen = (await http().get(`/api/consultations/bookings/${b.id}`).set('Cookie', student.cookie).expect(200)).body;
    expect(seen).toMatchObject({ status: 'CONFIRMED', meetingUrl: 'https://meet.google.com/abc-defg-hij', payment: null, holdUntil: null });
    expect((await emails(`consultation-confirmed:${b.id}:`)).map((e) => e.dedupeKey).sort()).toEqual([
      `consultation-confirmed:${b.id}:expert`,
      `consultation-confirmed:${b.id}:student`,
    ]);

    for (const cookie of [student.cookie, expert.cookie]) {
      const ics = await http().get(`/api/consultations/bookings/${b.id}/calendar.ics`).set('Cookie', cookie).expect(200);
      expect(ics.text).toContain('BEGIN:VEVENT');
      expect(ics.text).not.toContain('meet.google.com');
    }
    const stranger = await createUser(app, prisma, { prefix: 'cons-stranger' });
    await http().get(`/api/consultations/bookings/${b.id}/calendar.ics`).set('Cookie', stranger.cookie).expect(404);

    // The expert sees who booked and what they want to talk about, never the student's email.
    const overview = (await http().get('/api/consultations/expert').set('Cookie', expert.cookie).expect(200)).body;
    expect(overview.bookings.find((x: { id: string }) => x.id === b.id)).toMatchObject({ note: 'Feature store design review', student: { name: 'Test Person', email: null } });
    // Not an expert: no expert page (whatever the role).
    await http().get('/api/consultations/expert').set('Cookie', student.cookie).expect(404);

    // No refunds: a paid call can't be cancelled by the student, but it can be moved once, 24 h ahead.
    const later = (await slots()).find((s) => new Date(s).getTime() > Date.now() + 30 * HOUR)!;
    const c = (await book(student.cookie, later).expect(201)).body;
    await http().post(`/api/admin/consultations/bookings/${c.id}/paid`).set('Cookie', finance.cookie).expect(200);
    expect((await http().post(`/api/consultations/bookings/${c.id}/cancel`).set('Cookie', student.cookie).send({}).expect(409)).body.code).toBe('CANNOT_CANCEL');
    const seenPaid = (await http().get(`/api/consultations/bookings/${c.id}`).set('Cookie', student.cookie).expect(200)).body;
    expect(seenPaid).toMatchObject({ canCancel: false, canReschedule: true, rescheduleCount: 0 });
    const newTime = (await slots()).find((s) => new Date(s).getTime() > new Date(later).getTime() + 2 * HOUR)!;
    const moved = (await http().post(`/api/consultations/bookings/${c.id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: newTime }).expect(200)).body;
    expect(moved).toMatchObject({ status: 'CONFIRMED', startsAt: newTime, rescheduleCount: 1, canReschedule: false, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    expect((await emails(`consultation-moved:${c.id}:`)).length).toBe(2);
    expect(await slots()).toContain(later);
    expect(await slots()).not.toContain(newTime);
    const again = (await slots()).find((s) => new Date(s).getTime() > Date.now() + 30 * HOUR)!;
    expect((await http().post(`/api/consultations/bookings/${c.id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: again }).expect(409)).body.code).toBe('CANNOT_RESCHEDULE');
    // The academy (or the expert) cancelling a paid call: the student is told about the refund.
    await http().post(`/api/admin/consultations/bookings/${c.id}/cancel`).set('Cookie', finance.cookie).send({ reason: 'Expert ill' }).expect(200);
    const refund = await emails(`consultation-cancelled:${c.id}:student`);
    expect(refund[0]?.template).toMatchObject({ by: 'admin', wasPaid: true });
  });

  it('lets the expert keep their hours and link, and cancel an upcoming call', async () => {
    const put = (body: Record<string, unknown>) => http().put('/api/consultations/expert/settings').set('Cookie', expert.cookie).send(body);
    const mine = settings();
    delete (mine as Partial<typeof mine>).enabled;
    await put({ ...mine, meetingUrl: '' }).expect(400);
    const saved = (await put({ ...mine, minNoticeHours: 4 }).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, minNoticeHours: 4 });
    await put(mine).expect(200);

    const student = await createUser(app, prisma, { prefix: 'cons-expcancel' });
    const b = (await book(student.cookie, (await slots())[20]!).expect(201)).body;
    const res = await http().post(`/api/consultations/expert/bookings/${b.id}/cancel`).set('Cookie', expert.cookie).send({ reason: 'Travelling' }).expect(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    const row = await prisma.consultationBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.cancelledBy).toBe('expert');
  });

  it('lapses unpaid holds (the student hears), still confirms a late payment, and sends reminders once', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-lapse' });
    const at = (await slots())[30]!;
    const b = (await book(student.cookie, at).expect(201)).body;
    await prisma.consultationBooking.update({ where: { id: b.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    // Shown as expired, and the slot is free, before the job runs.
    expect((await http().get(`/api/consultations/bookings/${b.id}`).set('Cookie', student.cookie).expect(200)).body.status).toBe('EXPIRED');
    expect(await slots()).toContain(at);

    const jobs = app.get(ConsultationJobs);
    const first = await jobs.run();
    expect(first.consultationHoldsExpired).toBeGreaterThanOrEqual(1);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('EXPIRED');
    expect(await emails(`consultation-expired:${b.id}:student`)).toHaveLength(1);

    // The payment arrived late and nobody took the slot: finance can still confirm it.
    await http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', finance.cookie).expect(200);

    // Reminders: a call 23 hours away gets the "tomorrow" email, for both sides, once; but not
    // right after it was confirmed (that email just went out).
    await prisma.consultationBooking.update({ where: { id: b.id }, data: { startsAt: new Date(Date.now() + 23 * HOUR), endsAt: new Date(Date.now() + 23 * HOUR + 30 * 60_000) } });
    await jobs.run();
    expect(await emails(`consultation-reminder24:${b.id}:`)).toHaveLength(0);
    await prisma.consultationBooking.update({ where: { id: b.id }, data: { paidAt: new Date(Date.now() - 3 * HOUR) } });
    await jobs.run();
    await jobs.run();
    expect((await emails(`consultation-reminder24:${b.id}:`)).length).toBe(2);
  });

  it('a cancel racing "Mark paid" never cancels a paid call inside 24 hours', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-racepay' });
    const b = (await book(student.cookie, (await slots())[1]!).expect(201)).body;
    const [paid, cancelled] = await Promise.all([
      http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', finance.cookie),
      http().post(`/api/consultations/bookings/${b.id}/cancel`).set('Cookie', student.cookie).send({}),
    ]);
    expect([paid.status, cancelled.status].sort()).toEqual([200, 409]);
    const row = await prisma.consultationBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status === 'CONFIRMED' ? paid.status : cancelled.status).toBe(200);
  });

  it('holds at most 2 unpaid reservations across experts, even booked at the same moment', async () => {
    const u = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-expert2' });
    const slug2 = `cons-expert2-${Date.now()}`;
    const i2 = await prisma.instructor.create({ data: { slug: slug2, name: 'Second Expert', titleEn: 'ML Lead', bioEn: 'Ships models.', userId: u.id } });
    await http().put(`/api/admin/consultations/experts/${i2.id}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    const student = await createUser(app, prisma, { prefix: 'cons-twoexperts' });
    await book(student.cookie, (await slots())[12]!).expect(201);
    const other = (await http().get(`/api/consultations/experts/${slug2}/slots?duration=30`).expect(200)).body as string[];
    const [a, b] = await Promise.all([
      book(student.cookie, (await slots())[13]!),
      http().post(`/api/consultations/experts/${slug2}/bookings`).set('Cookie', student.cookie).send({ durationMin: 30, startsAt: other[0], note: '' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('refuses bookings until payment details are set, an admin confirming their own booking, and a call without a link', async () => {
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ instapayHandle: '', orangeCashNumber: '' }).expect(200);
    const s1 = await createUser(app, prisma, { prefix: 'cons-nopay' });
    expect((await book(s1.cookie, (await slots())[14]!).expect(503)).body.code).toBe('PAYMENTS_NOT_SET_UP');
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ instapayHandle: 'academy@instapay', orangeCashNumber: '01200000000' }).expect(200);

    const own = (await book(finance.cookie, (await slots())[14]!).expect(201)).body;
    expect((await http().post(`/api/admin/consultations/bookings/${own.id}/paid`).set('Cookie', finance.cookie).expect(403)).body.code).toBe('OWN_BOOKING');

    // An expert of its own: the shared one already has confirmed calls ahead.
    const u = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-nolink-exp' });
    const slug4 = `cons-nolink-${Date.now()}`;
    const i4 = await prisma.instructor.create({ data: { slug: slug4, name: 'Linkless Expert', titleEn: 'ML Lead', bioEn: 'Ships models.', userId: u.id } });
    const put4 = (body: Record<string, unknown>) => http().put(`/api/admin/consultations/experts/${i4.id}`).set('Cookie', speakersTeam.cookie).send(body);
    await put4(settings()).expect(200);
    const s2 = await createUser(app, prisma, { prefix: 'cons-nolink' });
    const at = ((await http().get(`/api/consultations/experts/${slug4}/slots?duration=30`).expect(200)).body as string[])[0]!;
    const held = (await http().post(`/api/consultations/experts/${slug4}/bookings`).set('Cookie', s2.cookie).send({ durationMin: 30, startsAt: at, note: '' }).expect(201)).body;
    await put4(settings({ enabled: false, meetingUrl: '' })).expect(200);
    expect((await http().post(`/api/admin/consultations/bookings/${held.id}/paid`).set('Cookie', finance.cookie).expect(409)).body.code).toBe('NO_MEETING_LINK');
    await put4(settings()).expect(200);
    await http().post(`/api/admin/consultations/bookings/${held.id}/paid`).set('Cookie', finance.cookie).expect(200);
    // A confirmed call keeps the link it was confirmed with, even if the expert's fixed link changes or goes.
    await put4(settings({ enabled: false, meetingUrl: '' })).expect(200);
    expect((await http().get(`/api/consultations/bookings/${held.id}`).set('Cookie', s2.cookie).expect(200)).body.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    await put4(settings({ meetingUrl: 'https://zoom.us/j/123456789' })).expect(200);
    // A save that leaves out the weekly hours is refused, not taken as "no hours".
    const { availability: _hours, ...noHours } = settings();
    await put4(noHours).expect(400);
  });

  it('closing an account cancels its upcoming calls: as student (the expert hears) and as expert (unlisted, students hear)', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-closed' });
    const paid = (await book(student.cookie, (await slots())[50]!).expect(201)).body;
    await http().post(`/api/admin/consultations/bookings/${paid.id}/paid`).set('Cookie', finance.cookie).expect(200);
    await app.get(AccountService).deleteByAdmin(student.id, student.email, admin.id);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('CANCELLED');
    expect(await emails(`consultation-cancelled:${paid.id}:expert`)).toHaveLength(1);

    const u = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-leaving' });
    const slug3 = `cons-leaving-${Date.now()}`;
    const i3 = await prisma.instructor.create({ data: { slug: slug3, name: 'Leaving Expert', titleEn: 'ML Lead', bioEn: 'Ships models.', userId: u.id } });
    await http().put(`/api/admin/consultations/experts/${i3.id}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
    const s = await createUser(app, prisma, { prefix: 'cons-orphan' });
    const at = ((await http().get(`/api/consultations/experts/${slug3}/slots?duration=30`).expect(200)).body as string[])[0]!;
    const held = (await http().post(`/api/consultations/experts/${slug3}/bookings`).set('Cookie', s.cookie).send({ durationMin: 30, startsAt: at, note: '' }).expect(201)).body;
    // A profile with bookings can't be deleted (they're kept for accounting).
    await expect(app.get(AdminCoursesService).deleteInstructor(i3.id, 'Leaving Expert', { id: admin.id, role: 'ADMIN' })).rejects.toMatchObject({ status: 409 });
    await app.get(AccountService).deleteByAdmin(u.id, u.email, admin.id);
    await http().get(`/api/consultations/experts/${slug3}`).expect(404);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: held.id } })).cancelledBy).toBe('expert');
    expect(await emails(`consultation-cancelled:${held.id}:student`)).toHaveLength(1);
  });

  it('with Google Calendar: busy times hide slots, paying makes a Meet event, moving and cancelling update it, expiry falls back', async () => {
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
      // No fixed link: listing works only once Google is connected.
      expect((await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(400)).body.code).toBe('LINK_OR_GOOGLE_NEEDED');
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '', enabled: false })).expect(200);

      // An admin account can be an expert: the expert page is for whoever owns the profile.
      const { url } = (await http().post('/api/consultations/expert/google/connect').set('Cookie', u.cookie).expect(200)).body;
      const state = new URL(url).searchParams.get('state')!;
      const stranger = await createUser(app, prisma, { role: 'SPEAKER', prefix: 'cons-gstranger' });
      await prisma.instructor.create({ data: { slug: `cons-gs-${Date.now()}`, name: 'Other', titleEn: 'x', bioEn: 'x', userId: stranger.id, consultant: { create: {} } } });
      expect((await http().get(`/api/consultations/google/callback?code=c&state=${encodeURIComponent(state)}`).set('Cookie', stranger.cookie).expect(303)).headers.location).toMatch(/google=failed$/);
      expect((await http().get(`/api/consultations/google/callback?code=c&state=${encodeURIComponent(state)}`).set('Cookie', u.cookie).expect(303)).headers.location).toMatch(/\/consultations\/expert\?google=connected$/);
      const stored = await prisma.consultantProfile.findUniqueOrThrow({ where: { instructorId: ig.id } });
      expect(stored.googleRefreshToken).not.toContain('refresh-1');
      expect((await http().get('/api/consultations/expert').set('Cookie', u.cookie).expect(200)).body.google).toMatchObject({ available: true, connected: true, email: 'expert@gmail.com', error: null });
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings({ meetingUrl: '' })).expect(200);

      // Busy in Google: those times disappear (and are refused at booking).
      const gslots = async () => (await http().get(`/api/consultations/experts/${slugG}/slots?duration=30`).expect(200)).body as string[];
      const first = (await gslots())[0]!;
      busy.mockResolvedValue([{ startsAt: new Date(first), endsAt: new Date(new Date(first).getTime() + HOUR) }]);
      const student = await createUser(app, prisma, { prefix: 'cons-gstudent' });
      expect((await http().post(`/api/consultations/experts/${slugG}/bookings`).set('Cookie', student.cookie).send({ durationMin: 30, startsAt: first, note: '' }).expect(409)).body.code).toBe('SLOT_TAKEN');
      busy.mockResolvedValue([]);

      const at = (await gslots()).find((x) => new Date(x).getTime() > Date.now() + 30 * HOUR)!;
      const b = (await http().post(`/api/consultations/experts/${slugG}/bookings`).set('Cookie', student.cookie).send({ durationMin: 30, startsAt: at, note: '' }).expect(201)).body;
      const paid = (await http().post(`/api/admin/consultations/bookings/${b.id}/paid`).set('Cookie', finance.cookie).expect(200)).body;
      expect(paid.meetingUrl).toBe('https://meet.google.com/new-call-abc');
      expect(create).toHaveBeenCalledWith('refresh-1', expect.objectContaining({ requestId: b.id, attendeeEmail: student.email }));

      const to = (await gslots()).find((x) => new Date(x).getTime() > new Date(at).getTime() + 2 * HOUR)!;
      await http().post(`/api/consultations/bookings/${b.id}/reschedule`).set('Cookie', student.cookie).send({ startsAt: to }).expect(200);
      expect(move).toHaveBeenCalledWith('refresh-1', 'ev-1', new Date(to), new Date(new Date(to).getTime() + 30 * 60_000));
      await http().post(`/api/consultations/expert/bookings/${b.id}/cancel`).set('Cookie', u.cookie).send({}).expect(200);
      expect(remove).toHaveBeenCalledWith('refresh-1', 'ev-1');

      // The connection expires: slots still load, the expert is told once, and paying without a fixed link is refused.
      busy.mockRejectedValue(new GoogleCalendarExpired());
      expect((await gslots()).length).toBeGreaterThan(0);
      expect((await prisma.consultantProfile.findUniqueOrThrow({ where: { instructorId: ig.id } })).googleError).toBe('EXPIRED');
      expect(await emails(`consultation-google-expired:${stored.id}:`)).toHaveLength(1);
      const at2 = (await gslots())[5];
      const b2 = (await http().post(`/api/consultations/experts/${slugG}/bookings`).set('Cookie', student.cookie).send({ durationMin: 30, startsAt: at2, note: '' }).expect(201)).body;
      expect((await http().post(`/api/admin/consultations/bookings/${b2.id}/paid`).set('Cookie', finance.cookie).expect(409)).body.code).toBe('NO_MEETING_LINK');
      // With a fixed link it goes through on that link.
      await http().put(`/api/admin/consultations/experts/${ig.id}`).set('Cookie', speakersTeam.cookie).send(settings()).expect(200);
      expect((await http().post(`/api/admin/consultations/bookings/${b2.id}/paid`).set('Cookie', finance.cookie).expect(200)).body.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
      expect((await http().delete('/api/consultations/expert/google').set('Cookie', u.cookie).expect(200)).body).toMatchObject({ connected: false });
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('exports bookings with the account, frees unpaid holds on deletion and clears the note on anonymisation', async () => {
    const student = await createUser(app, prisma, { prefix: 'cons-export' });
    const at = (await slots())[40]!;
    const b = (await book(student.cookie, at).expect(201)).body;
    const exp = (await http().get('/api/me/export').set('Cookie', student.cookie).expect(200)).body;
    expect(exp.consultations).toEqual([expect.objectContaining({ reference: b.reference, note: 'Feature store design review', status: 'AWAITING_PAYMENT' })]);

    await app.get(AccountService).deleteByAdmin(student.id, student.email, admin.id);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CANCELLED');
    expect(await slots()).toContain(at);
    await app.get(AccountService).anonymize(student.id);
    expect((await prisma.consultationBooking.findUniqueOrThrow({ where: { id: b.id } })).note).toBe('');
  });
});
