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

/**
 * Whether a path is one of the API's internal endpoints (/api/internal/…), which the Worker never
 * forwards from outside. Case-insensitive: Express matches routes regardless of case, so
 * /api/Internal/jobs/tick would otherwise reach the API.
 */
export function isInternalApiPath(pathname: string): boolean {
  return pathname.toLowerCase().startsWith('/api/internal/');
}

/**
 * When the Cron Trigger (every 15 minutes) actually runs the jobs. Each run wakes the API
 * container and, through it, the database, and both are billed while awake; an hourly run
 * kept them up about 2 hours a day for nothing on quiet days. So the API is called only:
 *
 *   - when something time-critical is due: the last tick answered `nextDueAt`, the moment a
 *     reminder window opens, a feedback prompt falls due or an email waits to be retried
 *     (apps/api/src/jobs/next-due.ts). A tick within 15 minutes of it is on time;
 *   - when the API is awake anyway (someone is using the site) and the last tick is at least
 *     AWAKE_INTERVAL_MS old: hourly while the site is in use, at almost no cost;
 *   - at least every MAX_GAP_MS, for the jobs that can wait (retention, anonymisation,
 *     automation rules, Drive sharing, points).
 *
 * The state lives in the API's Durable Object (index.ts), which can tell whether the container
 * is running without starting it. A failed tick changes nothing, so the next trigger retries.
 */
export const AWAKE_INTERVAL_MS = 60 * 60_000;
export const MAX_GAP_MS = 4 * 60 * 60_000;
/** What an API that doesn't send `nextDueAt` (an older release) gets: today's hourly ticks. */
export const FALLBACK_NEXT_MS = 60 * 60_000;

export interface TickState {
  /** Epoch ms of the last successful tick; 0 when there was none. */
  lastTickAt: number;
  /** Epoch ms when something is next due; null when nothing is scheduled. */
  nextDueAt: number | null;
}

export function shouldTick(state: TickState, now: number, apiRunning: boolean): boolean {
  if (state.nextDueAt !== null && now >= state.nextDueAt) return true;
  if (now - state.lastTickAt >= MAX_GAP_MS) return true;
  return apiRunning && now - state.lastTickAt >= AWAKE_INTERVAL_MS;
}

/** The state after a successful tick, from its JSON answer (anything but `{ nextDueAt }` falls back to hourly). */
export function stateAfterTick(body: unknown, now: number): TickState {
  const has = typeof body === 'object' && body !== null && 'nextDueAt' in body;
  if (!has) return { lastTickAt: now, nextDueAt: now + FALLBACK_NEXT_MS };
  const raw = (body as { nextDueAt: unknown }).nextDueAt;
  if (raw === null) return { lastTickAt: now, nextDueAt: null };
  const at = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return { lastTickAt: now, nextDueAt: Number.isFinite(at) ? at : now + FALLBACK_NEXT_MS };
}
