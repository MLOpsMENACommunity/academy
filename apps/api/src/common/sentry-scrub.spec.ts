import { scrubBreadcrumb, scrubEvent, scrubFeedTokens } from './sentry-scrub';

const TOKEN = 'AbC-_123xyzAbC-_123xyzAbC-_123xyzAbC-_12345';

describe('feed token scrubbing', () => {
  it('redacts tokens in API and bare feed paths', () => {
    expect(scrubFeedTokens(`https://academy.mlopsmena.com/api/calendar/${TOKEN}.ics`)).toBe('https://academy.mlopsmena.com/api/calendar/[redacted].ics');
    expect(scrubFeedTokens(`GET /calendar/${TOKEN}.ics?x=1`)).toBe('GET /calendar/[redacted].ics?x=1');
    expect(scrubFeedTokens(`/api/calendar/${TOKEN}`)).toBe('/api/calendar/[redacted].ics');
  });

  it('leaves other calendar routes alone', () => {
    for (const s of ['/api/learn/mlops/calendar.ics', '/api/learn/mlops/sessions/s1/calendar.ics', '/api/me/calendar-feed']) {
      expect(scrubFeedTokens(s)).toBe(s);
    }
  });

  it('scrubs request URL, transaction, breadcrumbs and spans of an event', () => {
    const event = scrubEvent({
      transaction: `GET /api/calendar/${TOKEN}.ics`,
      request: { url: `http://localhost:4000/api/calendar/${TOKEN}.ics` },
      breadcrumbs: [{ message: `fetch /api/calendar/${TOKEN}.ics`, data: { url: `/api/calendar/${TOKEN}.ics` } }],
      spans: [{ description: `GET /api/calendar/${TOKEN}.ics`, data: { 'http.target': `/api/calendar/${TOKEN}.ics` } }],
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(event.request.url).toBe('http://localhost:4000/api/calendar/[redacted].ics');
    expect(scrubBreadcrumb({ data: { url: `/calendar/${TOKEN}.ics` } }).data.url).toBe('/calendar/[redacted].ics');
  });
});
