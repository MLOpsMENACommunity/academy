import { describe, expect, it } from 'vitest';
import {
  adminConsultantSchema,
  availabilitySchema,
  consultantSettingsSchema,
  consultationPurchaseSchema,
  consultationPrice,
  consultationSlots,
  localDay,
  studentCanReschedule,
  consultationPaymentMethods,
  zonedTime,
} from './consultations';

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe('zonedTime', () => {
  it('follows Cairo across the end of summer time (UTC+3 → UTC+2)', () => {
    expect(zonedTime({ year: 2026, month: 10, day: 25 }, 18 * 60, 'Africa/Cairo')!.toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(zonedTime({ year: 2026, month: 11, day: 1 }, 18 * 60, 'Africa/Cairo')!.toISOString()).toBe('2026-11-01T16:00:00.000Z');
  });

  it('returns null for a wall time skipped by a daylight-saving change', () => {
    expect(zonedTime({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, 'America/New_York')).toBeNull();
    expect(zonedTime({ year: 2026, month: 3, day: 8 }, 3 * 60, 'America/New_York')!.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('accepts the midnight that ends a day', () => {
    expect(zonedTime({ year: 2026, month: 11, day: 1 }, 24 * 60, 'UTC')!.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});

describe('localDay', () => {
  it('gives the date and weekday in the zone, not in UTC', () => {
    // 23:30 UTC on Saturday is already Sunday in Cairo.
    expect(localDay(new Date('2026-10-24T23:30:00Z'), 'Africa/Cairo')).toEqual({ year: 2026, month: 10, day: 25, weekday: 0 });
  });
});

describe('consultationSlots', () => {
  const schedule = { timezone: 'Africa/Cairo', minNoticeHours: 24, horizonDays: 14, availability: [{ weekday: 0, start: '18:00', end: '20:00' }] };
  const now = new Date('2026-10-24T12:00:00Z'); // Saturday

  it('lists half-hour starts in the expert’s hours, in their time zone, within the horizon', () => {
    expect(iso(consultationSlots(schedule, 30, [], now))).toEqual([
      '2026-10-25T15:00:00.000Z',
      '2026-10-25T15:30:00.000Z',
      '2026-10-25T16:00:00.000Z',
      '2026-10-25T16:30:00.000Z',
      '2026-11-01T16:00:00.000Z',
      '2026-11-01T16:30:00.000Z',
      '2026-11-01T17:00:00.000Z',
      '2026-11-01T17:30:00.000Z',
    ]);
  });

  it('fits a 60-minute call inside the range', () => {
    expect(iso(consultationSlots(schedule, 60, [], now)).slice(0, 3)).toEqual([
      '2026-10-25T15:00:00.000Z',
      '2026-10-25T15:30:00.000Z',
      '2026-10-25T16:00:00.000Z',
    ]);
  });

  it('skips anything overlapping a held call', () => {
    const busy = [{ startsAt: new Date('2026-10-25T15:30:00Z'), endsAt: new Date('2026-10-25T16:30:00Z') }];
    expect(iso(consultationSlots(schedule, 30, busy, now)).slice(0, 2)).toEqual(['2026-10-25T15:00:00.000Z', '2026-10-25T16:30:00.000Z']);
    expect(iso(consultationSlots(schedule, 60, busy, now))[0]).toBe('2026-11-01T16:00:00.000Z');
  });

  it('respects the minimum notice', () => {
    expect(consultationSlots({ ...schedule, minNoticeHours: 30 }, 30, [], now)[0]!.toISOString()).toBe('2026-11-01T16:00:00.000Z');
  });

  it('keeps the day of a spring-forward clock change (a 23-hour day)', () => {
    // Cairo moves to summer time at midnight starting Friday 24 April 2026.
    const fridays = { timezone: 'Africa/Cairo', minNoticeHours: 3, horizonDays: 3, availability: [{ weekday: 5, start: '10:00', end: '11:00' }] };
    expect(iso(consultationSlots(fridays, 30, [], new Date('2026-04-23T21:30:00Z')))).toEqual(['2026-04-24T07:00:00.000Z', '2026-04-24T07:30:00.000Z']);
  });

  it('is empty without weekly hours', () => {
    expect(consultationSlots({ ...schedule, availability: [] }, 30, [], now)).toEqual([]);
  });
});

describe('reschedule (no refunds for paid calls)', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('lets a paid call move once, up to 24 hours before', () => {
    const paid = { status: 'CONFIRMED' as const, startsAt: new Date('2026-10-25T12:00:00Z'), rescheduleCount: 0 };
    expect(studentCanReschedule(paid, now)).toBe(true);
    expect(studentCanReschedule({ ...paid, startsAt: new Date('2026-10-25T11:59:00Z') }, now)).toBe(false);
    expect(studentCanReschedule({ ...paid, rescheduleCount: 1 }, now)).toBe(false);
    expect(studentCanReschedule({ ...paid, status: 'PAID', startsAt: null }, now)).toBe(false);
  });
});

describe('consultationPaymentMethods', () => {
  it('offers only the wallets whose number is set, in a fixed order', () => {
    const none = { instapayHandle: '', instapayName: '', vodafoneCashNumber: '', vodafoneCashName: '', orangeCashNumber: '', orangeCashName: '', etisalatCashNumber: '', etisalatCashName: '' };
    expect(consultationPaymentMethods(none)).toEqual([]);
    expect(consultationPaymentMethods({ ...none, etisalatCashNumber: '01100000000', instapayHandle: 'academy@instapay', instapayName: 'MLOps MENA' })).toEqual([
      { kind: 'INSTAPAY', handle: 'academy@instapay', name: 'MLOps MENA' },
      { kind: 'ETISALAT_CASH', handle: '01100000000', name: '' },
    ]);
  });
});

describe('schemas', () => {
  const base = { price30Egp: 500, price60Egp: null, meetingUrl: 'https://meet.google.com/abc-defg-hij', timezone: 'Africa/Cairo', minNoticeHours: 24, horizonDays: 30, availability: [] };

  it('rejects overlapping or reversed weekly ranges and off-grid times', () => {
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 1, start: '19:30', end: '21:00' }]).success).toBe(false);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 1, start: '20:00', end: '21:00' }]).success).toBe(true);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '20:00', end: '18:00' }]).success).toBe(false);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:15', end: '20:00' }]).success).toBe(false);
  });

  it('requires every field (a save replaces them all), and refuses unknown zones, http links and free calls', () => {
    expect(consultantSettingsSchema.safeParse(base).success).toBe(true);
    const { availability: _hours, ...noHours } = base;
    expect(consultantSettingsSchema.safeParse(noHours).success).toBe(false);
    expect(consultantSettingsSchema.safeParse({ ...base, price30Egp: 0 }).success).toBe(false);
    expect(consultantSettingsSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(consultantSettingsSchema.safeParse({ ...base, meetingUrl: 'http://meet.google.com/x' }).success).toBe(false);
  });

  it('lists an expert only with at least one price (the link-or-Google rule is in the API)', () => {
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true }).success).toBe(true);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true, meetingUrl: '' }).success).toBe(true);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true, price30Egp: null }).success).toBe(false);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: false, meetingUrl: '', price30Egp: null }).success).toBe(true);
  });

  it('pays for 30 or 60 minutes with a known wallet (form fields arrive as text)', () => {
    expect(consultationPurchaseSchema.parse({ durationMin: '60', method: 'VODAFONE_CASH' })).toEqual({ durationMin: 60, method: 'VODAFONE_CASH', transactionRef: '', note: '' });
    expect(consultationPurchaseSchema.safeParse({ durationMin: '45', method: 'INSTAPAY' }).success).toBe(false);
    expect(consultationPurchaseSchema.safeParse({ durationMin: '30', method: 'PAYPAL' }).success).toBe(false);
  });

  it('prices by call length', () => {
    expect(consultationPrice({ price30Egp: 500, price60Egp: null }, 30)).toBe(500);
    expect(consultationPrice({ price30Egp: 500, price60Egp: null }, 60)).toBeNull();
  });
});
