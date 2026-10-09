import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchContainer, isLibraryFailureText, LONG_TIMEOUT_MS, READ_TIMEOUT_MS, RETRY_AFTER_STARTING_S, RETRY_AFTER_TIMEOUT_S, timeoutFor } from './container-fetch.ts';

const logs: string[] = [];
const log = (m: string) => logs.push(m);

test('a container that never answers becomes a fast 503 with Retry-After', async () => {
  logs.length = 0;
  const started = Date.now();
  const { response, outcome } = await fetchContainer(() => new Promise<Response>(() => undefined), { ms: 50, name: 'api', log });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(outcome, 'timeout');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), String(RETRY_AFTER_TIMEOUT_S));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /no response within 50 ms/);
});

test('"container is starting" from the container library is a 503, never a 500', async () => {
  for (const [status, text] of [
    [500, 'Failed to start container: The container is not listening in the TCP address 10.0.0.1:4000'],
    [500, 'Container suddenly disconnected, try again'],
    [500, 'Error proxying request to container: Network connection lost.'],
    [503, 'There is no Container instance available at this time.\nThis is likely because…'],
  ] as const) {
    logs.length = 0;
    const { response, outcome } = await fetchContainer(async () => new Response(text, { status }), { ms: 1_000, name: 'api', log });
    assert.equal(outcome, 'starting', text);
    assert.equal(response.status, 503, text);
    assert.equal(response.headers.get('retry-after'), String(RETRY_AFTER_STARTING_S));
    assert.equal(logs.length, 1);
  }
});

test("the application's own answers pass through untouched, errors included", async () => {
  const cases = [
    new Response('{"statusCode":500,"message":"Internal server error"}', { status: 500, headers: { 'content-type': 'application/json' } }),
    new Response('{"statusCode":503,"code":"BUSY"}', { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '5' } }),
    new Response('<html>Internal Server Error</html>', { status: 500, headers: { 'content-type': 'text/html' } }),
    new Response('Some other plain text error', { status: 500, headers: { 'content-type': 'text/plain' } }),
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  for (const original of cases) {
    const { response, outcome } = await fetchContainer(async () => original, { ms: 1_000, name: 'api', log });
    assert.equal(outcome, 'ok');
    assert.equal(response, original);
  }
  // The body of a passed-through text/plain 500 is still readable (only a clone was inspected).
  const plain = new Response('Some other plain text error', { status: 500, headers: { 'content-type': 'text/plain' } });
  const { response } = await fetchContainer(async () => plain, { ms: 1_000, name: 'api', log });
  assert.equal(await response.text(), 'Some other plain text error');
});

test('a thrown fetch (container unreachable) is a 503 too', async () => {
  const { response, outcome } = await fetchContainer(async () => Promise.reject(new Error('boom')), { ms: 1_000, name: 'web', log });
  assert.equal(outcome, 'unreachable');
  assert.equal(response.status, 503);
});

test('timeouts: reads leave room for a cold start; writes and admin exports wait as long as the API', () => {
  assert.equal(timeoutFor('GET', '/api/courses'), READ_TIMEOUT_MS);
  assert.equal(timeoutFor('HEAD', '/en/courses'), READ_TIMEOUT_MS);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(timeoutFor(m, '/api/me/profile'), LONG_TIMEOUT_MS, m);
  assert.equal(timeoutFor('GET', '/api/admin/students/export.csv'), LONG_TIMEOUT_MS);
  // Above the container library's 20 s wait for the port, so a cold start isn't cut off.
  assert.ok(READ_TIMEOUT_MS > 20_000 && READ_TIMEOUT_MS <= 30_000);
  // Never shorter than the API's own request timeout (120 s): no "try again" for a write still running.
  assert.equal(LONG_TIMEOUT_MS, 120_000);
});

test('library failure texts are recognised by their prefix only', () => {
  assert.equal(isLibraryFailureText('Failed to start container: x'), true);
  assert.equal(isLibraryFailureText('  container suddenly disconnected, try again'), true);
  assert.equal(isLibraryFailureText('The course failed to start container builds'), false);
});
