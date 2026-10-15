/**
 * Edge caching rules for the web app (Next.js), applied by the entry Worker with the
 * Workers Cache API. Pure functions, so they can be tested without a Worker runtime.
 *
 * What is cached (per Cloudflare data centre):
 *   - Pages: anonymous GETs of /en/... and /ar/... whose response Next marks as shared-
 *     cacheable (ISR/static: `s-maxage`, no `private`/`no-store`/`no-cache`), 200, HTML,
 *     no Set-Cookie, and not a stale ISR copy. Kept for at most PAGE_TTL seconds.
 *   - Build assets: /_next/static/* (content-hashed, `immutable`), for everyone.
 *   - Uploaded images: /api/media/<uuid>.<jpg|png|webp> (course and session covers, speaker
 *     photos). Public, never reused under the same name, served by the API as `immutable`:
 *     cached like build assets, for everyone (the image is the same whoever asks).
 *
 *   - Public API reads: anonymous GETs of the catalog endpoints in PUBLIC_API (courses, live
 *     sessions, speakers, recordings, public settings) whose response the API marks
 *     shared-cacheable (`public, s-maxage=…`): 200 JSON, no Set-Cookie, no `private`/`no-store`.
 *     The API only does that for requests without a session cookie and for bodies with no
 *     personal field (apps/api/src/common/public-cache.ts). Kept for at most API_TTL seconds.
 *     Requests with an Origin header (cross-origin callers) are not cached (CORS headers vary).
 *
 * How fast an admin edit shows: the API asks the Worker to revalidate (revalidate.ts), which
 * re-renders the pages in every running web container and purges every copy stored here
 * (they carry Cache-Tag EDGE_TAG) when the purge is configured; otherwise a copy lives at most
 * PAGE_TTL / API_TTL. The web app's own server-side reads skip this cache (x-skip-edge-cache),
 * so a page re-rendered after an edit never picks up an older copy of the API's answer.
 *
 * Never cached, always sent to the container:
 *   - anything from a browser with a session (access_token / has_session / refresh_token cookie),
 *   - every other /api/* endpoint (personal ones, writes, auth, uploads…), non-GET requests,
 *   - Next client-navigation requests (RSC payloads, prefetches, server actions),
 *   - signed-in areas (dashboard, profile, onboarding, admin, learn, apply) and token
 *     links (verify-email, reset-password, waitlist/leave),
 *   - any response that sets a cookie (other than the middleware's NEXT_LOCALE on a page,
 *     which is stripped from the stored copy: see storedCopy), is not 200, or is private / no-store.
 *
 * The page HTML is the same for every visitor: personal state (who is signed in, my
 * application status, Notify me) is fetched by client components after load.
 * en and ar are different URLs, so they are different cache entries; the query string
 * is part of the key too (?ref=, utm_* get their own entries).
 */

/**
 * Edge lifetime of a cached page: the most an edit can lag at the edge when the purge isn't
 * configured (or fails). Next revalidates on demand and every 60 s behind this.
 */
export const PAGE_TTL = 30;
/** Edge lifetime of a cached public API read (the API asks for s-maxage=60; the edge keeps less). */
export const API_TTL = 30;
/** Cache-Tag on every stored page and API answer: one purge clears them all (revalidate.ts). */
export const EDGE_TAG = 'academy-public';
/** Sent by the web app's server-side reads (apps/web/src/lib/server-api.ts): never from the edge cache. */
export const SKIP_EDGE_CACHE_HEADER = 'x-skip-edge-cache';

const SESSION_COOKIES = ['access_token', 'has_session', 'refresh_token'];

/**
 * The public, read-only API endpoints the edge may cache (anonymous GETs only). Mirrors
 * PUBLIC_CACHE_ROUTES in apps/api/src/common/public-cache.ts; the API's Cache-Control has the
 * last word (anything it doesn't mark public is never stored), so this list can only narrow.
 */
/** An uploaded image (apps/api/src/media): a random name, so the content behind it never changes. */
const MEDIA = /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const PUBLIC_API =
  /^\/api\/(courses|courses\/[a-z0-9-]{1,100}|events|events\/[a-z0-9-]{1,100}|speakers|speakers\/[a-z0-9-]{1,100}|recordings|recordings\/search|settings\/public)$/;
export const LOCALE_COOKIE = 'NEXT_LOCALE';
const LOCALES = ['en', 'ar'] as const;

/** Next.js App Router client requests: RSC payloads differ from the HTML at the same URL. */
const NEXT_CLIENT_HEADERS = ['rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-action'];

/** Same list as the web middleware's PROTECTED, plus the per-request auth pages. */
const PRIVATE_PAGE =
  /^\/(en|ar)\/(dashboard|profile|onboarding|admin|learn|verify-email|reset-password|waitlist)(\/|$)|^\/(en|ar)\/courses\/[^/]+\/apply(\/|$)/;

export type CacheKind = 'page' | 'asset' | 'api';

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
  if (path === '/api' || path.startsWith('/api/')) {
    // The web app's own reads. Anyone may send it: it only costs the API a read from its
    // in-process cache (a query string already gets past the edge the same way).
    if (request.headers.has(SKIP_EDGE_CACHE_HEADER)) return null;
    // Public, immutable images: the same bytes for everyone, so a session doesn't matter. No query
    // string (it would only multiply cache entries) and no cross-origin callers (CORS headers vary).
    if (MEDIA.test(path)) return url.search || request.headers.has('origin') || request.headers.has('authorization') ? null : 'asset';
    if (hasSession(request) || request.headers.has('origin') || request.headers.has('authorization')) return null;
    return PUBLIC_API.test(path) ? 'api' : null;
  }
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
 * Pages are capped at PAGE_TTL so an edit shows within that even without the purge; assets
 * keep their own (immutable, a year).
 */
export function storableCacheControl(kind: CacheKind, response: Response): string | null {
  if (response.status !== 200) return null;
  // First-time visitors get the middleware's NEXT_LOCALE cookie on every page: that one alone
  // doesn't stop caching (storedCopy drops it), or a launch spike of new visitors would never hit.
  if (response.headers.has('set-cookie') && !(kind === 'page' && onlySetsLocaleCookie(response))) return null;
  const cc = parseCacheControl(response.headers.get('cache-control'));
  if (['private', 'no-store', 'no-cache'].some((d) => cc.directives.has(d))) return null;
  if (kind === 'asset') {
    return cc.directives.has('immutable') && (cc.maxAge ?? 0) > 0 ? response.headers.get('cache-control') : null;
  }
  if (kind === 'api') {
    // Only what the API itself marked shared-cacheable, JSON, and never anything that sets a cookie.
    if (response.headers.has('set-cookie')) return null;
    if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) return null;
    if (!cc.directives.has('public') || !cc.sMaxAge || cc.sMaxAge <= 0) return null;
    return `public, max-age=0, s-maxage=${Math.min(cc.sMaxAge, API_TTL)}`;
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return null;
  // A stale ISR copy is being regenerated right now: don't pin it at the edge for another TTL.
  if ((response.headers.get('x-nextjs-cache') ?? '').toUpperCase() === 'STALE') return null;
  const ttl = cc.sMaxAge ?? (cc.directives.has('public') ? cc.maxAge : null);
  if (!ttl || ttl <= 0) return null;
  return `public, max-age=0, s-maxage=${Math.min(ttl, PAGE_TTL)}`;
}

/**
 * The Cache-Control a visitor's browser gets for a page or API answer that went through the
 * edge cache. Cloudflare's zone-wide "Browser Cache TTL" (4 h by default, shared with
 * mlopsmena.com) rewrites max-age on cache hits, which would let a browser keep an old page
 * for hours after a release. Browsers must always revalidate; the edge keeps its own short TTL.
 * Hashed static assets keep their own (immutable) header.
 */
export function browserCacheControl(kind: CacheKind, current: string | null): string | null {
  if (kind === 'asset') return current;
  return 'public, max-age=0, must-revalidate';
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

/** Every Set-Cookie header of a response (one entry per cookie). */
export function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const one = headers.get('set-cookie');
  return one ? [one] : [];
}

/** True when the response sets cookies and every one of them is NEXT_LOCALE. */
export function onlySetsLocaleCookie(response: Response): boolean {
  const cookies = setCookies(response);
  return cookies.length > 0 && cookies.every((c) => c.trimStart().startsWith(`${LOCALE_COOKIE}=`));
}

/**
 * The copy to put in the edge cache: with the storable Cache-Control and never a Set-Cookie
 * (the only one storableCacheControl lets through is NEXT_LOCALE, which the Worker sets per
 * visitor itself: the miss passes the middleware's on, and hits add it with localeCookie).
 * Pages and API answers are tagged EDGE_TAG so an admin edit can purge them all; build
 * assets and images never change, so they aren't.
 */
export function storedCopy(response: Response, cacheControl: string, kind: CacheKind = 'page'): Response {
  const out = new Response(response.body, response);
  out.headers.delete('set-cookie');
  out.headers.set('cache-control', cacheControl);
  if (kind === 'asset') out.headers.delete('cache-tag');
  else out.headers.set('cache-tag', EDGE_TAG);
  return out;
}
