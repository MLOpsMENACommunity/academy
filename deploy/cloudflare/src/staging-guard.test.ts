import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stagingDatabaseProblem, stagingMisconfigured } from './staging-guard.ts';

const ok = {
  DATABASE_URL: 'postgresql://academy_staging:pw@ep-x-pooler.eu-central-1.aws.neon.tech/academy_staging?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://academy_staging:pw@ep-x.eu-central-1.aws.neon.tech/academy_staging?sslmode=require',
};

test('the staging role on the staging database passes', () => {
  assert.equal(stagingDatabaseProblem(ok), null);
});

test("production's database, or production's role, is refused", () => {
  const prodDb = 'postgresql://academy_staging:pw@ep-x.aws.neon.tech/neondb?sslmode=require';
  const prodRole = 'postgresql://neondb_owner:pw@ep-x.aws.neon.tech/academy_staging?sslmode=require';
  assert.match(stagingDatabaseProblem({ ...ok, DATABASE_URL: prodDb })!, /DATABASE_URL must point at a staging database/);
  assert.match(stagingDatabaseProblem({ ...ok, DIRECT_DATABASE_URL: prodRole })!, /DIRECT_DATABASE_URL must connect with the staging database role/);
});

test('both URLs are required, well formed, with a plain database name', () => {
  assert.match(stagingDatabaseProblem({ DATABASE_URL: ok.DATABASE_URL })!, /DIRECT_DATABASE_URL is not set/);
  assert.match(stagingDatabaseProblem({ ...ok, DATABASE_URL: 'not a url' })!, /not a valid URL/);
  assert.match(stagingDatabaseProblem({ ...ok, DATABASE_URL: 'postgresql://academy_staging:pw@host' })!, /staging database/);
  assert.match(stagingDatabaseProblem({ ...ok, DATABASE_URL: 'postgresql://academy_staging:pw@host/a%2Fstaging' })!, /staging database/);
});

test('the reason never contains the URL or its password', () => {
  const leaky = 'postgresql://neondb_owner:SuperSecret@ep-x.aws.neon.tech/neondb';
  const problem = stagingDatabaseProblem({ ...ok, DATABASE_URL: leaky })!;
  assert.ok(!problem.includes('SuperSecret') && !problem.includes('neondb'));
});

test('a misconfigured staging answers 503, uncached, and says why only in general terms', async () => {
  const res = stagingMisconfigured();
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /misconfigured/);
});
