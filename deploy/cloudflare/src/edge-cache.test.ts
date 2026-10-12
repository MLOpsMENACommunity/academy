import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_TTL, browserCacheControl, cacheKind, localeCookie, PAGE_TTL, storableCacheControl, storedCopy } from './edge-cache.ts';

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Request(`https://academy.mlopsmena.com${path}`, init);
const html = (headers: Record<string, string>, status = 200) =>
  new Response('<html></html>', { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const isr = { 'cache-control': 's-maxage=60, stale-while-revalidate=31535940', 'x-nextjs-cache': 'HIT' };

test('anonymous GETs of public pages are cacheable, per locale', () => {
  for (const p of ['/en', '/ar', '/en/courses', '/ar/courses/llmops', '/en/sessions/recordings', '/en/register', '/en/courses?ref=main-site']) {
    assert.equal(cacheKind(req(p)), 'page', p);
  }
  assert.equal(cacheKind(req('/en/courses', { headers: { cookie: 'NEXT_LOCALE=ar; _ga=1' } })), 'page');
});

test('signed-in visitors always reach the container', () => {
  for (const cookie of ['access_token=abc', 'has_session=1', 'NEXT_LOCALE=en; has_session=1']) {
    assert.equal(cacheKind(req('/en/courses/llmops', { headers: { cookie } })), null, cookie);
  }
});

test('non-public API, non-GET, RSC/prefetch and private areas are never cached', () => {
  assert.equal(cacheKind(req('/api')), null);
  assert.equal(cacheKind(req('/en/courses', { method: 'HEAD' })), null);
  assert.equal(cacheKind(req('/en/courses', { method: 'POST' })), null);
  assert.equal(cacheKind(req('/en/courses', { headers: { rsc: '1' } })), null);
  assert.equal(cacheKind(req('/en/courses', { headers: { 'next-router-prefetch': '1' } })), null);
  assert.equal(cacheKind(req('/en/courses?_rsc=abc')), null);
  for (const p of ['/en/dashboard', '/ar/admin/courses', '/en/profile', '/en/onboarding', '/en/learn/x', '/en/courses/x/apply', '/en/verify-email', '/en/reset-password', '/en/waitlist/leave']) {
    assert.equal(cacheKind(req(p)), null, p);
  }
  // No locale prefix: the middleware redirects by cookie.
  assert.equal(cacheKind(req('/')), null);
  assert.equal(cacheKind(req('/courses/x')), null);
});

test('build assets are cacheable for everyone', () => {
  assert.equal(cacheKind(req('/_next/static/chunks/a.js', { headers: { cookie: 'has_session=1' } })), 'asset');
  const res = new Response('x', { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
  assert.equal(storableCacheControl('asset', res), 'public, max-age=31536000, immutable');
  assert.equal(storableCacheControl('asset', new Response('x', { headers: { 'cache-control': 'public, max-age=0' } })), null);
});

test('uploaded images are cached like build assets, for everyone', () => {
  const img = '/api/media/0f8fad5b-d9cb-469f-a165-70867728950e.webp';
  assert.equal(cacheKind(req(img)), 'asset');
  assert.equal(cacheKind(req(img, { headers: { cookie: 'has_session=1; access_token=x' } })), 'asset');
  // Not an image name, a query string, a cross-origin caller or a write: straight to the API, not stored.
  for (const p of ['/api/media/x.webp', '/api/media/0f8fad5b-d9cb-469f-a165-70867728950e.svg', '/api/media/', '/api/admin/media/library', `${img}?v=2`]) {
    assert.equal(cacheKind(req(p)), null, p);
  }
  assert.equal(cacheKind(req(img, { headers: { origin: 'https://example.com' } })), null);
  assert.equal(cacheKind(req(img, { method: 'POST' })), null);
  // Stored only as the API marks it (immutable, a year); a 404 never is.
  const ok = new Response('x', { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' } });
  assert.equal(storableCacheControl('asset', ok), 'public, max-age=31536000, immutable');
  assert.equal(browserCacheControl('asset', 'public, max-age=31536000, immutable'), 'public, max-age=31536000, immutable');
  assert.equal(storableCacheControl('asset', new Response('{}', { status: 404, headers: { 'cache-control': 'public, max-age=31536000, immutable' } })), null);
});

test('only shared-cacheable, cookie-free, fresh 200 HTML is stored, capped at PAGE_TTL', () => {
  assert.equal(storableCacheControl('page', html(isr)), `public, max-age=0, s-maxage=${PAGE_TTL}`);
  assert.equal(storableCacheControl('page', html({ ...isr, 'cache-control': 's-maxage=30, stale-while-revalidate=1' })), 'public, max-age=0, s-maxage=30');
  assert.equal(storableCacheControl('page', html({ 'cache-control': 's-maxage=300' })), `public, max-age=0, s-maxage=${PAGE_TTL}`);
  // Dynamic (per-request) pages.
  assert.equal(storableCacheControl('page', html({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' })), null);
  // Anything that sets a cookie other than NEXT_LOCALE alone (see the first-visit test below).
  assert.equal(storableCacheControl('page', html({ ...isr, 'set-cookie': 'session=abc; Path=/' })), null);
  // Not found / errors / redirects.
  assert.equal(storableCacheControl('page', html(isr, 404)), null);
  assert.equal(storableCacheControl('page', html(isr, 500)), null);
  assert.equal(storableCacheControl('page', new Response(null, { status: 307, headers: isr })), null);
  // A stale ISR copy (being regenerated).
  assert.equal(storableCacheControl('page', html({ ...isr, 'x-nextjs-cache': 'STALE' })), null);
  // No caching headers at all.
  assert.equal(storableCacheControl('page', html({})), null);
  // Not HTML.
  assert.equal(storableCacheControl('page', new Response('{}', { headers: { ...isr, 'content-type': 'application/json' } })), null);
});

test('pages served from the edge still remember the locale like the middleware does', () => {
  assert.equal(localeCookie(req('/ar/courses')), 'NEXT_LOCALE=ar; Path=/; Max-Age=31536000; SameSite=Lax');
  assert.equal(localeCookie(req('/ar/courses', { headers: { cookie: 'NEXT_LOCALE=en' } })), 'NEXT_LOCALE=ar; Path=/; Max-Age=31536000; SameSite=Lax');
  assert.equal(localeCookie(req('/en/courses', { headers: { cookie: 'NEXT_LOCALE=en' } })), null);
});

const withCookies = (cookies: string[]) => {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', ...isr });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response('<html>page</html>', { status: 200, headers });
};

test('first visits (only the middleware NEXT_LOCALE cookie) are stored, without the cookie', async () => {
  const visitorResponse = withCookies(['NEXT_LOCALE=ar; Path=/; Max-Age=31536000; SameSite=lax']);
  const cc = storableCacheControl('page', visitorResponse);
  assert.equal(cc, `public, max-age=0, s-maxage=${PAGE_TTL}`);
  const stored = storedCopy(visitorResponse.clone(), cc!);
  assert.equal(stored.headers.get('set-cookie'), null);
  assert.equal(stored.headers.get('cache-control'), cc);
  assert.equal(await stored.text(), '<html>page</html>');
  // The visitor's own response (the miss) still carries the cookie...
  assert.match(visitorResponse.headers.get('set-cookie') ?? '', /^NEXT_LOCALE=ar;/);
  // ...and a later hit for a first-time visitor gets it from the Worker.
  assert.equal(localeCookie(req('/ar/courses')), 'NEXT_LOCALE=ar; Path=/; Max-Age=31536000; SameSite=Lax');
});

test('NEXT_LOCALE plus any other cookie is never stored', () => {
  assert.equal(storableCacheControl('page', withCookies(['NEXT_LOCALE=en; Path=/', 'other=1; Path=/'])), null);
  assert.equal(storableCacheControl('page', withCookies(['other=1; Path=/', 'NEXT_LOCALE=en; Path=/'])), null);
  // Assets never carry cookies into the cache, NEXT_LOCALE or not.
  const asset = new Response('x', { headers: { 'cache-control': 'public, max-age=31536000, immutable', 'set-cookie': 'NEXT_LOCALE=en' } });
  assert.equal(storableCacheControl('asset', asset), null);
});

// ---- Public API reads

const json = (headers: Record<string, string>, status = 200, body = '[]') =>
  new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const apiPublic = { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' };

test('anonymous GETs of the public catalog API are cacheable', () => {
  for (const p of [
    '/api/courses',
    '/api/courses?level=BEGINNER',
    '/api/courses/slugs',
    '/api/courses/llmops',
    '/api/events',
    '/api/events/redis-for-semantic-caching',
    '/api/speakers',
    '/api/speakers/aya-nasser-salama',
    '/api/recordings',
    '/api/recordings?topic=python',
    '/api/recordings/search?q=k8s',
    '/api/settings/public',
  ]) {
    assert.equal(cacheKind(req(p)), 'api', p);
  }
  // Unrelated cookies don't matter.
  assert.equal(cacheKind(req('/api/courses', { headers: { cookie: 'NEXT_LOCALE=ar; _ga=1' } })), 'api');
});

test('the API is never cached for a session, a cross-origin caller, or anything personal', () => {
  for (const cookie of ['access_token=abc', 'has_session=1791556000', 'refresh_token=x', 'NEXT_LOCALE=en; has_session=1']) {
    assert.equal(cacheKind(req('/api/courses', { headers: { cookie } })), null, cookie);
    assert.equal(cacheKind(req('/api/events/x', { headers: { cookie } })), null, cookie);
  }
  assert.equal(cacheKind(req('/api/courses', { headers: { origin: 'https://example.com' } })), null);
  assert.equal(cacheKind(req('/api/courses', { headers: { authorization: 'Bearer x' } })), null);
  for (const p of [
    '/api/auth/me',
    '/api/notifications/unread-count',
    '/api/me/events',
    '/api/me/applications',
    '/api/courses/llmops/my-status',
    '/api/events/x/calendar.ics',
    '/api/learn/llmops',
    '/api/admin/courses',
    '/api/health',
    '/api/health/live',
    '/api/calendar/feed/secret-token.ics',
    '/api/courses/../admin',
    '/api/courses/UPPER',
  ]) {
    assert.equal(cacheKind(req(p)), null, p);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.equal(cacheKind(req('/api/courses', { method })), null, method);
});

test('only what the API marked public is stored, capped at API_TTL', () => {
  assert.equal(storableCacheControl('api', json(apiPublic)), `public, max-age=0, s-maxage=${API_TTL}`);
  assert.equal(storableCacheControl('api', json({ 'cache-control': 'public, s-maxage=30' })), 'public, max-age=0, s-maxage=30');
  assert.equal(storableCacheControl('api', json({ 'cache-control': 'public, s-maxage=600' })), `public, max-age=0, s-maxage=${API_TTL}`);
  // Signed-in or personal answers (the API marks them private).
  assert.equal(storableCacheControl('api', json({ 'cache-control': 'private, no-store' })), null);
  assert.equal(storableCacheControl('api', json({ 'cache-control': 'private, no-cache' })), null);
  // The old browser-only header, or nothing: not for the edge.
  assert.equal(storableCacheControl('api', json({ 'cache-control': 'public, max-age=60' })), null);
  assert.equal(storableCacheControl('api', json({})), null);
  // Anything that sets a cookie, even with public headers.
  assert.equal(storableCacheControl('api', json({ ...apiPublic, 'set-cookie': 'NEXT_LOCALE=en; Path=/' })), null);
  // Errors, busy answers, non-JSON.
  for (const status of [404, 429, 500, 503]) assert.equal(storableCacheControl('api', json(apiPublic, status)), null, String(status));
  assert.equal(storableCacheControl('api', new Response('x', { headers: { ...apiPublic, 'content-type': 'text/calendar' } })), null);
});

test('browsers always revalidate cached pages and API answers; assets keep their header', () => {
  assert.equal(browserCacheControl('page', 'public, max-age=14400, s-maxage=60'), 'public, max-age=0, must-revalidate');
  assert.equal(browserCacheControl('api', 'public, max-age=14400, s-maxage=60'), 'public, max-age=0, must-revalidate');
  assert.equal(browserCacheControl('asset', 'public, max-age=31536000, immutable'), 'public, max-age=31536000, immutable');
});
