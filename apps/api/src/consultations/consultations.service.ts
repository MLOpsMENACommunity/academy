import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  ACTIVE_CONSULTATION_STATUSES,
  availabilitySchema,
  CONSULTATION_MAX_OPEN_HOLDS,
  consultationHoldUntil,
  consultationPrice,
  consultationSlots,
  googleCalendarLink,
  realValue,
  studentCanCancel,
  whatsappUrl,
  type AdminConsultantInput,
  type AdminConsultantRowDto,
  type AvailabilityWindow,
  type ConsultantCardDto,
  type ConsultantDetailDto,
  type ConsultantSettingsDto,
  type ConsultantSettingsInput,
  type ConsultationBookingAdminDto,
  type ConsultationBookingDto,
  type ConsultationBookingInput,
  type ConsultationStatus,
  type Locale,
  type MyConsultationDto,
  type Settings,
} from '@academy/shared';
import { Prisma, type ConsultantProfile, type ConsultationBooking, type Instructor } from '@prisma/client';
import { formatDueAt } from '../assessments/due-format';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { EmailService } from '../email/email.service';
import type { EmailTemplate } from '../email/templates/catalog';
import { buildIcs } from '../learn/ics';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ACTIVE = [...ACTIVE_CONSULTATION_STATUSES];
const isActive = (s: ConsultationStatus) => (ACTIVE as ConsultationStatus[]).includes(s);

type Profile = ConsultantProfile & { instructor: Instructor & { user: { id: string; email: string; locale: Locale } | null } };
type Booking = ConsultationBooking & {
  consultant: Profile;
  student: { id: string; email: string; locale: Locale; profile: { fullNameEn: string | null; fullNameAr: string | null; timezone: string | null } | null };
};

const profileInclude = { instructor: { include: { user: { select: { id: true, email: true, locale: true } } } } } as const;
const bookingInclude = {
  consultant: { include: profileInclude },
  student: { select: { id: true, email: true, locale: true, profile: { select: { fullNameEn: true, fullNameAr: true, timezone: true } } } },
} as const;

export type CancelledBy = 'student' | 'expert' | 'admin';

/** A held slot: confirmed, or unpaid and still within its hold. */
function holdsSlot(now: Date): Prisma.ConsultationBookingWhereInput {
  return { OR: [{ status: 'CONFIRMED' }, { status: 'AWAITING_PAYMENT', holdUntil: { gt: now } }] };
}

function availabilityOf(p: ConsultantProfile): AvailabilityWindow[] {
  const parsed = availabilitySchema.safeParse(p.availability);
  return parsed.success ? parsed.data : [];
}

function settingsOf(p: ConsultantProfile): ConsultantSettingsDto {
  return {
    enabled: p.enabled,
    price30Egp: p.price30Egp,
    price60Egp: p.price60Egp,
    meetingUrl: p.meetingUrl,
    timezone: p.timezone,
    minNoticeHours: p.minNoticeHours,
    horizonDays: p.horizonDays,
    availability: availabilityOf(p),
  };
}

function expertName(i: Pick<Instructor, 'name' | 'nameAr'>, locale: Locale): string {
  return locale === 'ar' ? i.nameAr || i.name : i.name;
}

function studentName(s: Booking['student'], locale: Locale = 'en'): string {
  const p = s.profile;
  return (locale === 'ar' ? p?.fullNameAr || p?.fullNameEn : p?.fullNameEn || p?.fullNameAr) || s.email.split('@')[0]!;
}

function card(p: Profile): ConsultantCardDto {
  return {
    slug: p.instructor.slug!,
    name: p.instructor.name,
    nameAr: p.instructor.nameAr,
    titleEn: p.instructor.titleEn,
    titleAr: p.instructor.titleAr,
    photoUrl: p.instructor.photoUrl,
    price30Egp: p.price30Egp,
    price60Egp: p.price60Egp,
    timezone: p.timezone,
  };
}

/**
 * Consultations: paid 1:1 calls with speakers. A student picks an open slot and it is
 * reserved at once (AWAITING_PAYMENT, until holdUntil); they pay by InstaPay and send the
 * screenshot on WhatsApp; an admin marks the booking paid (CONFIRMED) and both sides get the
 * meeting link. Booking and confirming lock the expert's profile row, so two students can
 * never hold overlapping calls with the same expert. Emails go through the outbox, written
 * in the same transaction as the change that causes them.
 */
@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly outbox: Outbox,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ public

  private async listed(slug: string): Promise<Profile> {
    const p = await this.prisma.consultantProfile.findFirst({
      where: { enabled: true, instructor: { slug: { not: null }, OR: [{ slug }, { previousSlugs: { has: slug } }] } },
      include: profileInclude,
    });
    if (!p) throw new NotFoundException('Expert not found');
    return p;
  }

  async consultants(): Promise<ConsultantCardDto[]> {
    const rows = await this.prisma.consultantProfile.findMany({
      where: { enabled: true, instructor: { slug: { not: null } } },
      include: profileInclude,
      orderBy: { instructor: { name: 'asc' } },
    });
    return rows.map(card);
  }

  async consultant(slug: string): Promise<ConsultantDetailDto> {
    const p = await this.listed(slug);
    return {
      ...card(p),
      bioEn: p.instructor.bioEn,
      bioAr: p.instructor.bioAr,
      linkedinUrl: p.instructor.linkedinUrl,
      minNoticeHours: p.minNoticeHours,
      horizonDays: p.horizonDays,
    };
  }

  async slots(slug: string, durationMin: number, now = new Date()): Promise<string[]> {
    const p = await this.listed(slug);
    if (consultationPrice(p, durationMin) === null) return [];
    const busy = await this.busy(this.prisma, p.id, now);
    return consultationSlots({ ...p, availability: availabilityOf(p) }, durationMin, busy, now).map((d) => d.toISOString());
  }

  private busy(db: Prisma.TransactionClient, consultantId: string, now: Date, exceptId?: string) {
    return db.consultationBooking.findMany({
      where: { consultantId, endsAt: { gt: now }, ...holdsSlot(now), ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { startsAt: true, endsAt: true },
    });
  }

  /** Serialises bookings for one expert: everything after this in the transaction sees a settled calendar. */
  private async lock(tx: Prisma.TransactionClient, consultantId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "ConsultantProfile" WHERE "id" = ${consultantId} FOR UPDATE`;
  }

  // ------------------------------------------------------------------ students

  async book(session: AuthUser, slug: string, input: ConsultationBookingInput, now = new Date()): Promise<MyConsultationDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email address before booking a call' });
    }
    const p = await this.listed(slug);
    if (p.instructor.userId === session.id) throw new BadRequestException({ code: 'OWN_PROFILE', message: "You can't book a call with yourself" });
    const price = consultationPrice(p, input.durationMin);
    if (price === null) throw new BadRequestException({ code: 'DURATION_NOT_OFFERED', message: 'This expert does not offer that call length' });
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
    // Read before the transaction: a query outside it would wait for the connection the transaction holds.
    const settings = await this.settings.get();
    if (!realValue(settings.instapayHandle) || !realValue(settings.supportWhatsapp)) {
      throw new ServiceUnavailableException({ code: 'PAYMENTS_NOT_SET_UP', message: 'Bookings open once the academy has set up payment details' });
    }

    const id = await this.prisma.$transaction(async (tx) => {
      // The student first, then the expert (always this order): the holds limit spans experts.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.id} FOR NO KEY UPDATE`;
      await this.lock(tx, p.id);
      // Under the lock: an admin may have just unlisted or repriced the expert.
      const current = await tx.consultantProfile.findUnique({ where: { id: p.id } });
      if (!current?.enabled || consultationPrice(current, input.durationMin) !== price) {
        throw new ConflictException({ code: 'EXPERT_CHANGED', message: "This expert's calls just changed. Reload and pick again." });
      }
      const holds = await tx.consultationBooking.count({ where: { studentId: session.id, status: 'AWAITING_PAYMENT', holdUntil: { gt: now } } });
      if (holds >= CONSULTATION_MAX_OPEN_HOLDS) {
        throw new ConflictException({ code: 'TOO_MANY_HOLDS', message: 'Pay for or cancel your other reservations before booking another call' });
      }
      const busy = await this.busy(tx, p.id, now);
      const open = consultationSlots({ ...current, availability: availabilityOf(current) }, input.durationMin, busy, now);
      if (!open.some((s) => s.getTime() === startsAt.getTime())) {
        throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time is no longer available. Pick another one.' });
      }
      const created = await this.createWithReference(tx, {
        consultantId: p.id,
        studentId: session.id,
        startsAt,
        endsAt,
        durationMin: input.durationMin,
        priceEgp: price,
        note: input.note,
        holdUntil: consultationHoldUntil(now, startsAt),
      });
      const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
      await this.outbox.enqueue(this.reservedEmail(b, settings), tx);
      return created.id;
    });
    this.outbox.kick();
    return this.mine(session, id, now);
  }

  private async createWithReference(tx: Prisma.TransactionClient, data: Omit<Prisma.ConsultationBookingUncheckedCreateInput, 'reference'>): Promise<{ id: string }> {
    for (let attempt = 0; ; attempt++) {
      const reference = `C-${Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join('')}`;
      // A clash would abort the transaction, so check first; the unique index stays the backstop.
      if (attempt < 5 && (await tx.consultationBooking.findUnique({ where: { reference }, select: { id: true } }))) continue;
      return tx.consultationBooking.create({ data: { ...data, reference }, select: { id: true } });
    }
  }

  async myBookings(session: AuthUser, now = new Date()): Promise<ConsultationBookingDto[]> {
    const rows = await this.prisma.consultationBooking.findMany({ where: { studentId: session.id }, include: bookingInclude, orderBy: { startsAt: 'desc' } });
    return rows.map((b) => this.dto(b, now, 'student'));
  }

  async mine(session: AuthUser, id: string, now = new Date()): Promise<MyConsultationDto> {
    const b = await this.prisma.consultationBooking.findFirst({ where: { id, studentId: session.id }, include: bookingInclude });
    if (!b) throw new NotFoundException('Booking not found');
    const dto = this.dto(b, now, 'student');
    if (dto.status !== 'AWAITING_PAYMENT') return { ...dto, payment: null };
    const s = await this.settings.get();
    return { ...dto, payment: { instapayHandle: realValue(s.instapayHandle), instapayName: realValue(s.instapayName), supportWhatsapp: realValue(s.supportWhatsapp) } };
  }

  async cancelMine(session: AuthUser, id: string, reason: string, now = new Date()): Promise<MyConsultationDto> {
    const own = await this.prisma.consultationBooking.findFirst({ where: { id, studentId: session.id }, select: { id: true } });
    if (!own) throw new NotFoundException('Booking not found');
    await this.cancel(id, 'student', session.id, reason, now, (b, status) =>
      studentCanCancel({ status, startsAt: b.startsAt }, now) ? null : 'This booking can no longer be cancelled here. Contact us on WhatsApp.',
    );
    return this.mine(session, id, now);
  }

  /** The .ics of a confirmed call, for the student or the expert. No meeting link inside. */
  async ics(session: AuthUser, id: string, now = new Date()): Promise<string> {
    const b = await this.prisma.consultationBooking.findFirst({
      where: { id, status: 'CONFIRMED', OR: [{ studentId: session.id }, { consultant: { instructor: { userId: session.id } } }] },
      include: bookingInclude,
    });
    if (!b) throw new NotFoundException('Booking not found');
    const asExpert = b.studentId !== session.id;
    const locale = asExpert ? (b.consultant.instructor.user?.locale ?? 'en') : b.student.locale;
    const title = this.calendarTitle(b, asExpert ? 'expert' : 'student', locale);
    const url = this.email.url(locale, asExpert ? '/speaker/consultations' : `/consultations/bookings/${b.id}`);
    return buildIcs(title, [{ uid: `consultation-${b.id}`, title, description: url, url, start: b.startsAt, durationMin: b.durationMin, updatedAt: b.updatedAt }], now);
  }

  // ------------------------------------------------------------------ experts

  private async ownProfile(userId: string): Promise<Profile> {
    const p = await this.prisma.consultantProfile.findFirst({ where: { instructor: { userId } }, include: profileInclude });
    if (!p) throw new NotFoundException({ code: 'NOT_A_CONSULTANT', message: 'Consultations are not set up for your profile. Ask the academy team.' });
    return p;
  }

  async expertOverview(userId: string, now = new Date()): Promise<{ settings: ConsultantSettingsDto; bookings: ConsultationBookingAdminDto[] }> {
    const p = await this.ownProfile(userId);
    const rows = await this.prisma.consultationBooking.findMany({
      where: { consultantId: p.id, endsAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } },
      include: bookingInclude,
      orderBy: { startsAt: 'asc' },
    });
    return { settings: settingsOf(p), bookings: rows.map((b) => this.expertDto(b, now)) };
  }

  async updateExpertSettings(userId: string, input: ConsultantSettingsInput): Promise<ConsultantSettingsDto> {
    const p = await this.ownProfile(userId);
    if (p.enabled && (!input.meetingUrl || (input.price30Egp === null && input.price60Egp === null))) {
      throw new BadRequestException({ code: 'LISTED_NEEDS_LINK_AND_PRICE', message: 'While you are listed, keep a meeting link and at least one price' });
    }
    await this.keepLinkForConfirmed(p.id, input.meetingUrl);
    const updated = await this.prisma.consultantProfile.update({ where: { id: p.id }, data: { ...input, availability: input.availability as Prisma.InputJsonValue } });
    await this.audit.log({ actorId: userId, action: 'consultant.settings_updated', entityType: 'ConsultantProfile', entityId: p.id });
    return settingsOf(updated);
  }

  async expertCancel(userId: string, id: string, reason: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const p = await this.ownProfile(userId);
    const own = await this.prisma.consultationBooking.findFirst({ where: { id, consultantId: p.id }, select: { id: true } });
    if (!own) throw new NotFoundException('Booking not found');
    await this.cancel(id, 'expert', userId, reason, now, (b, status) => (isActive(status) && b.startsAt > now ? null : 'Only upcoming bookings can be cancelled'));
    return this.expertDto(await this.prisma.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude }), now);
  }

  /** Confirmed calls ahead are sent the current link (reminders, booking page): it can change but not go empty. */
  private async keepLinkForConfirmed(consultantId: string, meetingUrl: string, now = new Date()): Promise<void> {
    if (meetingUrl) return;
    const ahead = await this.prisma.consultationBooking.count({ where: { consultantId, status: 'CONFIRMED', endsAt: { gt: now } } });
    if (ahead) {
      throw new BadRequestException({ code: 'LINK_NEEDED', message: `${ahead} confirmed call(s) are coming up: keep a meeting link (you can change it)` });
    }
  }

  // ------------------------------------------------------------------ admin

  async adminConsultants(now = new Date()): Promise<AdminConsultantRowDto[]> {
    const instructors = await this.prisma.instructor.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, userId: true, consultant: true },
    });
    const upcoming = await this.prisma.consultationBooking.groupBy({
      by: ['consultantId'],
      where: { startsAt: { gt: now }, ...holdsSlot(now) },
      _count: { _all: true },
    });
    const count = new Map(upcoming.map((u) => [u.consultantId, u._count._all]));
    return instructors.map((i) => ({
      instructorId: i.id,
      slug: i.slug,
      name: i.name,
      hasAccount: Boolean(i.userId),
      settings: i.consultant ? settingsOf(i.consultant) : null,
      upcoming: i.consultant ? (count.get(i.consultant.id) ?? 0) : 0,
    }));
  }

  async upsertConsultant(admin: AuthUser, instructorId: string, input: AdminConsultantInput): Promise<ConsultantSettingsDto> {
    const instructor = await this.prisma.instructor.findUnique({ where: { id: instructorId }, select: { id: true, slug: true } });
    if (!instructor) throw new NotFoundException('Speaker not found');
    if (input.enabled && !instructor.slug) throw new BadRequestException({ code: 'NO_PUBLIC_PAGE', message: 'This speaker has no public page yet' });
    const existing = await this.prisma.consultantProfile.findUnique({ where: { instructorId }, select: { id: true } });
    if (existing) await this.keepLinkForConfirmed(existing.id, input.meetingUrl);
    const data = { ...input, availability: input.availability as Prisma.InputJsonValue };
    const p = await this.prisma.consultantProfile.upsert({ where: { instructorId }, create: { instructorId, ...data }, update: data });
    await this.audit.log({ actorId: admin.id, action: 'consultant.updated', entityType: 'ConsultantProfile', entityId: p.id, metadata: { instructorId, enabled: input.enabled } });
    return settingsOf(p);
  }

  async adminBookings(status: ConsultationStatus | undefined, now = new Date()): Promise<ConsultationBookingAdminDto[]> {
    // Statuses are as shown (a lapsed hold reads EXPIRED before the job has stored it).
    const where: Prisma.ConsultationBookingWhereInput =
      status === 'AWAITING_PAYMENT'
        ? { status, holdUntil: { gt: now } }
        : status === 'EXPIRED'
          ? { OR: [{ status }, { status: 'AWAITING_PAYMENT', holdUntil: { lte: now } }] }
          : status
            ? { status }
            : {};
    const rows = await this.prisma.consultationBooking.findMany({ where, include: bookingInclude, orderBy: { startsAt: 'desc' }, take: 500 });
    return rows.map((b) => this.adminDto(b, now, 'admin'));
  }

  async adminBooking(id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const b = await this.prisma.consultationBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return this.adminDto(b, now, 'admin');
  }

  /**
   * The payment was checked: the booking is confirmed and both sides get the link. A lapsed
   * reservation can still be confirmed (the payment came late) when its slot is still free.
   */
  async markPaid(admin: AuthUser, id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    await this.prisma.$transaction(async (tx) => {
      const head = await tx.consultationBooking.findUnique({ where: { id }, select: { consultantId: true } });
      if (!head) throw new NotFoundException('Booking not found');
      await this.lock(tx, head.consultantId);
      const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      if (b.studentId === admin.id) throw new ForbiddenException({ code: 'OWN_BOOKING', message: 'Another admin has to confirm your own booking' });
      if (!b.consultant.meetingUrl) {
        throw new ConflictException({ code: 'NO_MEETING_LINK', message: 'This expert has no meeting link: add one in Admin → Consultations first' });
      }
      if (b.status !== 'AWAITING_PAYMENT' && b.status !== 'EXPIRED') {
        throw new ConflictException({ code: 'NOT_AWAITING_PAYMENT', message: `This booking is ${b.status.toLowerCase().replace('_', ' ')}` });
      }
      if (b.startsAt <= now) throw new ConflictException({ code: 'IN_THE_PAST', message: 'This call has already started' });
      const clash = (await this.busy(tx, b.consultantId, now, b.id)).some((x) => x.startsAt < b.endsAt && b.startsAt < x.endsAt);
      if (clash) throw new ConflictException({ code: 'SLOT_TAKEN', message: 'Someone else has booked this time since. Arrange a new time with the student.' });
      const done = await tx.consultationBooking.updateMany({
        where: { id, status: b.status, updatedAt: b.updatedAt },
        data: { status: 'CONFIRMED', paidAt: now, paidById: admin.id, holdUntil: null },
      });
      if (done.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      await this.audit.log({ actorId: admin.id, action: 'consultation.paid', entityType: 'ConsultationBooking', entityId: id }, tx);
      await this.outbox.enqueue(this.confirmedEmails(b), tx);
    });
    this.outbox.kick();
    return this.adminBooking(id, now);
  }

  async adminCancel(admin: AuthUser, id: string, reason: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    await this.cancel(id, 'admin', admin.id, reason, now, (_b, status) => (isActive(status) ? null : 'Only reserved or confirmed bookings can be cancelled'));
    return this.adminBooking(id, now);
  }

  // ------------------------------------------------------------------ deleted accounts

  /**
   * An account was deleted. As a student: their upcoming calls are cancelled (a paid one shows
   * as cancelled-after-payment in Admin → Consultations, for the refund) and the expert is told.
   * As an expert: they're unlisted, and their upcoming calls are cancelled with the students told.
   * Never throws: deletion must not fail on this.
   */
  async releaseForDeletedAccount(userId: string, now = new Date()): Promise<void> {
    const reason = 'The account was closed';
    const asStudent = await this.prisma.consultationBooking.findMany({ where: { studentId: userId, startsAt: { gt: now }, status: { in: ACTIVE } }, select: { id: true } });
    const profile = await this.prisma.consultantProfile.findFirst({ where: { instructor: { userId } }, select: { id: true } });
    const asExpert = profile
      ? await this.prisma.consultationBooking.findMany({ where: { consultantId: profile.id, startsAt: { gt: now }, status: { in: ACTIVE } }, select: { id: true } })
      : [];
    if (profile) await this.prisma.consultantProfile.update({ where: { id: profile.id }, data: { enabled: false } }).catch(() => undefined);
    for (const [rows, by] of [[asStudent, 'student'], [asExpert, 'expert']] as const) {
      for (const { id } of rows) {
        await this.cancel(id, by, userId, reason, now, (_b, status) => (isActive(status) ? null : 'gone')).catch(() => undefined);
      }
    }
  }

  // ------------------------------------------------------------------ jobs

  /** Unpaid reservations past their hold become EXPIRED, and the student is told. */
  async expireHolds(now = new Date()): Promise<number> {
    const lapsed = await this.prisma.consultationBooking.findMany({ where: { status: 'AWAITING_PAYMENT', holdUntil: { lte: now } }, include: bookingInclude });
    let n = 0;
    for (const b of lapsed) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const r = await tx.consultationBooking.updateMany({ where: { id: b.id, status: 'AWAITING_PAYMENT' }, data: { status: 'EXPIRED' } });
        if (r.count !== 1) return 0;
        const email = this.cancelledEmail(b, 'student', 'expired', '');
        if (email) await this.outbox.enqueue([email], tx);
        return r.count;
      });
      n += changed;
    }
    if (n) this.outbox.kick();
    return n;
  }

  /** "Tomorrow" (22–24 h ahead) and "in 1 hour" (10–75 min ahead) emails for confirmed calls. Each sends once. */
  async queueReminders(now = new Date()): Promise<number> {
    // A call confirmed in the last 2 hours just got the confirmation: no "tomorrow" email on top of it.
    const windows: { hours: 24 | 1; from: number; to: number; paidBefore?: Date }[] = [
      { hours: 24, from: 22 * 60, to: 24 * 60, paidBefore: new Date(now.getTime() - 2 * 3_600_000) },
      { hours: 1, from: 10, to: 75 },
    ];
    const messages: OutboxMessage[] = [];
    for (const w of windows) {
      const due = await this.prisma.consultationBooking.findMany({
        where: {
          status: 'CONFIRMED',
          startsAt: { gte: new Date(now.getTime() + w.from * 60_000), lte: new Date(now.getTime() + w.to * 60_000) },
          ...(w.paidBefore ? { paidAt: { lt: w.paidBefore } } : {}),
        },
        include: bookingInclude,
      });
      for (const b of due) {
        for (const role of ['student', 'expert'] as const) {
          const to = this.recipient(b, role);
          if (!to) continue;
          messages.push({
            userId: to.id,
            locale: to.locale,
            category: 'consultation',
            lane: 'transactional',
            dedupeKey: `consultation-reminder${w.hours}:${b.id}:${role}`,
            template: {
              name: 'consultationReminder',
              role,
              otherName: this.otherName(b, role, to.locale),
              when: this.when(b, role, to.locale),
              hours: w.hours,
              meetingUrl: b.consultant.meetingUrl,
              url: this.bookingUrl(b, role, to.locale),
            },
          });
        }
      }
    }
    const added = messages.length ? await this.outbox.enqueue(messages) : new Set<string>();
    return added.size;
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Cancels under the expert's lock, judging the rule (`refusal`: a message, or null to allow)
   * on the booking as it is now, so a cancel racing "Mark paid" sees the paid call.
   */
  private async cancel(
    id: string,
    by: CancelledBy,
    actorId: string,
    reason: string,
    now: Date,
    refusal: (b: Booking, status: ConsultationStatus) => string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const head = await tx.consultationBooking.findUnique({ where: { id }, select: { consultantId: true } });
      if (!head) throw new NotFoundException('Booking not found');
      await this.lock(tx, head.consultantId);
      const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      const refused = refusal(b, this.status(b, now));
      if (refused) throw new ConflictException({ code: 'CANNOT_CANCEL', message: refused });
      const wasPaid = b.status === 'CONFIRMED';
      const r = await tx.consultationBooking.updateMany({
        where: { id: b.id, status: b.status, updatedAt: b.updatedAt },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: by, cancelReason: reason || null, holdUntil: null },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      await this.audit.log({ actorId, action: 'consultation.cancelled', entityType: 'ConsultationBooking', entityId: b.id, metadata: { by, wasPaid } }, tx);
      // The student always hears; the expert is emailed only about confirmed calls (unpaid ones never reached their inbox).
      const emails = [this.cancelledEmail(b, 'student', by, reason, wasPaid)];
      if (wasPaid) emails.push(this.cancelledEmail(b, 'expert', by, reason, wasPaid));
      await this.outbox.enqueue(emails.filter((e): e is OutboxMessage => e !== null), tx);
    });
    this.outbox.kick();
  }

  /** As shown: an unpaid reservation past its hold is EXPIRED even before the job stores it. */
  private status(b: ConsultationBooking, now: Date): ConsultationStatus {
    if (b.status === 'AWAITING_PAYMENT' && b.holdUntil && b.holdUntil <= now) return 'EXPIRED';
    return b.status as ConsultationStatus;
  }

  private dto(b: Booking, now: Date, as: 'student' | 'expert' | 'admin'): ConsultationBookingDto {
    const status = this.status(b, now);
    return {
      id: b.id,
      reference: b.reference,
      status,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      durationMin: b.durationMin,
      priceEgp: b.priceEgp,
      note: b.note,
      holdUntil: status === 'AWAITING_PAYMENT' ? (b.holdUntil?.toISOString() ?? null) : null,
      createdAt: b.createdAt.toISOString(),
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      cancelReason: b.cancelReason,
      meetingUrl: status === 'CONFIRMED' ? b.consultant.meetingUrl || null : null,
      consultant: { slug: b.consultant.instructor.slug ?? '', name: b.consultant.instructor.name, nameAr: b.consultant.instructor.nameAr, photoUrl: b.consultant.instructor.photoUrl },
      canCancel: as === 'student' ? studentCanCancel({ status, startsAt: b.startsAt }, now) : isActive(status) && (as === 'admin' || b.startsAt > now),
    };
  }

  private adminDto(b: Booking, now: Date, as: 'admin'): ConsultationBookingAdminDto {
    return {
      ...this.dto(b, now, as),
      student: { id: b.student.id, name: studentName(b.student), email: b.student.email },
      paidAt: b.paidAt?.toISOString() ?? null,
    };
  }

  /** What the expert sees: the student's name and note, never their email (they meet on the link). */
  private expertDto(b: Booking, now: Date): ConsultationBookingAdminDto {
    return { ...this.dto(b, now, 'expert'), student: { id: b.student.id, name: studentName(b.student), email: null }, paidAt: b.paidAt?.toISOString() ?? null };
  }

  private recipient(b: Booking, role: 'student' | 'expert'): { id: string; locale: Locale } | null {
    if (role === 'student') return { id: b.student.id, locale: b.student.locale };
    const u = b.consultant.instructor.user;
    return u ? { id: u.id, locale: u.locale } : null;
  }

  private otherName(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    return role === 'student' ? expertName(b.consultant.instructor, locale) : studentName(b.student, locale);
  }

  /** In the reader's time zone: the student's profile zone, the expert's working zone. */
  private when(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    return formatDueAt(b.startsAt, locale, role === 'student' ? b.student.profile?.timezone : b.consultant.timezone);
  }

  private bookingUrl(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    return this.email.url(locale, role === 'student' ? `/consultations/bookings/${b.id}` : '/speaker/consultations');
  }

  private calendarTitle(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    const other = this.otherName(b, role, locale);
    return locale === 'ar' ? `مكالمة مع ${other} (MLOps MENA)` : `Call with ${other} (MLOps MENA)`;
  }

  private reservedEmail(b: Booking, s: Settings): OutboxMessage[] {
    const locale = b.student.locale;
    const wa = realValue(s.supportWhatsapp);
    const text = locale === 'ar' ? `دفع حجز المكالمة ${b.reference}` : `Payment for consultation ${b.reference}`;
    const template: EmailTemplate = {
      name: 'consultationReserved',
      expertName: expertName(b.consultant.instructor, locale),
      when: this.when(b, 'student', locale),
      durationMin: b.durationMin,
      priceEgp: b.priceEgp,
      reference: b.reference,
      holdUntil: formatDueAt(b.holdUntil!, locale, b.student.profile?.timezone),
      instapayHandle: realValue(s.instapayHandle),
      instapayName: realValue(s.instapayName),
      whatsappUrl: wa ? `${whatsappUrl(wa)}?text=${encodeURIComponent(text)}` : '',
      url: this.bookingUrl(b, 'student', locale),
    };
    return [{ userId: b.studentId, locale, template, category: 'consultation', lane: 'transactional', dedupeKey: `consultation-reserved:${b.id}` }];
  }

  private confirmedEmails(b: Booking): OutboxMessage[] {
    const out: OutboxMessage[] = [];
    for (const role of ['student', 'expert'] as const) {
      const to = this.recipient(b, role);
      if (!to) continue;
      const url = this.bookingUrl(b, role, to.locale);
      out.push({
        userId: to.id,
        locale: to.locale,
        category: 'consultation',
        lane: 'transactional',
        dedupeKey: `consultation-confirmed:${b.id}:${role}`,
        template: {
          name: 'consultationConfirmed',
          role,
          otherName: this.otherName(b, role, to.locale),
          when: this.when(b, role, to.locale),
          durationMin: b.durationMin,
          meetingUrl: b.consultant.meetingUrl,
          // The link stays out of calendar entries (they get shared and synced); the booking page has it.
          calendarUrl: googleCalendarLink({ title: this.calendarTitle(b, role, to.locale), start: b.startsAt, end: b.endsAt, details: url }),
          icsUrl: `${this.env.WEB_URL}/api/consultations/bookings/${b.id}/calendar.ics`,
          url,
          note: role === 'expert' ? b.note : '',
        },
      });
    }
    return out;
  }

  private cancelledEmail(b: Booking, role: 'student' | 'expert', by: CancelledBy | 'expired', reason: string, wasPaid = false): OutboxMessage | null {
    const to = this.recipient(b, role);
    if (!to) return null;
    return {
      userId: to.id,
      locale: to.locale,
      category: 'consultation',
      lane: 'transactional',
      dedupeKey: `consultation-${by === 'expired' ? 'expired' : 'cancelled'}:${b.id}:${role}`,
      template: {
        name: 'consultationCancelled',
        role,
        otherName: this.otherName(b, role, to.locale),
        when: this.when(b, role, to.locale),
        by,
        wasPaid,
        reason,
        url: this.bookingUrl(b, role, to.locale),
      },
    };
  }
}
