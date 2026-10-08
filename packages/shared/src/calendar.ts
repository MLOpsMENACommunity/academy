/** What a calendar entry needs. Keep links to private things (live/join URLs) out of every field. */
export interface CalendarEntry {
  title: string;
  start: Date | string;
  end: Date | string;
  details?: string;
  /** Usually the public page of the session. */
  location?: string;
}

/** `20261022T170000Z`: the UTC form Google Calendar and iCalendar both use. */
export function calendarUtc(d: Date | string): string {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Google Calendar "add event" link for one entry. */
export function googleCalendarLink(e: CalendarEntry): string {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${calendarUtc(e.start)}/${calendarUtc(e.end)}` });
  if (e.details) q.set('details', e.details);
  if (e.location) q.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/**
 * The `webcal://` form of an http(s) calendar feed. Apple Calendar and Outlook
 * open it as a subscription (they keep polling it) rather than a one-off import.
 */
export function webcalUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:\/\//i, 'webcal://');
}

/**
 * Google Calendar "add calendar from URL" link for a subscription feed. Google
 * shows a confirmation, then polls the feed (only https feeds work, and Google
 * can take several hours, sometimes a day, to pick up changes). The feed goes
 * in `cid` in its webcal:// form, percent-encoded.
 */
export function googleCalendarSubscribeLink(feedUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}
