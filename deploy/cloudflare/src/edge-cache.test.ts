import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKind, localeCookie, PAGE_TTL, storableCacheControl } from './edge-cache.ts';

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

test('API, non-GET, RSC/prefetch and private areas are never cached', () => {
  assert.equal(cacheKind(req('/api/courses')), null);
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

test('only shared-cacheable, cookie-free, fresh 200 HTML is stored, capped at PAGE_TTL', () => {
  assert.equal(storableCacheControl('page', html(isr)), `public, max-age=0, s-maxage=${PAGE_TTL}`);
  assert.equal(storableCacheControl('page', html({ ...isr, 'cache-control': 's-maxage=30, stale-while-revalidate=1' })), 'public, max-age=0, s-maxage=30');
  assert.equal(storableCacheControl('page', html({ 'cache-control': 's-maxage=300' })), `public, max-age=0, s-maxage=${PAGE_TTL}`);
  // Dynamic (per-request) pages.
  assert.equal(storableCacheControl('page', html({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' })), null);
  // Anything that sets a cookie.
  assert.equal(storableCacheControl('page', html({ ...isr, 'set-cookie': 'NEXT_LOCALE=en; Path=/' })), null);
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
