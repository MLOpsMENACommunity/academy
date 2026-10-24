import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ConsultationJobs } from '../src/consultations/consultations.jobs';
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
      .send({ instapayHandle: 'academy@instapay', instapayName: 'MLOps MENA', supportWhatsapp: '+20 100 123 4567' })
      .expect(200);
  });

  afterAll(async () => {
    const { instapayHandle, instapayName, supportWhatsapp } = previous;
    await http().put('/api/admin/settings').set('Cookie', admin.cookie).send({ instapayHandle, instapayName, supportWhatsapp }).expect(200);
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
      payment: { instapayHandle: 'academy@instapay', instapayName: 'MLOps MENA', supportWhatsapp: '+20 100 123 4567' },
    });
    expect(res.body.reference).toMatch(/^C-[A-Z2-9]{6}$/);
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

    // The expert sees who booked and what they want to talk about.
    const overview = (await http().get('/api/speaker/consultations').set('Cookie', expert.cookie).expect(200)).body;
    expect(overview.bookings.find((x: { id: string }) => x.id === b.id)).toMatchObject({ note: 'Feature store design review', student: { name: 'Test Person' } });
    await http().get('/api/speaker/consultations').set('Cookie', student.cookie).expect(403);

    // A student can still cancel a paid call more than 24 hours ahead; the expert is told.
    const later = (await slots()).find((s) => new Date(s).getTime() > Date.now() + 30 * HOUR)!;
    const c = (await book(student.cookie, later).expect(201)).body;
    await http().post(`/api/admin/consultations/bookings/${c.id}/paid`).set('Cookie', finance.cookie).expect(200);
    const cancelled = await http().post(`/api/consultations/bookings/${c.id}/cancel`).set('Cookie', student.cookie).send({ reason: 'Clash at work' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Clash at work', canCancel: false, meetingUrl: null });
    expect((await emails(`consultation-cancelled:${c.id}:`)).length).toBe(2);
    expect(await slots()).toContain(later);
  });

  it('lets the expert keep their hours and link, and cancel an upcoming call', async () => {
    const put = (body: Record<string, unknown>) => http().put('/api/speaker/consultations/settings').set('Cookie', expert.cookie).send(body);
    const mine = settings();
    delete (mine as Partial<typeof mine>).enabled;
    await put({ ...mine, meetingUrl: '' }).expect(400);
    const saved = (await put({ ...mine, minNoticeHours: 4 }).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, minNoticeHours: 4 });
    await put(mine).expect(200);

    const student = await createUser(app, prisma, { prefix: 'cons-expcancel' });
    const b = (await book(student.cookie, (await slots())[20]!).expect(201)).body;
    const res = await http().post(`/api/speaker/consultations/bookings/${b.id}/cancel`).set('Cookie', expert.cookie).send({ reason: 'Travelling' }).expect(200);
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

    // Reminders: a confirmed call 23 hours away gets the "tomorrow" email, for both sides, once.
    await prisma.consultationBooking.update({ where: { id: b.id }, data: { startsAt: new Date(Date.now() + 23 * HOUR), endsAt: new Date(Date.now() + 23 * HOUR + 30 * 60_000) } });
    await jobs.run();
    await jobs.run();
    expect((await emails(`consultation-reminder24:${b.id}:`)).length).toBe(2);
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
