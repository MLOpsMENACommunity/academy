/**
 * Scheduled jobs (anonymisation, retention, reminders, profile reviews) run from the Worker's
 * Cron Trigger in production. Staging has no Cron Trigger, so its containers only wake when
 * someone uses staging; to run the jobs there on demand (e.g. to test reminders):
 *
 *   curl -X POST -H "x-jobs-token: $JOBS_TOKEN" https://academy-staging.mlopsmena.com/_jobs/tick
 *
 * with staging's JOBS_TOKEN. The route exists only outside production (index.ts), and needs
 * the token: anything else gets a 403. /api/internal/* itself stays unreachable from outside.
 */
export const MANUAL_TICK_PATH = '/_jobs/tick';

export function isManualJobsTick(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === MANUAL_TICK_PATH;
}

/** Constant-time comparison; never matches an unset or short token. */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 32) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}
