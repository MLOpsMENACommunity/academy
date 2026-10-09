/**
 * Edge caching rules for the web app (Next.js), applied by the entry Worker with the
 * Workers Cache API. Pure functions, so they can be tested without a Worker runtime.
 *
 * What is cached (per Cloudflare data centre):
 *   - Pages: anonymous GETs of /en/... and /ar/... whose response Next marks as shared-
 *     cacheable (ISR/static: `s-maxage`, no `private`/`no-store`/`no-cache`), 200, HTML,
 *     no Set-Cookie, and not a stale ISR copy. Kept for at most PAGE_TTL seconds.
 *   - Build assets: /_next/static/* (content-hashed, `immutable`), for everyone.
 *
 * Never cached, always sent to the container:
 *   - anything from a browser with a session (access_token / has_session cookie),
 *   - /api/* (the API's personal and public endpoints alike), non-GET requests,
 *   - Next client-navigation requests (RSC payloads, prefetches, server actions),
 *   - signed-in areas (dashboard, profile, onboarding, admin, learn, apply),
 *   - any response that sets a cookie, is not 200, or is private / no-store.
 *
 * The page HTML is the same for every visitor: personal state (who is signed in, my
 * application status, Notify me) is fetched by client components after load.
 * en and ar are different URLs, so they are different cache entries; the query string
 * is part of the key too (?ref=, utm_* get their own entries).
 */

/** Edge lifetime of a cached page. Next revalidates every 60–300 s behind this. */
export const PAGE_TTL = 60;

const SESSION_COOKIES = ['access_token', 'has_session'];
export const LOCALE_COOKIE = 'NEXT_LOCALE';
const LOCALES = ['en', 'ar'] as const;

/** Next.js App Router client requests: RSC payloads differ from the HTML at the same URL. */
const NEXT_CLIENT_HEADERS = ['rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-action'];

/** Same list as the web middleware's PROTECTED, plus the per-request auth pages. */
const PRIVATE_PAGE =
  /^\/(en|ar)\/(dashboard|profile|onboarding|admin|learn|verify-email|reset-password)(\/|$)|^\/(en|ar)\/courses\/[^/]+\/apply(\/|$)/;

export type CacheKind = 'page' | 'asset';

export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function hasSession(request: Request): boolean {
  return SESSION_COOKIES.some((c) => cookieValue(request, c) !== undefined);
}

/** The locale of a page path (/en, /ar/courses…), or null. */
export function pathLocale(pathname: string): (typeof LOCALES)[number] | null {
  const first = pathname.split('/')[1];
  return (LOCALES as readonly string[]).includes(first ?? '') ? (first as (typeof LOCALES)[number]) : null;
}

/** Whether (and how) a request may be answered from, and stored in, the edge cache. */
export function cacheKind(request: Request): CacheKind | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api' || path.startsWith('/api/')) return null;
  if (NEXT_CLIENT_HEADERS.some((h) => request.headers.has(h)) || url.searchParams.has('_rsc')) return null;
  if (path.startsWith('/_next/static/')) return 'asset';
  if (hasSession(request)) return null;
  if (!pathLocale(path) || PRIVATE_PAGE.test(path) || path.includes('//')) return null;
  return 'page';
}

interface CacheControl {
  directives: Set<string>;
  sMaxAge: number | null;
  maxAge: number | null;
}

export function parseCacheControl(value: string | null): CacheControl {
  const directives = new Set<string>();
  let sMaxAge: number | null = null;
  let maxAge: number | null = null;
  for (const raw of (value ?? '').split(',')) {
    const [k, v] = raw.trim().toLowerCase().split('=');
    if (!k) continue;
    directives.add(k);
    const n = v !== undefined ? Number.parseInt(v.replace(/"/g, ''), 10) : NaN;
    if (k === 's-maxage' && Number.isFinite(n)) sMaxAge = n;
    if (k === 'max-age' && Number.isFinite(n)) maxAge = n;
  }
  return { directives, sMaxAge, maxAge };
}

/**
 * The Cache-Control to store a response under, or null when it must not be cached.
 * Pages are capped at PAGE_TTL so admin edits show within ~2 minutes (Next's 60 s ISR
 * window plus this one); assets keep their own (immutable, a year).
 */
export function storableCacheControl(kind: CacheKind, response: Response): string | null {
  if (response.status !== 200) return null;
  if (response.headers.has('set-cookie')) return null;
  const cc = parseCacheControl(response.headers.get('cache-control'));
  if (['private', 'no-store', 'no-cache'].some((d) => cc.directives.has(d))) return null;
  if (kind === 'asset') {
    return cc.directives.has('immutable') && (cc.maxAge ?? 0) > 0 ? response.headers.get('cache-control') : null;
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return null;
  // A stale ISR copy is being regenerated right now: don't pin it at the edge for another TTL.
  if ((response.headers.get('x-nextjs-cache') ?? '').toUpperCase() === 'STALE') return null;
  const ttl = cc.sMaxAge ?? (cc.directives.has('public') ? cc.maxAge : null);
  if (!ttl || ttl <= 0) return null;
  return `public, max-age=0, s-maxage=${Math.min(ttl, PAGE_TTL)}`;
}

/**
 * The web middleware remembers the visitor's language in a cookie on every page view;
 * a page served from the edge never reaches it, so the Worker sets the same cookie
 * (on the outgoing response only, never in the cache).
 */
export function localeCookie(request: Request): string | null {
  const locale = pathLocale(new URL(request.url).pathname);
  if (!locale || cookieValue(request, LOCALE_COOKIE) === locale) return null;
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
