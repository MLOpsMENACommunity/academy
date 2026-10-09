import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { isManualJobsTick, MANUAL_TICK_PATH, tokenMatches } from './jobs.ts';

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

test('staging has no Cron Trigger (it only wakes when used); production keeps its hourly one', () => {
  const { config } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, ['0 * * * *']);
  // An env without "triggers" would inherit production's crons: it must say [] explicitly.
  assert.deepEqual(config.env.staging.triggers, { crons: [] });
});
