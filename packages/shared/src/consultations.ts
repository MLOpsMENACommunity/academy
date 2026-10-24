import { z } from 'zod';
import { realValue } from './settings';
import { isValidTimezone } from './time';

// ------------------------------------------------------------------ rules

/** Call lengths a student can book. */
export const CONSULTATION_DURATIONS = [30, 60] as const;
export type ConsultationDuration = (typeof CONSULTATION_DURATIONS)[number];

/** Slots start on the hour and half hour of the expert's own clock. */
export const CONSULTATION_SLOT_STEP_MIN = 30;

/** The shortest notice an expert can ask for (the call is booked after the payment is approved, so no hold is needed). */
export const CONSULTATION_MIN_NOTICE_HOURS = 3;
/** Calls one student may have paid for (or be waiting on review for) without a time yet. */
export const CONSULTATION_MAX_UNBOOKED = 3;
/**
 * Paid calls aren't refunded to a student who changes their mind: instead they may move a
 * booked call to another open time, once, up to this many hours before it starts. (When the
 * expert or the academy cancels, the student is refunded.)
 */
export const CONSULTATION_RESCHEDULE_HOURS = 24;
export const CONSULTATION_MAX_RESCHEDULES = 1;

/** The wallets a consultation can be paid with, each offered once its number is set in Settings. */
export const CONSULTATION_WALLETS = ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH'] as const;
export type ConsultationWallet = (typeof CONSULTATION_WALLETS)[number];

type WalletSettings = {
  instapayHandle: string;
  instapayName: string;
  vodafoneCashNumber: string;
  vodafoneCashName: string;
  orangeCashNumber: string;
  orangeCashName: string;
  etisalatCashNumber: string;
  etisalatCashName: string;
};

/** The wallets with real details in Settings, in this order: InstaPay, Vodafone Cash, Orange Cash, e& money. */
export function consultationPaymentMethods(s: WalletSettings): ConsultationPaymentMethod[] {
  const all: [ConsultationWallet, string, string][] = [
    ['INSTAPAY', s.instapayHandle, s.instapayName],
    ['VODAFONE_CASH', s.vodafoneCashNumber, s.vodafoneCashName],
    ['ORANGE_CASH', s.orangeCashNumber, s.orangeCashName],
    ['ETISALAT_CASH', s.etisalatCashNumber, s.etisalatCashName],
  ];
  return all.filter(([, handle]) => realValue(handle)).map(([kind, handle, name]) => ({ kind, handle: realValue(handle), name: realValue(name) }));
}

/** "InstaPay", "Vodafone Cash", … in the reader's language. */
export const CONSULTATION_WALLET_LABELS: Record<ConsultationWallet, { en: string; ar: string }> = {
  INSTAPAY: { en: 'InstaPay', ar: 'InstaPay' },
  VODAFONE_CASH: { en: 'Vodafone Cash', ar: 'فودافون كاش' },
  ORANGE_CASH: { en: 'Orange Cash', ar: 'أورنج كاش' },
  ETISALAT_CASH: { en: 'e& money', ar: 'e& money' },
};

/**
 * Pay first, then book: PAYMENT_REVIEW (the student uploaded the transfer screenshot) → PAID (the
 * academy approved it; the student now picks a time) → CONFIRMED (a time is booked). A rejected
 * payment is REJECTED; the expert or the academy can cancel a paid call (CANCELLED, refunded).
 * Stored as text with a CHECK constraint (docs/ENGINEERING.md, "No new enums for state").
 */
export const CONSULTATION_STATUSES = ['PAYMENT_REVIEW', 'REJECTED', 'PAID', 'CONFIRMED', 'CANCELLED'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];
/** Paid for (or waiting on review) and not booked yet: limited per student. */
export const UNBOOKED_CONSULTATION_STATUSES = ['PAYMENT_REVIEW', 'PAID'] as const satisfies readonly ConsultationStatus[];

// ------------------------------------------------------------------ input

const HHMM = /^(?:[01]\d|2[0-3]):(?:00|30)$|^24:00$/;
const hhmm = z.string().regex(HHMM, 'Use a time on the hour or half hour, e.g. 18:00 or 18:30');

/** "18:30" → 1110. */
export function minutesOf(hhmmValue: string): number {
  const [h, m] = hhmmValue.split(':').map(Number);
  return h! * 60 + m!;
}

/** Weekly hours in the expert's time zone. weekday: 0 = Sunday … 6 = Saturday. */
export const availabilityWindowSchema = z
  .object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm })
  .refine((w) => minutesOf(w.start) < minutesOf(w.end), { message: 'The end must be after the start', path: ['end'] });
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

export const availabilitySchema = z
  .array(availabilityWindowSchema)
  .max(28, 'At most 28 time ranges a week')
  .refine(
    (ws) =>
      ws.every((a, i) =>
        ws.every((b, j) => j <= i || a.weekday !== b.weekday || minutesOf(a.end) <= minutesOf(b.start) || minutesOf(b.end) <= minutesOf(a.start)),
      ),
    'Time ranges on the same day must not overlap',
  );

/** At least 1 EGP: a free call would sit waiting for a payment that never comes (free office hours are v2). */
const price = z.number().int().min(1).max(100_000).nullable();

const settingsFields = {
  /** EGP for a 30-minute call; null = not offered. */
  price30Egp: price,
  /** EGP for a 60-minute call; null = not offered. */
  price60Egp: price,
  /** The expert's fixed Google Meet or Zoom link, sent once a booking is paid. */
  meetingUrl: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .url('Enter a full link, e.g. https://meet.google.com/abc-defg-hij')
      .max(500)
      .refine((u) => u.startsWith('https://'), 'The link must start with https://'),
  ]),
  timezone: z.string().trim().refine(isValidTimezone, 'Unknown time zone'),
  /** How far ahead a call must be booked. */
  minNoticeHours: z.number().int().min(CONSULTATION_MIN_NOTICE_HOURS).max(168),
  /** How many days ahead students can book. */
  horizonDays: z.number().int().min(1).max(90),
  availability: availabilitySchema,
};

/** What an expert edits in the speaker portal. Every field is required: a save replaces them all, so a missing one must not reset it. */
export const consultantSettingsSchema = z.object(settingsFields);
export type ConsultantSettingsInput = z.infer<typeof consultantSettingsSchema>;

/**
 * What an admin edits: the same, plus whether the expert is listed. Listing needs a price (checked
 * here) and a fixed link or a connected Google Calendar (checked by the API, which knows the latter).
 */
export const adminConsultantSchema = z
  .object({ ...settingsFields, enabled: z.boolean() })
  .refine((c) => !c.enabled || c.price30Egp !== null || c.price60Egp !== null, {
    message: 'Offer at least one call length before listing this expert',
    path: ['price30Egp'],
  });
export type AdminConsultantInput = z.infer<typeof adminConsultantSchema>;

/** Paying for a call (multipart form fields, so numbers arrive as text), with the screenshot as the file. */
export const consultationPurchaseSchema = z.object({
  durationMin: z.coerce.number().pipe(z.union([z.literal(30), z.literal(60)])),
  method: z.enum(CONSULTATION_WALLETS),
  /** The transfer's reference number, when the app shows one. */
  transactionRef: z.string().trim().max(100).default(''),
  /** What the student wants to talk about: shown to the expert. */
  note: z.string().trim().max(1000).default(''),
});
export type ConsultationPurchaseInput = z.infer<typeof consultationPurchaseSchema>;

/** Booking (or moving) a paid call to one of the expert's open times. */
export const consultationTimeSchema = z.object({ startsAt: z.string().datetime({ offset: true }) });
export type ConsultationTimeInput = z.infer<typeof consultationTimeSchema>;

export const consultationRejectSchema = z.object({ reason: z.string().trim().min(3, 'Say why, so the student can fix it').max(500) });
export type ConsultationRejectInput = z.infer<typeof consultationRejectSchema>;

export const consultationCancelSchema = z.object({ reason: z.string().trim().max(500).default('') });
export type ConsultationCancelInput = z.infer<typeof consultationCancelSchema>;

export const consultationSlotsQuerySchema = z.object({ duration: z.coerce.number().pipe(z.union([z.literal(30), z.literal(60)])) });

export const adminConsultationsQuerySchema = z.object({ status: z.enum(CONSULTATION_STATUSES).optional() });

// ------------------------------------------------------------------ time zones

interface LocalDay {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Building an Intl.DateTimeFormat is slow and the slot finder needs thousands of conversions: one per zone and kind. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(kind: 'day' | 'clock', timezone: string): Intl.DateTimeFormat {
  const key = `${kind}:${timezone}`;
  let f = formatters.get(key);
  if (!f) {
    f =
      kind === 'day'
        ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
        : new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    formatters.set(key, f);
  }
  return f;
}

/** The calendar day (and weekday) an instant falls on in a time zone. */
export function localDay(at: Date, timezone: string): LocalDay {
  const parts = formatter('day', timezone).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), weekday: WEEKDAYS.indexOf(get('weekday')) };
}

/** Minutes the zone is ahead of UTC at that instant (Cairo: 120 in winter, 180 in summer). */
function offsetMinutes(at: Date, timezone: string): number {
  const p = formatter('clock', timezone).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant a wall-clock time happens in a zone, or null when that time doesn't exist
 * there (skipped by a daylight-saving change). `minutes` may be 1440 (midnight that ends the day).
 */
export function zonedTime(day: Pick<LocalDay, 'year' | 'month' | 'day'>, minutes: number, timezone: string): Date | null {
  const wall = Date.UTC(day.year, day.month - 1, day.day, 0, minutes);
  let at = wall - offsetMinutes(new Date(wall), timezone) * 60_000;
  at = wall - offsetMinutes(new Date(at), timezone) * 60_000;
  const back = new Date(at);
  return back.getTime() + offsetMinutes(back, timezone) * 60_000 === wall ? back : null;
}

// ------------------------------------------------------------------ slots

export interface ConsultantSchedule {
  timezone: string;
  minNoticeHours: number;
  horizonDays: number;
  availability: AvailabilityWindow[];
}

export interface BusyRange {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Start times a student can book: inside the expert's weekly hours (their time zone), at
 * least minNoticeHours from now, within horizonDays, and not overlapping a call already held.
 */
export function consultationSlots(s: ConsultantSchedule, durationMin: number, busy: BusyRange[], now: Date): Date[] {
  const earliest = now.getTime() + s.minNoticeHours * 3_600_000;
  const latest = now.getTime() + s.horizonDays * 86_400_000;
  const out: Date[] = [];
  const seen = new Set<number>();
  // Step calendar days in the expert's zone (not 24-hour blocks: a 23-hour day at a clock change would skip one).
  // One extra day each side covers zones far from UTC.
  const today = localDay(now, s.timezone);
  for (let d = -1; d <= s.horizonDays + 1; d++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    const day = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
    for (const w of s.availability) {
      if (w.weekday !== day.weekday) continue;
      for (let m = minutesOf(w.start); m + durationMin <= minutesOf(w.end); m += CONSULTATION_SLOT_STEP_MIN) {
        const start = zonedTime(day, m, s.timezone);
        if (!start || seen.has(start.getTime())) continue;
        const t = start.getTime();
        const end = t + durationMin * 60_000;
        if (t < earliest || t > latest) continue;
        if (busy.some((b) => t < b.endsAt.getTime() && b.startsAt.getTime() < end)) continue;
        seen.add(t);
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** A paid call can be moved once, up to 24 hours before it starts. */
export function studentCanReschedule(b: { status: ConsultationStatus; startsAt: Date | null; rescheduleCount: number }, now: Date): boolean {
  return (
    b.status === 'CONFIRMED' &&
    b.startsAt !== null &&
    b.rescheduleCount < CONSULTATION_MAX_RESCHEDULES &&
    b.startsAt.getTime() - now.getTime() >= CONSULTATION_RESCHEDULE_HOURS * 3_600_000
  );
}

/** The expert's price for a call length, or null when they don't offer it. */
export function consultationPrice(c: { price30Egp: number | null; price60Egp: number | null }, durationMin: number): number | null {
  return durationMin === 30 ? c.price30Egp : durationMin === 60 ? c.price60Egp : null;
}

// ------------------------------------------------------------------ DTOs

export interface ConsultantCardDto {
  slug: string;
  name: string;
  nameAr: string | null;
  titleEn: string;
  titleAr: string | null;
  photoUrl: string | null;
  price30Egp: number | null;
  price60Egp: number | null;
  timezone: string;
}

export interface ConsultantDetailDto extends ConsultantCardDto {
  bioEn: string;
  bioAr: string | null;
  linkedinUrl: string | null;
  minNoticeHours: number;
  horizonDays: number;
}

export interface ConsultationPaymentMethod {
  kind: ConsultationWallet;
  /** The InstaPay address or the wallet number. */
  handle: string;
  /** The account or wallet name ('' when not set). */
  name: string;
}

/** How to pay (from Settings): only the wallets that are set. Empty `methods` = payments aren't open yet. */
export interface ConsultationPaymentDto {
  methods: ConsultationPaymentMethod[];
  supportWhatsapp: string;
}

export interface ConsultationBookingDto {
  id: string;
  reference: string;
  status: ConsultationStatus;
  durationMin: number;
  priceEgp: number;
  note: string;
  method: ConsultationWallet;
  transactionRef: string;
  createdAt: string;
  /** When the payment was approved. */
  paidAt: string | null;
  /** Why the payment was rejected. */
  rejectionReason: string | null;
  /** Set once a time is booked. */
  startsAt: string | null;
  endsAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Only for a booked call. */
  meetingUrl: string | null;
  consultant: { slug: string; name: string; nameAr: string | null; photoUrl: string | null; horizonDays: number };
  /** Paid, no time yet: the student picks one. */
  canBook: boolean;
  /** How many times the student moved this call (at most CONSULTATION_MAX_RESCHEDULES). */
  rescheduleCount: number;
  canReschedule: boolean;
  /** Expert or admin: the call can still be cancelled (refunded). */
  canCancel: boolean;
}

/** The student's view of one booking. */
export type MyConsultationDto = ConsultationBookingDto;

/** The expert's and the admin's view: who booked. The email and the payment proof are for admins only. */
export interface ConsultationBookingAdminDto extends ConsultationBookingDto {
  student: { id: string; name: string; email: string | null };
  /** Admins: the screenshot can be opened (it is deleted after the retention period). */
  hasScreenshot: boolean;
  /** Admins: other bookings that used the same screenshot or the same transaction reference. */
  sameProofAs: string[];
}

export interface ConsultantSettingsDto extends ConsultantSettingsInput {
  enabled: boolean;
}

/** The expert's Google Calendar connection. */
export interface GoogleCalendarStatusDto {
  /** False when the academy hasn't configured Google (no client id/secret): only fixed links then. */
  available: boolean;
  connected: boolean;
  email: string | null;
  /** "EXPIRED" when the connection stopped working and the expert has to connect again. */
  error: string | null;
}

export interface ExpertOverviewDto {
  settings: ConsultantSettingsDto;
  google: GoogleCalendarStatusDto;
  bookings: ConsultationBookingAdminDto[];
}

export interface AdminConsultantRowDto {
  instructorId: string;
  slug: string | null;
  name: string;
  hasAccount: boolean;
  settings: ConsultantSettingsDto | null;
  google: Omit<GoogleCalendarStatusDto, 'available'> | null;
  upcoming: number;
}
