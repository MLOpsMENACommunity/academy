import { describe, expect, it } from 'vitest';
import { calendarUtc, googleCalendarLink, googleCalendarSubscribeLink, webcalUrl } from './calendar';

const FEED = 'https://academy.mlopsmena.com/api/calendar/AbC-_123xyzAbC-_123xyzAbC-_123xyzAbC-_12345.ics';

describe('calendar subscription links', () => {
  it('turns an https feed into webcal://', () => {
    expect(webcalUrl(FEED)).toBe('webcal://academy.mlopsmena.com/api/calendar/AbC-_123xyzAbC-_123xyzAbC-_123xyzAbC-_12345.ics');
    expect(webcalUrl('http://localhost:3000/api/calendar/x.ics')).toBe('webcal://localhost:3000/api/calendar/x.ics');
  });

  it('passes the encoded webcal URL to Google as cid', () => {
    const link = googleCalendarSubscribeLink(FEED);
    expect(link).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(FEED))}`);
    expect(link).toContain('cid=webcal%3A%2F%2Facademy.mlopsmena.com%2Fapi%2Fcalendar%2F');
    expect(new URL(link).searchParams.get('cid')).toBe(webcalUrl(FEED));
  });
});

describe('googleCalendarLink for course sessions', () => {
  it('converts offset times to UTC and keeps Arabic text and the page URL intact', () => {
    const link = new URL(
      googleCalendarLink({
        title: 'دورة MLOps: الجلسة ١ — مقدمة',
        start: '2026-10-22T20:00:00+03:00',
        end: '2026-10-22T21:30:00+03:00',
        details: 'رابط الجلسة في صفحة الدورة',
        location: 'https://academy.mlopsmena.com/ar/learn/mlops#session-1',
      }),
    );
    expect(link.searchParams.get('dates')).toBe('20261022T170000Z/20261022T183000Z');
    expect(link.searchParams.get('text')).toBe('دورة MLOps: الجلسة ١ — مقدمة');
    expect(link.searchParams.get('location')).toBe('https://academy.mlopsmena.com/ar/learn/mlops#session-1');
    // Arabic and '#' are percent-encoded, never raw in the URL.
    expect(link.search).not.toMatch(/[؀-ۿ#]/);
    expect(link.search).toContain('%D8%AF');
  });

  it('formats midnight and year boundaries in UTC', () => {
    expect(calendarUtc(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('20261231T235959Z');
    expect(calendarUtc('2027-01-01T02:00:00+02:00')).toBe('20270101T000000Z');
  });
});
