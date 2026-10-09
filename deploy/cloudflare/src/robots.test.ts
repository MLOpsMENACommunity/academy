import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { DISALLOW_ALL, disallowAllRobots, isProduction, NOINDEX, withNoindex } from './robots.ts';

test('only exactly "production" is production', () => {
  assert.equal(isProduction('production'), true);
  for (const env of ['staging', 'Production', 'prod', '', undefined]) assert.equal(isProduction(env), false, String(env));
});

test('non-production robots.txt disallows everything and is itself noindex', async () => {
  const res = disallowAllRobots();
  assert.equal(res.status, 200);
  assert.equal(await res.text(), DISALLOW_ALL);
  assert.match(DISALLOW_ALL, /^User-agent: \*\nDisallow: \/\n$/);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('x-robots-tag'), NOINDEX);
});

test('withNoindex tags any response, including immutable redirects, and keeps the rest', async () => {
  const page = withNoindex(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'a=1' } }));
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(page.headers.get('set-cookie'), 'a=1');
  assert.equal(await page.text(), '<html></html>');

  const redirect = withNoindex(Response.redirect('https://academy-staging.mlopsmena.com/en', 301));
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), 'https://academy-staging.mlopsmena.com/en');
  assert.equal(redirect.headers.get('x-robots-tag'), NOINDEX);

  // A container's own (weaker) value is replaced.
  assert.equal(withNoindex(new Response('', { headers: { 'x-robots-tag': 'all' } })).headers.get('x-robots-tag'), NOINDEX);
});

test('wrangler.jsonc marks production as production and staging as not, for the Worker and the web build', () => {
  const { config } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const web = (block: { containers: { class_name: string; image_vars?: Record<string, string> }[] }) =>
    block.containers.find((c) => c.class_name === 'WebContainer')!.image_vars ?? {};
  assert.equal(config.vars.ACADEMY_ENVIRONMENT, 'production');
  assert.equal(web(config).NEXT_PUBLIC_ACADEMY_ENVIRONMENT, 'production');
  assert.equal(config.env.staging.vars.ACADEMY_ENVIRONMENT, 'staging');
  assert.equal(web(config.env.staging).NEXT_PUBLIC_ACADEMY_ENVIRONMENT, 'staging');
});
