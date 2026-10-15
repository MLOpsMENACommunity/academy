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
});
