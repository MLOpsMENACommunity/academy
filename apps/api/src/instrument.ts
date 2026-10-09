import * as Sentry from '@sentry/nestjs';
import { scrubBreadcrumb, scrubEvent } from './common/sentry-scrub';

/**
 * Error tracking, only when SENTRY_DSN is set. Must be imported before anything
 * else in main.ts. No personal data leaves the server: no IPs, cookies, headers,
 * request bodies or user identities, and no performance tracing. Private
 * calendar feed tokens (in the URL path) are replaced before anything is sent.
 */
const redact = (s: string): string =>
  s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.ACADEMY_RELEASE ?? process.env.CONFIG_VERSION,
    // v11 collects user info, cookies, headers, bodies and query strings by default: turn all of it off.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    // Report, and keep serving: main.ts logs unhandled rejections instead of exiting, because a
    // restart costs every visitor seconds of 503s (uncaught exceptions still exit, see main.ts).
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'warn' })],
    beforeSend(event) {
      delete event.user;
      // Belt and braces: mask anything that looks like an email or phone number in error text.
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = redact(ex.value);
      if (event.message) event.message = redact(event.message);
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
      }
      return scrubEvent(event);
    },
    // Tracing is off (tracesSampleRate 0), but scrub anyway in case it is ever turned on.
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (b) => (b.category === 'console' || b.category === 'http' ? null : scrubBreadcrumb(b)),
  });
}
