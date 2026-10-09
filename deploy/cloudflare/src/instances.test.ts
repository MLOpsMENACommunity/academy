import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { MAX_WEB_INSTANCES, webInstanceCount, webInstanceName } from './instances.ts';

test('WEB_INSTANCES is capped at max_instances; anything invalid means only main', () => {
  assert.equal(webInstanceCount('3'), 3);
  assert.equal(webInstanceCount('2'), 2);
  assert.equal(webInstanceCount('10'), MAX_WEB_INSTANCES);
  for (const bad of [undefined, '', '0', '-1', '1.5', 'three', ' ']) assert.equal(webInstanceCount(bad), 1, String(bad));
  assert.equal(webInstanceName(0), 'main');
  assert.equal(webInstanceName(2), 'web-2');
});

test('MAX_WEB_INSTANCES matches the WebContainer max_instances, and WEB_INSTANCES fits in it', () => {
  const { config } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  for (const block of [config, config.env.staging]) {
    const web = block.containers.find((c: { class_name: string }) => c.class_name === 'WebContainer');
    const n = Number(block.vars.WEB_INSTANCES ?? '1');
    assert.ok(n <= web.max_instances, `${block.name}: WEB_INSTANCES ${n} > max_instances ${web.max_instances}`);
    if (block === config) assert.equal(web.max_instances, MAX_WEB_INSTANCES);
  }
});
