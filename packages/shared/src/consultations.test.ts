import { describe, expect, it } from 'vitest';
import {
  adminConsultantSchema,
  availabilitySchema,
  consultantSettingsSchema,
  consultationBookingSchema,
  consultationHoldUntil,
  consultationPrice,
  consultationSlots,
  localDay,
  studentCanCancel,
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

  it('is empty without weekly hours', () => {
    expect(consultationSlots({ ...schedule, availability: [] }, 30, [], now)).toEqual([]);
  });
});

describe('consultationHoldUntil', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('keeps an unpaid reservation 24 hours', () => {
    expect(consultationHoldUntil(now, new Date('2026-10-30T12:00:00Z')).toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });
  it('ends 2 hours before a call that is sooner', () => {
    expect(consultationHoldUntil(now, new Date('2026-10-25T06:00:00Z')).toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });
});

describe('studentCanCancel', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('allows an unpaid reservation any time and a paid call until 24 hours before', () => {
    expect(studentCanCancel({ status: 'AWAITING_PAYMENT', startsAt: new Date('2026-10-24T14:00:00Z') }, now)).toBe(true);
    expect(studentCanCancel({ status: 'CONFIRMED', startsAt: new Date('2026-10-25T12:00:00Z') }, now)).toBe(true);
    expect(studentCanCancel({ status: 'CONFIRMED', startsAt: new Date('2026-10-25T11:59:00Z') }, now)).toBe(false);
    expect(studentCanCancel({ status: 'CANCELLED', startsAt: new Date('2026-11-25T12:00:00Z') }, now)).toBe(false);
  });
});

describe('schemas', () => {
  const base = { price30Egp: 500, price60Egp: null, meetingUrl: 'https://meet.google.com/abc-defg-hij', availability: [] };

  it('rejects overlapping or reversed weekly ranges and off-grid times', () => {
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 1, start: '19:30', end: '21:00' }]).success).toBe(false);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 1, start: '20:00', end: '21:00' }]).success).toBe(true);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '20:00', end: '18:00' }]).success).toBe(false);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: '18:15', end: '20:00' }]).success).toBe(false);
  });

  it('defaults the time zone to Cairo and refuses unknown zones and http links', () => {
    expect(consultantSettingsSchema.parse(base).timezone).toBe('Africa/Cairo');
    expect(consultantSettingsSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(consultantSettingsSchema.safeParse({ ...base, meetingUrl: 'http://meet.google.com/x' }).success).toBe(false);
  });

  it('lists an expert only with a link and at least one price', () => {
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true }).success).toBe(true);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true, meetingUrl: '' }).success).toBe(false);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: true, price30Egp: null }).success).toBe(false);
    expect(adminConsultantSchema.safeParse({ ...base, enabled: false, meetingUrl: '', price30Egp: null }).success).toBe(true);
  });

  it('books 30 or 60 minutes at an ISO instant', () => {
    expect(consultationBookingSchema.safeParse({ durationMin: 45, startsAt: '2026-10-25T15:00:00Z' }).success).toBe(false);
    expect(consultationBookingSchema.parse({ durationMin: 30, startsAt: '2026-10-25T15:00:00Z' }).note).toBe('');
  });

  it('prices by call length', () => {
    expect(consultationPrice({ price30Egp: 500, price60Egp: null }, 30)).toBe(500);
    expect(consultationPrice({ price30Egp: 500, price60Egp: null }, 60)).toBeNull();
  });
});
