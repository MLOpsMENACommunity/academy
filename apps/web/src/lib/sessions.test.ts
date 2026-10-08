import { describe, expect, it } from 'vitest';
import { dateParts, excerpt, msUntilLink, registerState } from './sessions';

const now = new Date('2026-10-20T15:00:00.000Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const base = { status: 'PUBLISHED' as const, past: false, full: false, startsAt: at(120), durationMin: 60 };
const me = (registered: boolean, liveUrl: string | null = null) => ({ registered, liveUrl, liveUrlFrom: at(60) });

describe('registerState', () => {
  it('is open for an upcoming session, signed in or not', () => {
    expect(registerState(base, now)).toBe('open');
    expect(registerState({ ...base, me: me(false) }, now)).toBe('open');
  });

  it('shows the registration, then the live link once the API reveals it', () => {
    expect(registerState({ ...base, me: me(true) }, now)).toBe('registered');
    expect(registerState({ ...base, startsAt: at(30), me: me(true, 'https://meet.google.com/abc') }, now)).toBe('live');
  });

  it('is full only for people who are not already in', () => {
    expect(registerState({ ...base, full: true }, now)).toBe('full');
    expect(registerState({ ...base, full: true, me: me(true) }, now)).toBe('registered');
  });

  it('closes ended sessions, even when the cached page still says upcoming', () => {
    expect(registerState({ ...base, past: true }, now)).toBe('ended');
    expect(registerState({ ...base, startsAt: at(-61), me: me(true, 'https://x.test') }, now)).toBe('ended');
    expect(registerState({ ...base, startsAt: at(-59) }, now)).toBe('open');
  });

  it('puts cancellation above everything else', () => {
    expect(registerState({ ...base, status: 'CANCELLED', me: me(true) }, now)).toBe('cancelled');
    expect(registerState({ ...base, status: 'CANCELLED', past: true }, now)).toBe('cancelled');
  });
});

describe('msUntilLink', () => {
  it('waits for the link only for registered people, and only when it is due soon', () => {
    expect(msUntilLink({ me: me(true) }, now)).toBe(60 * 60_000);
    expect(msUntilLink({ me: me(false) }, now)).toBeNull();
    expect(msUntilLink({ me: me(true, 'https://x.test') }, now)).toBeNull();
    expect(msUntilLink({}, now)).toBeNull();
    expect(msUntilLink({ me: { ...me(true), liveUrlFrom: at(60 * 24) } }, now)).toBeNull();
  });
});

describe('excerpt', () => {
  it('takes the first real paragraph as plain text', () => {
    expect(excerpt('## About\n\nWe will **deploy** a [model](https://x.test) with `kubectl`.\n\nMore.')).toBe(
      'We will deploy a model with kubectl.',
    );
  });
  it('cuts long text on a word boundary', () => {
    const out = excerpt('word '.repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
  it('handles empty descriptions', () => {
    expect(excerpt('')).toBe('');
  });
});

describe('dateParts', () => {
  it('formats the date block in the viewer time zone, with Latin digits in Arabic', () => {
    const iso = '2026-10-22T17:00:00.000Z';
    const en = dateParts(iso, 'en', 'Africa/Cairo');
    expect(en.day).toBe('22');
    expect(en.weekday).toBe('Thursday');
    expect(en.time).toMatch(/20:00/);
    const ar = dateParts(iso, 'ar', 'Asia/Riyadh');
    expect(ar.day).toBe('22');
    expect(ar.time).toMatch(/8:00|20:00/);
  });
});
