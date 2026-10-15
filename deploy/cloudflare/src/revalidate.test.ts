import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKind, EDGE_TAG, storedCopy } from './edge-cache.ts';
import { isRevalidateRequest, purgeRequest, REVALIDATE_PATH, revalidateToken } from './revalidate.ts';

const JOBS = 'j'.repeat(48);

test('the revalidation token: the explicit secret, else derived from JOBS_TOKEN, else none', async () => {
  const own = 'r'.repeat(40);
  assert.equal(await revalidateToken({ REVALIDATE_TOKEN: own, JOBS_TOKEN: JOBS }), own);
  const derived = await revalidateToken({ JOBS_TOKEN: JOBS });
  assert.match(derived!, /^[0-9a-f]{64}$/);
  // Stable (both containers and the Worker compute the same one), never the jobs token itself.
  assert.equal(await revalidateToken({ JOBS_TOKEN: JOBS }), derived);
  assert.notEqual(derived, JOBS);
  assert.notEqual(await revalidateToken({ JOBS_TOKEN: 'k'.repeat(48) }), derived);
  // A short explicit secret is ignored; nothing to derive from means no revalidation.
  assert.equal(await revalidateToken({ REVALIDATE_TOKEN: 'short', JOBS_TOKEN: JOBS }), derived);
  assert.equal(await revalidateToken({}), null);
  assert.equal(await revalidateToken({ JOBS_TOKEN: 'short' }), null);
});

test('only the exact path is the revalidation route', () => {
  assert.equal(isRevalidateRequest(new Request(`https://h.test${REVALIDATE_PATH}`, { method: 'POST' })), true);
  assert.equal(isRevalidateRequest(new Request(`https://h.test${REVALIDATE_PATH}/x`)), false);
  assert.equal(isRevalidateRequest(new Request('https://h.test/api/internal/revalidate')), false);
});

test('the edge purge runs only when fully configured, and purges by tag', async () => {
  const zone = 'a'.repeat(32);
  assert.equal(purgeRequest({}, EDGE_TAG), null);
  assert.equal(purgeRequest({ EDGE_PURGE_ZONE_ID: zone }, EDGE_TAG), null);
  assert.equal(purgeRequest({ EDGE_PURGE_API_TOKEN: 't' }, EDGE_TAG), null);
  assert.equal(purgeRequest({ EDGE_PURGE_ZONE_ID: 'not-a-zone', EDGE_PURGE_API_TOKEN: 't' }, EDGE_TAG), null);
  const req = purgeRequest({ EDGE_PURGE_ZONE_ID: zone, EDGE_PURGE_API_TOKEN: 'tok' }, EDGE_TAG)!;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`);
  assert.equal(req.headers.get('authorization'), 'Bearer tok');
  assert.deepEqual(await req.json(), { tags: [EDGE_TAG] });
});

test('stored pages and API answers carry the purge tag; immutable assets do not', () => {
  const res = () => new Response('x', { headers: { 'cache-tag': 'from-origin' } });
  assert.equal(storedCopy(res(), 'public, s-maxage=30', 'page').headers.get('cache-tag'), EDGE_TAG);
  assert.equal(storedCopy(res(), 'public, s-maxage=30', 'api').headers.get('cache-tag'), EDGE_TAG);
  assert.equal(storedCopy(res(), 'public, max-age=31536000, immutable', 'asset').headers.get('cache-tag'), null);
});

test("the web app's own server-side reads skip the edge cache", () => {
  const skip = { headers: { 'x-skip-edge-cache': '1' } };
  assert.equal(cacheKind(new Request('https://h.test/api/courses', skip)), null);
  assert.equal(cacheKind(new Request('https://h.test/api/courses/x', skip)), null);
  assert.equal(cacheKind(new Request('https://h.test/api/courses')), 'api');
  // Only API reads: pages are cached as usual whatever the header says.
  assert.equal(cacheKind(new Request('https://h.test/en/courses', skip)), 'page');
});
