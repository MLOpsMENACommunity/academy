import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  availabilitySchema,
  CONSULTATION_MAX_UNBOOKED,
  consultationPaymentMethods,
  consultationPrice,
  consultationPurchaseSchema,
  consultationSlots,
  googleCalendarLink,
  normalizeTransactionRef,
  realValue,
  studentCanReschedule,
  UNBOOKED_CONSULTATION_STATUSES,
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
  type ConsultationPaymentDto,
  type ConsultationStatus,
  type ConsultationWallet,
  type ExpertOverviewDto,
  type GoogleCalendarStatusDto,
  type Locale,
  type MyConsultationDto,
} from '@academy/shared';
import { Prisma, type ConsultantProfile, type ConsultationBooking, type Instructor } from '@prisma/client';
import { formatDueAt } from '../assessments/due-format';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import type { AuthUser } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { buildIcs } from '../learn/ics';
import { NotificationsService } from '../notifications/notifications.service';
import { Outbox, type OutboxMessage } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { detectFileType, MAX_UPLOAD_BYTES } from '../storage/file-type';
import { SIGNED_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { GoogleCalendar, GoogleCalendarExpired } from './google-calendar';

const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Busy times read from an expert's Google Calendar are reused this long for the slot lists. */
const GOOGLE_BUSY_CACHE_MS = 2 * 60_000;
const UNBOOKED = [...UNBOOKED_CONSULTATION_STATUSES];

type Profile = ConsultantProfile & { instructor: Instructor & { user: { id: string; email: string; locale: Locale } | null } };
type Booking = ConsultationBooking & {
  consultant: Profile;
  student: { id: string; email: string; locale: Locale; profile: { fullNameEn: string | null; fullNameAr: string | null; timezone: string | null } | null };
};
type Booked = Booking & { startsAt: Date; endsAt: Date };

const profileInclude = { instructor: { include: { user: { select: { id: true, email: true, locale: true } } } } } as const;
const bookingInclude = {
  consultant: { include: profileInclude },
  student: { select: { id: true, email: true, locale: true, profile: { select: { fullNameEn: true, fullNameAr: true, timezone: true } } } },
} as const;

export type CancelledBy = 'student' | 'expert' | 'admin';

const isBooked = (b: Booking): b is Booked => b.startsAt !== null && b.endsAt !== null;

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
 * Consultations: paid 1:1 calls with speakers, pay first, then book.
 *
 * The student sees an expert's open times, picks a call length and pays by InstaPay or a mobile
 * wallet, uploading the transfer screenshot (PAYMENT_REVIEW). A FINANCE admin checks it and
 * approves (PAID: the student is emailed and notified to book) or rejects it (REJECTED, with a
 * reason). The student then books one of the open times (CONFIRMED) and both sides get the link.
 * Paid calls aren't refunded to the student: they can move a booked call once, 24 hours ahead.
 * The expert or the academy can cancel a paid call (CANCELLED; the refund is arranged by hand).
 *
 * Booking and moving lock the expert's profile row, so two students can never hold overlapping
 * calls with the same expert. Emails go through the outbox, in the same transaction as the change.
 *
 * An expert who connected Google Calendar: their busy times hide slots, and a booked call gets an
 * event in their calendar with its own Meet link (the student is invited); moving or cancelling
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
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
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

  /** The open times of a listed expert: what a student sees before paying. */
  async slots(slug: string, durationMin: number, now = new Date()): Promise<string[]> {
    const p = await this.listed(slug);
    if (consultationPrice(p, durationMin) === null) return [];
    return this.openTimes(p, durationMin, now);
  }

  private async openTimes(p: ConsultantProfile, durationMin: number, now: Date, exceptId?: string): Promise<string[]> {
    const busy = [
      ...(await this.busy(this.prisma, p.id, now, exceptId)),
      ...(await this.googleBusy(p, now, new Date(now.getTime() + (p.horizonDays + 1) * 86_400_000), true)),
    ];
    return consultationSlots({ ...p, availability: availabilityOf(p) }, durationMin, busy, now).map((d) => d.toISOString());
  }

  /** Booked calls (the only ones that hold a time). */
  private async busy(db: Prisma.TransactionClient, consultantId: string, now: Date, exceptId?: string): Promise<BusyRange[]> {
    const rows = await db.consultationBooking.findMany({
      where: { consultantId, status: 'CONFIRMED', endsAt: { gt: now }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { startsAt: true, endsAt: true },
    });
    return rows.map((r) => ({ startsAt: r.startsAt!, endsAt: r.endsAt! }));
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
   * a failure never blocks booking). `cached` reuses a recent answer for the slot lists; booking
   * and moving always ask again.
   */
  private async googleBusy(p: ConsultantProfile, from: Date, to: Date, cached = false): Promise<BusyRange[]> {
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

  /** The expert has something else in their Google Calendar then (asked fresh, not from the cache). */
  private async refuseIfGoogleBusy(p: ConsultantProfile, startsAt: Date, endsAt: Date): Promise<void> {
    const busy = await this.googleBusy(p, startsAt, endsAt);
    if (busy.some((b) => b.startsAt < endsAt && startsAt < b.endsAt)) {
      throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time is no longer available. Pick another one.' });
    }
  }

  // ------------------------------------------------------------------ students: paying

  /** How to pay: the wallets set in Settings (empty = payments aren't open yet). */
  async payment(): Promise<ConsultationPaymentDto> {
    const s = await this.settings.get();
    return { methods: consultationPaymentMethods(s), supportWhatsapp: realValue(s.supportWhatsapp) };
  }

  /** Pays for a call: the transfer screenshot goes to the academy for review. */
  async purchase(session: AuthUser, slug: string, fields: Record<string, unknown>, file: Express.Multer.File | undefined): Promise<MyConsultationDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email address before paying for a call' });
    }
    const p = await this.listed(slug);
    if (p.instructor.userId === session.id) throw new BadRequestException({ code: 'OWN_PROFILE', message: "You can't book a call with yourself" });
    const parsed = consultationPurchaseSchema.safeParse(fields);
    if (!parsed.success) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const input = parsed.data;
    const price = consultationPrice(p, input.durationMin);
    if (price === null) throw new BadRequestException({ code: 'DURATION_NOT_OFFERED', message: 'This expert does not offer that call length' });
    const methods = consultationPaymentMethods(await this.settings.get());
    if (!methods.length) throw new ServiceUnavailableException({ code: 'PAYMENTS_NOT_SET_UP', message: 'Payments open once the academy has set up payment details' });
    if (!methods.some((m) => m.kind === input.method)) throw new BadRequestException({ code: 'METHOD_NOT_AVAILABLE', message: 'This payment method is not available. Choose another one.' });
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Upload a screenshot of the payment' });
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'The file must be 5 MB or smaller' });
    const mime = detectFileType(file.buffer);
    if (!mime) throw new BadRequestException({ code: 'FILE_TYPE', message: 'Upload a JPG, PNG or PDF file' });
    const unbooked = await this.prisma.consultationBooking.count({ where: { studentId: session.id, status: { in: UNBOOKED } } });
    if (unbooked >= CONSULTATION_MAX_UNBOOKED) {
      throw new ConflictException({ code: 'TOO_MANY_UNBOOKED', message: 'Book a time for the calls you already paid for before paying for another' });
    }

    const key = await this.storage.put('payments', file.buffer, mime);
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const created = await this.createWithReference(tx, {
          consultantId: p.id,
          studentId: session.id,
          durationMin: input.durationMin,
          priceEgp: price,
          note: input.note,
          method: input.method,
          transactionRef: input.transactionRef,
          screenshotKey: key,
          screenshotSha256: sha256(file.buffer),
          screenshotMime: mime,
        });
        const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
        await this.outbox.enqueue([this.studentEmail(b, 'received', `consultation-received:${b.id}`)], tx);
        return created.id;
      });
    } catch (err) {
      await this.storage.delete(key).catch(() => this.logger.warn(`Orphaned consultation screenshot needs manual deletion: ${key}`));
      throw err;
    }
    this.outbox.kick();
    await this.notifications
      .notifyAdmins(
        {
          type: 'consultation.payment',
          titleEn: 'Consultation payment to review',
          titleAr: 'دفع استشارة للمراجعة',
          bodyEn: `${p.instructor.name}, ${input.durationMin} min, EGP ${price}`,
          bodyAr: `${p.instructor.nameAr || p.instructor.name}، ${input.durationMin} دقيقة، ${price} جنيه`,
          link: '/admin/consultations',
        },
        ['FINANCE'],
      )
      .catch(() => undefined);
    return this.mine(session, id);
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
    const rows = await this.prisma.consultationBooking.findMany({ where: { studentId: session.id }, include: bookingInclude, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => this.dto(b, now, 'student'));
  }

  async mine(session: AuthUser, id: string, now = new Date()): Promise<MyConsultationDto> {
    return this.dto(await this.own(session, id), now, 'student');
  }

  private async own(session: AuthUser, id: string): Promise<Booking> {
    const b = await this.prisma.consultationBooking.findFirst({ where: { id, studentId: session.id }, include: bookingInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  // ------------------------------------------------------------------ students: booking a time

  /** The open times for one of my paid calls (the expert's, even if they were unlisted since I paid). */
  async myOpenTimes(session: AuthUser, id: string, now = new Date()): Promise<string[]> {
    const b = await this.own(session, id);
    if (b.status !== 'PAID' && b.status !== 'CONFIRMED') return [];
    return this.openTimes(b.consultant, b.durationMin, now, b.id);
  }

  /** Books a time for a paid call. With Google connected, the call gets its own Meet link and an event. */
  async book(session: AuthUser, id: string, startsAtIso: string, now = new Date()): Promise<MyConsultationDto> {
    const before = await this.own(session, id);
    if (before.status !== 'PAID') throw new ConflictException({ code: 'NOT_PAID', message: 'This call is not ready to book' });
    const startsAt = new Date(startsAtIso);
    const endsAt = new Date(startsAt.getTime() + before.durationMin * 60_000);
    await this.refuseIfGoogleBusy(before.consultant, startsAt, endsAt);
    const timed = { ...before, startsAt, endsAt };
    const event = await this.withGoogle(before.consultant, (token) =>
      this.google.createEvent(token, {
        requestId: `${before.id}-${startsAt.getTime()}`,
        summary: this.calendarTitle(timed, 'expert', before.consultant.instructor.user?.locale ?? 'en'),
        description: `${before.reference}${before.note ? `\n\n${before.note}` : ''}`,
        start: startsAt,
        end: endsAt,
        attendeeEmail: before.student.email,
      }),
    );
    const link = event?.meetUrl || before.consultant.meetingUrl;
    const dropEvent = async () => {
      if (event) await this.withGoogle(before.consultant, (token) => this.google.deleteEvent(token, event.eventId));
    };
    if (!link) {
      await dropEvent();
      throw new ConflictException({ code: 'NO_MEETING_LINK', message: "This expert can't take calls right now. Contact us on WhatsApp." });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, before.consultantId);
        const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
        if (b.status !== 'PAID') throw new ConflictException({ code: 'NOT_PAID', message: 'This call is not ready to book' });
        await this.requireOpen(tx, b, startsAt, now);
        const r = await tx.consultationBooking.updateMany({
          where: { id, status: 'PAID', updatedAt: b.updatedAt },
          data: { status: 'CONFIRMED', startsAt, endsAt, meetingUrl: link, googleEventId: event?.eventId ?? null },
        });
        if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
        await this.audit.log({ actorId: session.id, action: 'consultation.booked', entityType: 'ConsultationBooking', entityId: id, metadata: { google: Boolean(event) } }, tx);
        await this.outbox.enqueue(this.confirmedEmails({ ...b, startsAt, endsAt, meetingUrl: link }, false), tx);
      });
    } catch (err) {
      await dropEvent();
      throw err;
    }
    this.outbox.kick();
    return this.mine(session, id, now);
  }

  /** Under the expert's lock: the time is one of their open times right now. */
  private async requireOpen(tx: Prisma.TransactionClient, b: Booking, startsAt: Date, now: Date): Promise<void> {
    const busy = await this.busy(tx, b.consultantId, now, b.id);
    const open = consultationSlots({ ...b.consultant, availability: availabilityOf(b.consultant) }, b.durationMin, busy, now);
    if (!open.some((s) => s.getTime() === startsAt.getTime())) {
      throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time is no longer available. Pick another one.' });
    }
  }

  /** Moves a booked call to another open time of the same expert, once, up to 24 hours before. */
  async reschedule(session: AuthUser, id: string, startsAtIso: string, now = new Date()): Promise<MyConsultationDto> {
    const before = await this.own(session, id);
    const startsAt = new Date(startsAtIso);
    const endsAt = new Date(startsAt.getTime() + before.durationMin * 60_000);
    await this.refuseIfGoogleBusy(before.consultant, startsAt, endsAt);

    const moved = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, before.consultantId);
      const b = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      if (!studentCanReschedule(b as { status: ConsultationStatus; startsAt: Date | null; rescheduleCount: number }, now)) {
        throw new ConflictException({ code: 'CANNOT_RESCHEDULE', message: 'This call can no longer be moved' });
      }
      if (startsAt.getTime() === b.startsAt?.getTime()) throw new ConflictException({ code: 'SLOT_TAKEN', message: 'Pick a different time' });
      await this.requireOpen(tx, b, startsAt, now);
      const r = await tx.consultationBooking.updateMany({
        where: { id, status: 'CONFIRMED', updatedAt: b.updatedAt },
        data: { startsAt, endsAt, rescheduleCount: { increment: 1 } },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      await this.audit.log(
        { actorId: session.id, action: 'consultation.rescheduled', entityType: 'ConsultationBooking', entityId: id, metadata: { from: b.startsAt?.toISOString(), to: startsAt.toISOString() } },
        tx,
      );
      const after = { ...b, startsAt, endsAt };
      await this.outbox.enqueue(this.confirmedEmails(after, true), tx);
      return after;
    });
    this.outbox.kick();
    if (moved.googleEventId) await this.withGoogle(moved.consultant, (token) => this.google.moveEvent(token, moved.googleEventId!, startsAt, endsAt));
    return this.mine(session, id, now);
  }

  /** The .ics of a booked call, for the student or the expert. No meeting link inside. */
  async ics(session: AuthUser, id: string, now = new Date()): Promise<string> {
    const b = await this.prisma.consultationBooking.findFirst({
      where: { id, status: 'CONFIRMED', OR: [{ studentId: session.id }, { consultant: { instructor: { userId: session.id } } }] },
      include: bookingInclude,
    });
    if (!b || !isBooked(b)) throw new NotFoundException('Booking not found');
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

  /** The expert's calls: booked ones from the last 30 days on, and paid ones waiting for a time. */
  async expertOverview(userId: string, now = new Date()): Promise<ExpertOverviewDto> {
    const p = await this.ownProfile(userId);
    const rows = await this.prisma.consultationBooking.findMany({
      where: {
        consultantId: p.id,
        OR: [{ status: 'PAID' }, { status: { in: ['CONFIRMED', 'CANCELLED'] }, endsAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } }],
      },
      include: bookingInclude,
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    });
    return { settings: settingsOf(p), google: this.googleStatus(p), bookings: rows.map((b) => this.expertDto(b, now)) };
  }

  async updateExpertSettings(userId: string, input: ConsultantSettingsInput): Promise<ConsultantSettingsDto> {
    const p = await this.ownProfile(userId);
    if (p.enabled && input.price30Egp === null && input.price60Egp === null) {
      throw new BadRequestException({ code: 'LISTED_NEEDS_LINK_AND_PRICE', message: 'While you are listed, keep at least one price' });
    }
    this.requireLinkWhenListed(p.enabled, input.meetingUrl, p);
    const updated = await this.prisma.consultantProfile.update({ where: { id: p.id }, data: { ...input, availability: input.availability as Prisma.InputJsonValue } });
    await this.audit.log({ actorId: userId, action: 'consultant.settings_updated', entityType: 'ConsultantProfile', entityId: p.id });
    return settingsOf(updated);
  }

  async expertCancel(userId: string, id: string, reason: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const p = await this.ownProfile(userId);
    const own = await this.prisma.consultationBooking.findFirst({ where: { id, consultantId: p.id }, select: { id: true } });
    if (!own) throw new NotFoundException('Booking not found');
    await this.cancel(id, 'expert', userId, reason, now, (b) => (this.cancellable(b, now) ? null : 'Only paid calls that have not happened yet can be cancelled'));
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

  // ------------------------------------------------------------------ admin

  async adminConsultants(now = new Date()): Promise<AdminConsultantRowDto[]> {
    const instructors = await this.prisma.instructor.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, userId: true, consultant: true },
    });
    const upcoming = await this.prisma.consultationBooking.groupBy({
      by: ['consultantId'],
      where: { OR: [{ status: 'PAID' }, { status: 'CONFIRMED', startsAt: { gt: now } }] },
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
    const data = { ...input, availability: input.availability as Prisma.InputJsonValue };
    const p = await this.prisma.consultantProfile.upsert({ where: { instructorId }, create: { instructorId, ...data }, update: data });
    await this.audit.log({ actorId: admin.id, action: 'consultant.updated', entityType: 'ConsultantProfile', entityId: p.id, metadata: { instructorId, enabled: input.enabled } });
    return settingsOf(p);
  }

  async adminBookings(status: ConsultationStatus | undefined, now = new Date()): Promise<ConsultationBookingAdminDto[]> {
    const rows = await this.prisma.consultationBooking.findMany({
      where: status ? { status } : {},
      include: bookingInclude,
      // The review queue oldest first (fair), everything else newest first.
      orderBy: { createdAt: status === 'PAYMENT_REVIEW' ? 'asc' : 'desc' },
      take: 500,
    });
    return this.adminDtos(rows, now);
  }

  async adminBooking(id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    const b = await this.prisma.consultationBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return (await this.adminDtos([b], now))[0]!;
  }

  /** A short-lived link to the payment screenshot. Every view is audited. */
  async screenshotUrl(admin: AuthUser, id: string): Promise<{ url: string; mime: string | null; expiresIn: number }> {
    const b = await this.prisma.consultationBooking.findUnique({ where: { id }, select: { screenshotKey: true, screenshotMime: true } });
    if (!b) throw new NotFoundException('Booking not found');
    if (!b.screenshotKey) throw new NotFoundException({ code: 'SCREENSHOT_DELETED', message: 'The screenshot was deleted by the retention policy' });
    await this.audit.log({ actorId: admin.id, action: 'consultation.screenshot_viewed', entityType: 'ConsultationBooking', entityId: id });
    return { url: await this.storage.signedUrl(b.screenshotKey), mime: b.screenshotMime, expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  /** The payment checks out: the student is emailed and notified to book a time. */
  async approve(admin: AuthUser, id: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    await this.review(admin, id, now, { status: 'PAID', paidAt: now }, 'approved');
    return this.adminBooking(id, now);
  }

  /** The payment doesn't check out: the student is told why. */
  async reject(admin: AuthUser, id: string, reason: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    await this.review(admin, id, now, { status: 'REJECTED', rejectionReason: reason }, 'rejected');
    return this.adminBooking(id, now);
  }

  private async review(admin: AuthUser, id: string, now: Date, data: Prisma.ConsultationBookingUpdateManyMutationInput, kind: 'approved' | 'rejected'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.consultationBooking.findUnique({ where: { id }, include: bookingInclude });
      if (!b) throw new NotFoundException('Booking not found');
      if (b.studentId === admin.id) throw new ForbiddenException({ code: 'OWN_BOOKING', message: 'Another admin has to review your own payment' });
      if (b.status !== 'PAYMENT_REVIEW') throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This payment has already been reviewed' });
      const r = await tx.consultationBooking.updateMany({ where: { id, status: 'PAYMENT_REVIEW' }, data: { ...data, reviewedById: admin.id, reviewedAt: now } });
      if (r.count !== 1) throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This payment has already been reviewed' });
      await this.audit.log({ actorId: admin.id, action: `consultation.payment_${kind}`, entityType: 'ConsultationBooking', entityId: id }, tx);
      const after = { ...b, rejectionReason: (data.rejectionReason as string | undefined) ?? null };
      await this.outbox.enqueue([this.studentEmail(after, kind, `consultation-${kind}:${b.id}`)], tx);
      const name = { en: expertName(b.consultant.instructor, 'en'), ar: expertName(b.consultant.instructor, 'ar') };
      await this.notifications.create(
        b.studentId,
        kind === 'approved'
          ? {
              type: 'consultation.paid',
              titleEn: `Payment confirmed: book your call with ${name.en}`,
              titleAr: `تأكد الدفع: احجز موعد مكالمتك مع ${name.ar}`,
              bodyEn: 'Pick one of the open times on your booking page.',
              bodyAr: 'اختر أحد المواعيد المتاحة من صفحة الحجز.',
              link: `/consultations/bookings/${b.id}`,
            }
          : {
              type: 'consultation.rejected',
              titleEn: `Payment not confirmed for your call with ${name.en}`,
              titleAr: `لم يتأكد الدفع لمكالمتك مع ${name.ar}`,
              bodyEn: `Reason: ${data.rejectionReason as string}`,
              bodyAr: `السبب: ${data.rejectionReason as string}`,
              link: `/consultations/bookings/${b.id}`,
            },
        tx,
      );
    });
    this.outbox.kick();
  }

  async adminCancel(admin: AuthUser, id: string, reason: string, now = new Date()): Promise<ConsultationBookingAdminDto> {
    await this.cancel(id, 'admin', admin.id, reason, now, (b) => (this.cancellable(b, now) ? null : 'Only paid calls that have not happened yet can be cancelled'));
    return this.adminBooking(id, now);
  }

  /** A paid call not booked yet, or a booked one still ahead. */
  private cancellable(b: ConsultationBooking, now: Date): boolean {
    return b.status === 'PAID' || (b.status === 'CONFIRMED' && b.startsAt !== null && b.startsAt > now);
  }

  // ------------------------------------------------------------------ deleted accounts

  /**
   * An account was deleted. As a student: their paid and pending calls are cancelled (refund due,
   * in Admin → Consultations) and the expert is told about booked ones. As an expert: they're
   * unlisted, their Google connection is dropped, and their paid calls are cancelled with the
   * students told. Never throws: deletion must not fail on this.
   */
  async releaseForDeletedAccount(userId: string, now = new Date()): Promise<void> {
    const reason = 'The account was closed';
    const open = { OR: [{ status: { in: UNBOOKED } }, { status: 'CONFIRMED', startsAt: { gt: now } }] };
    const asStudent = await this.prisma.consultationBooking.findMany({ where: { studentId: userId, ...open }, select: { id: true } });
    const profile = await this.prisma.consultantProfile.findFirst({ where: { instructor: { userId } } });
    const asExpert = profile ? await this.prisma.consultationBooking.findMany({ where: { consultantId: profile.id, ...open }, select: { id: true } }) : [];
    for (const [rows, by] of [
      [asStudent, 'student'],
      [asExpert, 'expert'],
    ] as const) {
      for (const { id } of rows) {
        await this.cancel(id, by, userId, reason, now, () => null).catch(() => undefined);
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

  /** "Tomorrow" (22–24 h ahead) and "in 1 hour" (10–75 min ahead) emails for booked calls. Each sends once per time. */
  async queueReminders(now = new Date()): Promise<number> {
    const windows: { hours: 24 | 1; from: number; to: number }[] = [
      { hours: 24, from: 22 * 60, to: 24 * 60 },
      { hours: 1, from: 10, to: 75 },
    ];
    const messages: OutboxMessage[] = [];
    for (const w of windows) {
      const due = await this.prisma.consultationBooking.findMany({
        where: {
          status: 'CONFIRMED',
          startsAt: { gte: new Date(now.getTime() + w.from * 60_000), lte: new Date(now.getTime() + w.to * 60_000) },
          // Booked or moved in the last 2 hours: the confirmation just went out, no "tomorrow" email on top.
          ...(w.hours === 24 ? { updatedAt: { lt: new Date(now.getTime() - 2 * 3_600_000) } } : {}),
        },
        include: bookingInclude,
      });
      for (const b of due.filter(isBooked)) {
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

  /** Retention: screenshots older than the setting go (never one still waiting for review); the record stays. */
  async purgeOldScreenshots(now = new Date()): Promise<number> {
    const { screenshotRetentionDays } = await this.settings.get();
    const due = await this.prisma.consultationBooking.findMany({
      where: { screenshotKey: { not: null }, createdAt: { lt: new Date(now.getTime() - screenshotRetentionDays * 86_400_000) }, status: { not: 'PAYMENT_REVIEW' } },
      select: { id: true, screenshotKey: true },
      take: 500,
    });
    let removed = 0;
    for (const b of due) {
      try {
        await this.storage.delete(b.screenshotKey!);
      } catch {
        continue; // retried on the next run; the key stays referenced
      }
      await this.prisma.consultationBooking.update({ where: { id: b.id }, data: { screenshotKey: null, screenshotDeletedAt: now } });
      removed++;
    }
    return removed;
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Cancels under the expert's lock, judging the rule (`refusal`: a message, or null to allow) on
   * the booking as it is now. A paid call cancelled this way is refunded (by hand). The call's
   * Google Calendar event (if any) is removed afterwards.
   */
  private async cancel(id: string, by: CancelledBy, actorId: string, reason: string, now: Date, refusal: (b: Booking) => string | null): Promise<void> {
    const b = await this.prisma.$transaction(async (tx) => {
      const head = await tx.consultationBooking.findUnique({ where: { id }, select: { consultantId: true } });
      if (!head) throw new NotFoundException('Booking not found');
      await this.lock(tx, head.consultantId);
      const current = await tx.consultationBooking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      const refused = refusal(current);
      if (refused) throw new ConflictException({ code: 'CANNOT_CANCEL', message: refused });
      const r = await tx.consultationBooking.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: by, cancelReason: reason || null },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CHANGED', message: 'This booking changed meanwhile. Reload and try again.' });
      const wasPaid = current.status === 'PAID' || current.status === 'CONFIRMED';
      await this.audit.log({ actorId, action: 'consultation.cancelled', entityType: 'ConsultationBooking', entityId: current.id, metadata: { by, wasPaid } }, tx);
      // The student always hears; the expert only about calls that had a time (the others never reached them).
      const emails = [this.cancelledEmail(current, 'student', by, reason, wasPaid)];
      if (isBooked(current)) emails.push(this.cancelledEmail(current, 'expert', by, reason, wasPaid));
      await this.outbox.enqueue(emails.filter((e): e is OutboxMessage => e !== null), tx);
      return current;
    });
    this.outbox.kick();
    if (b.googleEventId) await this.withGoogle(b.consultant, (token) => this.google.deleteEvent(token, b.googleEventId!));
  }

  /** The call's link: set when it was booked (a Meet link, or the expert's fixed link then). */
  private linkOf(b: Booking): string {
    return b.meetingUrl || b.consultant.meetingUrl;
  }

  private dto(b: Booking, now: Date, as: 'student' | 'expert' | 'admin'): ConsultationBookingDto {
    const status = b.status as ConsultationStatus;
    return {
      id: b.id,
      reference: b.reference,
      status,
      durationMin: b.durationMin,
      priceEgp: b.priceEgp,
      note: b.note,
      method: b.method as ConsultationWallet,
      transactionRef: as === 'expert' ? '' : b.transactionRef,
      createdAt: b.createdAt.toISOString(),
      paidAt: b.paidAt?.toISOString() ?? null,
      rejectionReason: b.rejectionReason,
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      cancelReason: b.cancelReason,
      meetingUrl: status === 'CONFIRMED' ? this.linkOf(b) || null : null,
      consultant: {
        slug: b.consultant.instructor.slug ?? '',
        name: b.consultant.instructor.name,
        nameAr: b.consultant.instructor.nameAr,
        photoUrl: b.consultant.instructor.photoUrl,
        horizonDays: b.consultant.horizonDays,
      },
      canBook: as === 'student' && status === 'PAID',
      rescheduleCount: b.rescheduleCount,
      canReschedule: as === 'student' && studentCanReschedule({ status, startsAt: b.startsAt, rescheduleCount: b.rescheduleCount }, now),
      canCancel: as !== 'student' && this.cancellable(b, now),
    };
  }

  /** Admins: who paid, the proof, and other bookings that used the same screenshot or reference. */
  private async adminDtos(rows: Booking[], now: Date): Promise<ConsultationBookingAdminDto[]> {
    const shas = [...new Set(rows.map((b) => b.screenshotSha256).filter((x): x is string => Boolean(x)))];
    const refs = [...new Set(rows.map((b) => normalizeTransactionRef(b.transactionRef)).filter(Boolean))];
    const others = shas.length || refs.length
      ? await this.prisma.consultationBooking.findMany({
          where: { OR: [{ screenshotSha256: { in: shas } }, ...(refs.length ? [{ transactionRef: { not: '' } }] : [])] },
          select: { id: true, reference: true, screenshotSha256: true, transactionRef: true },
        })
      : [];
    return rows.map((b) => {
      const ref = normalizeTransactionRef(b.transactionRef);
      const same = others
        .filter((o) => o.id !== b.id && ((b.screenshotSha256 && o.screenshotSha256 === b.screenshotSha256) || (ref && normalizeTransactionRef(o.transactionRef) === ref)))
        .map((o) => o.reference);
      return {
        ...this.dto(b, now, 'admin'),
        student: { id: b.student.id, name: studentName(b.student), email: b.student.email },
        hasScreenshot: Boolean(b.screenshotKey),
        sameProofAs: [...new Set(same)],
      };
    });
  }

  /** What the expert sees: the student's name and note, never their email or payment proof. */
  private expertDto(b: Booking, now: Date): ConsultationBookingAdminDto {
    return { ...this.dto(b, now, 'expert'), student: { id: b.student.id, name: studentName(b.student), email: null }, hasScreenshot: false, sameProofAs: [] };
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
  private when(b: Booked, role: 'student' | 'expert', locale: Locale): string {
    return formatDueAt(b.startsAt, locale, role === 'student' ? b.student.profile?.timezone : b.consultant.timezone);
  }

  private bookingUrl(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    return this.email.url(locale, role === 'student' ? `/consultations/bookings/${b.id}` : '/consultations/expert');
  }

  private calendarTitle(b: Booking, role: 'student' | 'expert', locale: Locale): string {
    const other = this.otherName(b, role, locale);
    return locale === 'ar' ? `مكالمة مع ${other} (MLOps MENA)` : `Call with ${other} (MLOps MENA)`;
  }

  /** To the student about their payment: received, approved (book a time) or rejected (why). */
  private studentEmail(b: Booking, kind: 'received' | 'approved' | 'rejected', dedupeKey: string): OutboxMessage {
    const locale = b.student.locale;
    return {
      userId: b.studentId,
      locale,
      category: 'consultation',
      lane: 'transactional',
      dedupeKey,
      template: {
        name: 'consultationPayment',
        kind,
        expertName: expertName(b.consultant.instructor, locale),
        durationMin: b.durationMin,
        priceEgp: b.priceEgp,
        reference: b.reference,
        reason: b.rejectionReason ?? '',
        url: this.bookingUrl(b, 'student', locale),
      },
    };
  }

  /** "Confirmed" when a time is booked, or "moved" after a reschedule (the new time is part of that key). */
  private confirmedEmails(b: Booked, moved: boolean): OutboxMessage[] {
    const out: OutboxMessage[] = [];
    const link = this.linkOf(b);
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

  private cancelledEmail(b: Booking, role: 'student' | 'expert', by: CancelledBy, reason: string, wasPaid: boolean): OutboxMessage | null {
    const to = this.recipient(b, role);
    if (!to) return null;
    return {
      userId: to.id,
      locale: to.locale,
      category: 'consultation',
      lane: 'transactional',
      dedupeKey: `consultation-cancelled:${b.id}:${role}`,
      template: {
        name: 'consultationCancelled',
        role,
        otherName: this.otherName(b, role, to.locale),
        when: isBooked(b) ? this.when(b, role, to.locale) : '',
        by,
        wasPaid,
        reason,
        url: this.bookingUrl(b, role, to.locale),
      },
    };
  }
}
