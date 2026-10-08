import { describe, expect, it } from 'vitest';
import { calendarUtc, googleCalendarLink } from './calendar';

describe('googleCalendarLink', () => {
  it('builds a template link with UTC dates, details and location', () => {
    const url = new URL(
      googleCalendarLink({
        title: 'MLOps AMA: أسئلة',
        start: '2026-10-22T17:00:00.000Z',
        end: new Date('2026-10-22T18:30:00.000Z'),
        details: 'Join from the page & bring questions',
        location: 'https://academy.mlopsmena.com/en/sessions/ama',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('MLOps AMA: أسئلة');
    expect(url.searchParams.get('dates')).toBe('20261022T170000Z/20261022T183000Z');
    expect(url.searchParams.get('details')).toBe('Join from the page & bring questions');
    expect(url.searchParams.get('location')).toBe('https://academy.mlopsmena.com/en/sessions/ama');
  });

  it('leaves out empty optional fields', () => {
    const url = new URL(googleCalendarLink({ title: 'S', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }));
    expect(url.searchParams.has('details')).toBe(false);
    expect(url.searchParams.has('location')).toBe(false);
  });

  it('formats UTC timestamps without separators or milliseconds', () => {
    expect(calendarUtc('2026-03-05T07:08:09.123Z')).toBe('20260305T070809Z');
  });
});
