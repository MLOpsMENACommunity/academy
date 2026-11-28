import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { AWAKE_INTERVAL_MS, FALLBACK_NEXT_MS, isInternalApiPath, isManualJobsTick, MANUAL_TICK_PATH, MAX_GAP_MS, shouldTick, stateAfterTick, tokenMatches } from './jobs.ts';

const TOKEN = 'a'.repeat(48);

test('manual job runs need the exact jobs token', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches(`${TOKEN}x`, TOKEN), false);
  assert.equal(tokenMatches(TOKEN.slice(1), TOKEN), false);
  assert.equal(tokenMatches('b'.repeat(48), TOKEN), false);
  assert.equal(tokenMatches(null, TOKEN), false);
  assert.equal(tokenMatches('', TOKEN), false);
  // Never with an unset or too-short configured token.
  assert.equal(tokenMatches('', ''), false);
  assert.equal(tokenMatches('short', 'short'), false);
  assert.equal(tokenMatches('x', undefined), false);
});

test('only POST to the manual tick path counts', () => {
  const at = (path: string, method = 'POST') => new Request(`https://academy-staging.mlopsmena.com${path}`, { method });
  assert.equal(isManualJobsTick(at(MANUAL_TICK_PATH)), true);
  assert.equal(isManualJobsTick(at(MANUAL_TICK_PATH, 'GET')), false);
  assert.equal(isManualJobsTick(at('/api/internal/jobs/tick')), false);
  assert.equal(isManualJobsTick(at(`${MANUAL_TICK_PATH}/x`)), false);
});

test('production checks every 15 minutes', () => {
  const { config } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  // The trigger itself wakes nothing: shouldTick decides whether the API is called.
  assert.deepEqual(config.triggers.crons, ['*/15 * * * *']);
});

test('internal API paths are blocked whatever their case (Express routes ignore case)', () => {
  for (const p of ['/api/internal/jobs/tick', '/api/Internal/jobs/tick', '/API/INTERNAL/jobs/tick', '/api/iNtErNaL/x']) {
    assert.equal(isInternalApiPath(p), true, p);
  }
  for (const p of ['/api/courses', '/api/internals', '/internal/jobs/tick', '/en/api/internal/x']) assert.equal(isInternalApiPath(p), false, p);
});

test('the jobs run when something is due, when the API is awake anyway, or after MAX_GAP', () => {
  const now = Date.UTC(2026, 10, 20, 3, 0);
  const recent = { lastTickAt: now - 20 * 60_000, nextDueAt: now + 2 * 3_600_000 };
  // Asleep, nothing due, last tick recent: leave it asleep.
  assert.equal(shouldTick(recent, now, false), false);
  // Something due (a reminder window opens now, or opened since).
  assert.equal(shouldTick({ ...recent, nextDueAt: now }, now, false), true);
  assert.equal(shouldTick({ ...recent, nextDueAt: now - 60_000 }, now, false), true);
  // Awake anyway: at most hourly.
  assert.equal(shouldTick(recent, now, true), false);
  assert.equal(shouldTick({ ...recent, lastTickAt: now - AWAKE_INTERVAL_MS }, now, true), true);
  // Asleep and nothing scheduled: only every MAX_GAP.
  assert.equal(shouldTick({ lastTickAt: now - MAX_GAP_MS + 60_000, nextDueAt: null }, now, false), false);
  assert.equal(shouldTick({ lastTickAt: now - MAX_GAP_MS, nextDueAt: null }, now, false), true);
  // Never ticked (first run after the deploy).
  assert.equal(shouldTick({ lastTickAt: 0, nextDueAt: null }, now, false), true);
});

test("the state after a tick follows the API's nextDueAt, hourly for an API without it", () => {
  const now = Date.UTC(2026, 10, 20, 3, 0);
  const due = '2026-11-20T05:15:00.000Z';
  assert.deepEqual(stateAfterTick({ remindersSent: 0, nextDueAt: due }, now), { lastTickAt: now, nextDueAt: Date.parse(due) });
  assert.deepEqual(stateAfterTick({ remindersSent: 0, nextDueAt: null }, now), { lastTickAt: now, nextDueAt: null });
  for (const body of [{ remindersSent: 0 }, { nextDueAt: 'soon' }, { nextDueAt: 5 }, null, 'x']) {
    assert.deepEqual(stateAfterTick(body, now), { lastTickAt: now, nextDueAt: now + FALLBACK_NEXT_MS }, JSON.stringify(body));
  }
});
