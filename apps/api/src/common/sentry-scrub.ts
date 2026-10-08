/**
 * Private calendar feed URLs carry their credential in the path
 * (/api/calendar/<token>.ics). Anything that leaves the server (Sentry) gets
 * the token replaced first. Other paths that merely contain "calendar"
 * (/learn/<slug>/calendar.ics, /me/calendar-feed) are left alone.
 */
const FEED_PATH = /(\/api)?\/calendar\/[^/?#\s"']+/g;

export function scrubFeedTokens(s: string): string;
export function scrubFeedTokens(s: string | undefined): string | undefined;
export function scrubFeedTokens(s: string | undefined): string | undefined {
  return s?.replace(FEED_PATH, (_m, api: string | undefined) => `${api ?? ''}/calendar/[redacted].ics`);
}

interface ScrubbableBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(b: B): B {
  if (b.message) b.message = scrubFeedTokens(b.message);
  if (b.data) {
    for (const k of ['url', 'to', 'from']) {
      const v = b.data[k];
      if (typeof v === 'string') b.data[k] = scrubFeedTokens(v);
    }
  }
  return b;
}

interface ScrubbableEvent {
  transaction?: string;
  request?: { url?: string };
  breadcrumbs?: ScrubbableBreadcrumb[];
  spans?: Array<{ description?: string; data?: Record<string, unknown> }>;
}

/** Removes feed tokens from an error or transaction event, in place. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.transaction) event.transaction = scrubFeedTokens(event.transaction);
  if (event.request?.url) event.request.url = scrubFeedTokens(event.request.url);
  for (const b of event.breadcrumbs ?? []) scrubBreadcrumb(b);
  for (const s of event.spans ?? []) {
    if (s.description) s.description = scrubFeedTokens(s.description);
    for (const k of ['url', 'http.url', 'http.target', 'url.full', 'url.path']) {
      const v = s.data?.[k];
      if (typeof v === 'string') s.data![k] = scrubFeedTokens(v);
    }
  }
  return event;
}
