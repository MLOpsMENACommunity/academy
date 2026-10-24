import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  ACTIVE_CONSULTATION_STATUSES,
  availabilitySchema,
  CONSULTATION_MAX_OPEN_HOLDS,
  CONSULTATION_WALLET_LABELS,
  consultationHoldUntil,
  consultationPaymentMethods,
  consultationPrice,
  consultationSlots,
  googleCalendarLink,
  realValue,
  studentCanCancel,
  studentCanReschedule,
  whatsappUrl,
  type AdminConsultantInput,
  type AdminConsultantRowDto,
  type AvailabilityWindow,
  type BusyRange,
  type ConsultantCardDto,
  type ConsultantDetailDto,
  type ConsultantSettingsDto,
  type ConsultantSettingsInput,
  type ConsultationBookingAdminDto,
  type ConsultationBookingDto,
  type ConsultationBookingInput,
  type ConsultationStatus,
  type ExpertOverviewDto,
  type GoogleCalendarStatusDto,
  type Locale,
  type MyConsultationDto,
  type Settings,
} from '@academy/shared';
import { Prisma, type ConsultantProfile, type ConsultationBooking, type Instructor } from '@prisma/client';
import { formatDueAt } from '../assessments/due-format';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import type { EmailTemplate } from '../email/templates/catalog';
import { buildIcs } from '../learn/ics';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GoogleCalendar, GoogleCalendarExpired } from './google-calendar';

const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ACTIVE = [...ACTIVE_CONSULTATION_STATUSES];
const isActive = (s: ConsultationStatus) => (ACTIVE as ConsultationStatus[]).includes(s);
/** Busy times read from an expert's Google Calendar are reused this long for the public slot lists. */
const GOOGLE_BUSY_CACHE_MS = 2 * 60_000;

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

/** A Google connection that should work (connected, and not marked broken). */
const googleUsable = (p: Pick<ConsultantProfile, 'googleRefreshToken' | 'googleError'>) => Boolean(p.googleRefreshToken && !p.googleError);

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
 * reserved at once (AWAITING_PAYMENT, until holdUntil); they pay by InstaPay or a wallet and
 * send the screenshot on WhatsApp; an admin marks the booking paid (CONFIRMED) and both sides
 * get the meeting link. Paid calls aren't refunded to the student: they can move one once.
 *
 * Booking, confirming, moving and cancelling lock the expert's profile row, so two students
 * can never hold overlapping calls with the same expert. Emails go through the outbox, written
 * in the same transaction as the change that causes them.
 *
 * An expert who connected Google Calendar: their busy times hide slots, and a paid call gets an
 * event in their calendar with a new Meet link (the student is invited); moving or cancelling
 * updates it. Google is called outside every transaction, and a failure never blocks a booking:
 * their fixed link is used instead, and a broken connection is marked for them to reconnect.
 */
@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);
  private readonly googleBusyCache = new Map<string, { at: number; until: number; ranges: BusyRange[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly outbox: Outbox,
    private readonly audit: AuditService,
    private readonly google: GoogleCalendar,
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
    const busy = [...(await this.busy(this.prisma, p.id, now)), ...(await this.googleBusy(p, now, new Date(now.getTime() + (p.horizonDays + 1) * 86_400_000), true))];
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

  // ------------------------------------------------------------------ Google Calendar

  private token(p: Pick<ConsultantProfile, 'googleRefreshToken' | 'googleError'>): string | null {
    return googleUsable(p) ? this.google.decrypt(p.googleRefreshToken!) : null;
  }

  /**
   * Busy times from the expert's Google Calendar ([] when not connected, or when Google fails:
   * a failure never blocks booking). `cached` reuses a recent answer, for the public slot lists;
   * booking and moving always ask again.
   */
  private async googleBusy(p: Profile | ConsultantProfile, from: Date, to: Date, cached = false): Promise<BusyRange[]> {
    const token = this.token(p);
    if (!token) return [];
    const hit = this.googleBusyCache.get(p.id);
    if (cached && hit && Date.now() - hit.at < GOOGLE_BUSY_CACHE_MS && hit.until >= to.getTime()) return hit.ranges;
    try {
      const ranges = await this.google.busy(token, from, to);
      this.googleBusyCache.set(p.id, { at: Date.now(), until: to.getTime(), ranges });
      return ranges;
    } catch (err) {
      await this.googleFailed(p.id, err);
      return [];
    }
  }

  /** A broken connection (expired or revoked) is marked and the expert told once; other errors are only logged. */
  private async googleFailed(consultantId: string, err: unknown): Promise<void> {
    if (!(err instanceof GoogleCalendarExpired)) {
      this.logger.warn(`Google Calendar call failed: ${(err as Error).name}`);
      return;
    }
    this.googleBusyCache.delete(consultantId);
    const changed = await this.prisma.consultantProfile.updateMany({ where: { id: consultantId, googleError: null }, data: { googleError: 'EXPIRED' } });
    if (!changed.count) return;
    const p = await this.prisma.consultantProfile.findUnique({ where: { id: consultantId }, include: profileInclude });
    const u = p?.instructor.user;
    if (!u) return;
    await this.outbox.enqueue([
      {
        userId: u.id,
        locale: u.locale,
        category: 'consultation',
        lane: 'transactional',
        dedupeKey: `consultation-google-expired:${consultantId}:${Date.now()}`,
        template: { name: 'consultationGoogleExpired', url: this.email.url(u.locale, '/consultations/expert') },
      },
    ]);
  }

  private async withGoogle<T>(p: ConsultantProfile, fn: (token: string) => Promise<T>): Promise<T | null> {
    const token = this.token(p);
    if (!token) return null;
    try {
      return await fn(token);
    } catch (err) {
      await this.googleFailed(p.id, err);
      return null;
    }
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
    if (!consultationPaymentMethods(settings).length || !realValue(settings.supportWhatsapp)) {
      throw new ServiceUnavailableException({ code: 'PAYMENTS_NOT_SET_UP', message: 'Bookings open once the academy has set up payment details' });
    }
    await this.refuseIfGoogleBusy(p, startsAt, endsAt);

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

  /** The expert has something else in their Google Calendar then (asked fresh, not from the cache). */
  private async refuseIfGoogleBusy(p: ConsultantProfile, startsAt: Date, endsAt: Date): Promise<void> {
    const busy = await this.googleBusy(p, startsAt, endsAt);
    if (busy.some((b) => b.startsAt < endsAt && startsAt < b.endsAt)) {
      throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time is no longer available. Pick another one.' });
    }
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
    return { ...dto, payment: { methods: consultationPaymentMethods(s), supportWhatsapp: realValue(s.supportWhatsapp) } };
  }

  /** An unpaid reservation only: paid calls aren't refunded (the student can move one instead). */
  async cancelMine(session: AuthUser, id: string, reason: string, now = new Date()): Promise<MyConsultationDto> {
    const own = await this.prisma.consultationBooking.findFirst({ where: { id, studentId: session.id }, select: { id: true } });
    if (!own) throw new NotFoundException('Booking not found');
    await this.cancel(id, 'student', session.id, reason, now, (_b, status) =>
      studentCanCancel({ status }) ? null : 'Paid calls are not refunded. You can move the call to another time instead.',
    );
    return this.mine(session, id, now);
  }

  /** Moves a paid call to another open time of the same expert, once, up to 24 hours before. */
  async reschedule(session: AuthUser, id: string, startsAtIso: string, now = new Date()): Promise<MyConsultationDto> {
    const own = await this.prisma.consultationBooking.findFirst({ where: { id, studentId: session.id }, include: { consultant: true } });
    if (!own) throw new NotFoundException('Booking not found');
    const startsAt = new Date(startsAtIso);
    const endsAt = new Date(startsAt.getTime() + own.durationMin * 60_000);
    await this.refuseIfGoogleBusy(own.consultant, startsAt, endsAt);

    const moved = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, own.consultantId);
      const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      if (!studentCanReschedule({ status: this.status(b, now), startsAt: b.startsAt, rescheduleCount: b.rescheduleCount }, now)) {
        throw new ConflictException({ code: 'CANNOT_RESCHEDULE', message: 'This call can no longer be moved' });
      }
      const busy = await this.busy(tx, b.consultantId, now, b.id);
      const open = consultationSlots({ ...b.consultant, availability: availabilityOf(b.consultant) }, b.durationMin, busy, now);
      if (startsAt.getTime() === b.startsAt.getTime() || !open.some((s) => s.getTime() === startsAt.getTime())) {
        throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time is no longer available. Pick another one.' });
      }
      const r = await tx.consultationBooking.updateMany({
        where: { id, status: 'CONFIRMED', updatedAt: b.updatedAt },
        data: { startsAt, endsAt, rescheduleCount: { increment: 1 } },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      await this.audit.log(
        { actorId: session.id, action: 'consultation.rescheduled', entityType: 'ConsultationBooking', entityId: id, metadata: { from: b.startsAt.toISOString(), to: startsAt.toISOString() } },
        tx,
      );
      const after = { ...b, startsAt, endsAt };
      await this.outbox.enqueue(this.confirmedEmails(after, this.linkOf(after), true), tx);
      return after;
    });
    this.outbox.kick();
    if (moved.googleEventId) await this.withGoogle(moved.consultant, (token) => this.google.moveEvent(token, moved.googleEventId!, startsAt, endsAt));
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
    const url = this.bookingUrl(b, asExpert ? 'expert' : 'student', locale);
    return buildIcs(title, [{ uid: `consultation-${b.id}`, title, description: url, url, start: b.startsAt, durationMin: b.durationMin, updatedAt: b.updatedAt }], now);
  }

  // ------------------------------------------------------------------ experts

  private async ownProfile(userId: string): Promise<Profile> {
    const p = await this.prisma.consultantProfile.findFirst({ where: { instructor: { userId } }, include: profileInclude });
    if (!p) throw new NotFoundException({ code: 'NOT_A_CONSULTANT', message: 'Consultations are not set up for your profile. Ask the academy team.' });
    return p;
  }

  private googleStatus(p: ConsultantProfile): GoogleCalendarStatusDto {
    return { available: this.google.isEnabled(), connected: Boolean(p.googleRefreshToken), email: p.googleEmail, error: p.googleError };
  }

  async expertOverview(userId: string, now = new Date()): Promise<ExpertOverviewDto> {
    const p = await this.ownProfile(userId);
    const rows = await this.prisma.consultationBooking.findMany({
      where: { consultantId: p.id, endsAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } },
      include: bookingInclude,
      orderBy: { startsAt: 'asc' },
    });
    return { settings: settingsOf(p), google: this.googleStatus(p), bookings: rows.map((b) => this.expertDto(b, now)) };
  }

  async updateExpertSettings(userId: string, input: ConsultantSettingsInput): Promise<ConsultantSettingsDto> {
    const p = await this.ownProfile(userId);
    if (p.enabled && (input.price30Egp === null && input.price60Egp === null)) {
      throw new BadRequestException({ code: 'LISTED_NEEDS_LINK_AND_PRICE', message: 'While you are listed, keep at least one price' });
    }
    this.requireLinkWhenListed(p.enabled, input.meetingUrl, p);
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

  /** Google's consent page for this expert (calendar free/busy and events). */
  async googleConnectUrl(userId: string): Promise<{ url: string }> {
    await this.ownProfile(userId);
    if (!this.google.isEnabled()) throw new ServiceUnavailableException({ code: 'GOOGLE_NOT_CONFIGURED', message: 'Google Calendar is not set up for the academy' });
    return { url: this.google.connectUrl(userId) };
  }

  /** Back from Google: stores the connection (encrypted). Returns the page to send the expert to. */
  async googleCallback(session: AuthUser, code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const { locale } = await this.prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { locale: true } });
    const page = (result: string) => `${this.env.WEB_URL}/${locale}/consultations/expert?google=${result}`;
    if (error || !code || !state) return page('cancelled');
    if (this.google.stateUser(state) !== session.id) return page('failed');
    const p = await this.ownProfile(session.id);
    try {
      const r = await this.google.exchange(code);
      const needed = ['https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.events'];
      if (!needed.every((s) => r.scopes.includes(s))) {
        await this.google.revoke(r.refreshToken);
        return page('permissions');
      }
      await this.prisma.consultantProfile.update({
        where: { id: p.id },
        data: { googleRefreshToken: this.google.encrypt(r.refreshToken), googleEmail: r.email, googleConnectedAt: new Date(), googleError: null },
      });
      this.googleBusyCache.delete(p.id);
      await this.audit.log({ actorId: session.id, action: 'consultant.google_connected', entityType: 'ConsultantProfile', entityId: p.id });
      return page('connected');
    } catch (err) {
      this.logger.warn(`Google Calendar connect failed: ${(err as Error).name}`);
      return page('failed');
    }
  }

  async googleDisconnect(userId: string): Promise<GoogleCalendarStatusDto> {
    const p = await this.ownProfile(userId);
    this.requireLinkWhenListed(p.enabled, p.meetingUrl, { googleRefreshToken: null, googleError: null });
    const token = p.googleRefreshToken ? this.google.decrypt(p.googleRefreshToken) : null;
    if (token) await this.google.revoke(token);
    const updated = await this.prisma.consultantProfile.update({ where: { id: p.id }, data: { googleRefreshToken: null, googleEmail: null, googleConnectedAt: null, googleError: null } });
    this.googleBusyCache.delete(p.id);
    await this.audit.log({ actorId: userId, action: 'consultant.google_disconnected', entityType: 'ConsultantProfile', entityId: p.id });
    return this.googleStatus(updated);
  }

  /** A listed expert needs a way to meet: a fixed link, or a Google Calendar that makes Meet links. */
  private requireLinkWhenListed(enabled: boolean, meetingUrl: string, google: Pick<ConsultantProfile, 'googleRefreshToken' | 'googleError'>): void {
    if (enabled && !meetingUrl && !googleUsable(google)) {
      throw new BadRequestException({ code: 'LINK_OR_GOOGLE_NEEDED', message: 'A listed expert needs a meeting link or a connected Google Calendar' });
    }
  }

  /** Older confirmed calls without their own link use the expert's fixed link: it can change but not go empty. */
  private async keepLinkForConfirmed(consultantId: string, meetingUrl: string, now = new Date()): Promise<void> {
    if (meetingUrl) return;
    const ahead = await this.prisma.consultationBooking.count({ where: { consultantId, status: 'CONFIRMED', endsAt: { gt: now }, meetingUrl: null } });
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
      google: i.consultant ? { connected: Boolean(i.consultant.googleRefreshToken), email: i.consultant.googleEmail, error: i.consultant.googleError } : null,
      upcoming: i.consultant ? (count.get(i.consultant.id) ?? 0) : 0,
    }));
  }

  async upsertConsultant(admin: AuthUser, instructorId: string, input: AdminConsultantInput): Promise<ConsultantSettingsDto> {
    const instructor = await this.prisma.instructor.findUnique({ where: { id: instructorId }, select: { id: true, slug: true } });
    if (!instructor) throw new NotFoundException('Speaker not found');
    if (input.enabled && !instructor.slug) throw new BadRequestException({ code: 'NO_PUBLIC_PAGE', message: 'This speaker has no public page yet' });
    const existing = await this.prisma.consultantProfile.findUnique({ where: { instructorId } });
    this.requireLinkWhenListed(input.enabled, input.meetingUrl, existing ?? { googleRefreshToken: null, googleError: null });
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
    return rows.map((b) => this.adminDto(b, now));
  }

  async adminBooking(id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const b = await this.prisma.consultationBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return this.adminDto(b, now);
  }

  /** The checks "Mark paid" makes, before Google is asked and again under the lock. */
  private paidRefusal(b: Booking, admin: AuthUser, now: Date): void {
    if (b.studentId === admin.id) throw new ForbiddenException({ code: 'OWN_BOOKING', message: 'Another admin has to confirm your own booking' });
    if (b.status !== 'AWAITING_PAYMENT' && b.status !== 'EXPIRED') {
      throw new ConflictException({ code: 'NOT_AWAITING_PAYMENT', message: `This booking is ${b.status.toLowerCase().replace('_', ' ')}` });
    }
    if (b.startsAt <= now) throw new ConflictException({ code: 'IN_THE_PAST', message: 'This call has already started' });
  }

  /**
   * The payment was checked: the booking is confirmed and both sides get the link. With Google
   * connected, the call gets an event in the expert's calendar with its own Meet link (the student
   * is invited); otherwise, or if Google fails, the expert's fixed link. A lapsed reservation can
   * still be confirmed (the payment came late) when its slot is still free.
   */
  async markPaid(admin: AuthUser, id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const before = await this.prisma.consultationBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!before) throw new NotFoundException('Booking not found');
    this.paidRefusal(before, admin, now);
    const event = await this.withGoogle(before.consultant, (token) =>
      this.google.createEvent(token, {
        requestId: before.id,
        summary: this.calendarTitle(before, 'expert', before.consultant.instructor.user?.locale ?? 'en'),
        description: `${before.reference}${before.note ? `\n\n${before.note}` : ''}`,
        start: before.startsAt,
        end: before.endsAt,
        attendeeEmail: before.student.email,
      }),
    );
    const link = event?.meetUrl || before.consultant.meetingUrl;
    const dropEvent = async () => {
      if (event) await this.withGoogle(before.consultant, (token) => this.google.deleteEvent(token, event.eventId));
    };
    if (!link) {
      await dropEvent();
      throw new ConflictException({ code: 'NO_MEETING_LINK', message: 'This expert has no meeting link (and no working Google Calendar): add one first' });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, before.consultantId);
        const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
        this.paidRefusal(b, admin, now);
        const clash = (await this.busy(tx, b.consultantId, now, b.id)).some((x) => x.startsAt < b.endsAt && b.startsAt < x.endsAt);
        if (clash) throw new ConflictException({ code: 'SLOT_TAKEN', message: 'Someone else has booked this time since. Arrange a new time with the student.' });
        const done = await tx.consultationBooking.updateMany({
          where: { id, status: b.status, updatedAt: b.updatedAt },
          data: { status: 'CONFIRMED', paidAt: now, paidById: admin.id, holdUntil: null, meetingUrl: link, googleEventId: event?.eventId ?? null },
        });
        if (done.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
        await this.audit.log({ actorId: admin.id, action: 'consultation.paid', entityType: 'ConsultationBooking', entityId: id, metadata: { google: Boolean(event) } }, tx);
        await this.outbox.enqueue(this.confirmedEmails(b, link, false), tx);
      });
    } catch (err) {
      await dropEvent();
      throw err;
    }
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
   * as refund due in Admin → Consultations) and the expert is told. As an expert: they're
   * unlisted, their Google connection is dropped, and their upcoming calls are cancelled with the
   * students told. Never throws: deletion must not fail on this.
   */
  async releaseForDeletedAccount(userId: string, now = new Date()): Promise<void> {
    const reason = 'The account was closed';
    const asStudent = await this.prisma.consultationBooking.findMany({ where: { studentId: userId, startsAt: { gt: now }, status: { in: ACTIVE } }, select: { id: true } });
    const profile = await this.prisma.consultantProfile.findFirst({ where: { instructor: { userId } } });
    const asExpert = profile
      ? await this.prisma.consultationBooking.findMany({ where: { consultantId: profile.id, startsAt: { gt: now }, status: { in: ACTIVE } }, select: { id: true } })
      : [];
    for (const [rows, by] of [
      [asStudent, 'student'],
      [asExpert, 'expert'],
    ] as const) {
      for (const { id } of rows) {
        await this.cancel(id, by, userId, reason, now, (_b, status) => (isActive(status) ? null : 'gone')).catch(() => undefined);
      }
    }
    if (profile) {
      const token = profile.googleRefreshToken ? this.google.decrypt(profile.googleRefreshToken) : null;
      if (token) await this.google.revoke(token);
      await this.prisma.consultantProfile
        .update({ where: { id: profile.id }, data: { enabled: false, googleRefreshToken: null, googleEmail: null, googleConnectedAt: null, googleError: null } })
        .catch(() => undefined);
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

  /** "Tomorrow" (22–24 h ahead) and "in 1 hour" (10–75 min ahead) emails for confirmed calls. Each sends once per time. */
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
            // The time is part of the key: a moved call is reminded again at its new time.
            dedupeKey: `consultation-reminder${w.hours}:${b.id}:${role}:${b.startsAt.getTime()}`,
            template: {
              name: 'consultationReminder',
              role,
              otherName: this.otherName(b, role, to.locale),
              when: this.when(b, role, to.locale),
              hours: w.hours,
              meetingUrl: this.linkOf(b),
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
   * on the booking as it is now, so a cancel racing "Mark paid" sees the paid call. The call's
   * Google Calendar event (if any) is removed afterwards.
   */
  private async cancel(
    id: string,
    by: CancelledBy,
    actorId: string,
    reason: string,
    now: Date,
    refusal: (b: Booking, status: ConsultationStatus) => string | null,
  ): Promise<void> {
    const b = await this.prisma.$transaction(async (tx) => {
      const head = await tx.consultationBooking.findUnique({ where: { id }, select: { consultantId: true } });
      if (!head) throw new NotFoundException('Booking not found');
      await this.lock(tx, head.consultantId);
      const current = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      const refused = refusal(current, this.status(current, now));
      if (refused) throw new ConflictException({ code: 'CANNOT_CANCEL', message: refused });
      const wasPaid = current.status === 'CONFIRMED';
      const r = await tx.consultationBooking.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: by, cancelReason: reason || null, holdUntil: null },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      await this.audit.log({ actorId, action: 'consultation.cancelled', entityType: 'ConsultationBooking', entityId: current.id, metadata: { by, wasPaid } }, tx);
      // The student always hears; the expert is emailed only about confirmed calls (unpaid ones never reached their inbox).
      const emails = [this.cancelledEmail(current, 'student', by, reason, wasPaid)];
      if (wasPaid) emails.push(this.cancelledEmail(current, 'expert', by, reason, wasPaid));
      await this.outbox.enqueue(emails.filter((e): e is OutboxMessage => e !== null), tx);
      return current;
    });
    this.outbox.kick();
    if (b.googleEventId) await this.withGoogle(b.consultant, (token) => this.google.deleteEvent(token, b.googleEventId!));
  }

  /** As shown: an unpaid reservation past its hold is EXPIRED even before the job stores it. */
  private status(b: ConsultationBooking, now: Date): ConsultationStatus {
    if (b.status === 'AWAITING_PAYMENT' && b.holdUntil && b.holdUntil <= now) return 'EXPIRED';
    return b.status as ConsultationStatus;
  }

  /** The call's link: its own (set when confirmed), else the expert's fixed one (calls confirmed before links were per call). */
  private linkOf(b: Booking): string {
    return b.meetingUrl || b.consultant.meetingUrl;
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
      meetingUrl: status === 'CONFIRMED' ? this.linkOf(b) || null : null,
      consultant: { slug: b.consultant.instructor.slug ?? '', name: b.consultant.instructor.name, nameAr: b.consultant.instructor.nameAr, photoUrl: b.consultant.instructor.photoUrl },
      canCancel: as === 'student' ? studentCanCancel({ status }) : isActive(status) && (as === 'admin' || b.startsAt > now),
      rescheduleCount: b.rescheduleCount,
      canReschedule: as === 'student' && studentCanReschedule({ status, startsAt: b.startsAt, rescheduleCount: b.rescheduleCount }, now),
    };
  }

  private adminDto(b: Booking, now: Date): ConsultationBookingAdminDto {
    return {
      ...this.dto(b, now, 'admin'),
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
    return this.email.url(locale, role === 'student' ? `/consultations/bookings/${b.id}` : '/consultations/expert');
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
      methods: consultationPaymentMethods(s).map((m) => `${CONSULTATION_WALLET_LABELS[m.kind][locale]}: ${m.handle}${m.name ? ` (${m.name})` : ''}`),
      whatsappUrl: wa ? `${whatsappUrl(wa)}?text=${encodeURIComponent(text)}` : '',
      url: this.bookingUrl(b, 'student', locale),
    };
    return [{ userId: b.studentId, locale, template, category: 'consultation', lane: 'transactional', dedupeKey: `consultation-reserved:${b.id}` }];
  }

  /** "Confirmed" after payment, or "moved" after a reschedule (the new time is part of that key). */
  private confirmedEmails(b: Booking, link: string, moved: boolean): OutboxMessage[] {
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
        dedupeKey: moved ? `consultation-moved:${b.id}:${role}:${b.startsAt.getTime()}` : `consultation-confirmed:${b.id}:${role}`,
        template: {
          name: 'consultationConfirmed',
          role,
          moved,
          otherName: this.otherName(b, role, to.locale),
          when: this.when(b, role, to.locale),
          durationMin: b.durationMin,
          meetingUrl: link,
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
