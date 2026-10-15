import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * On-demand revalidation of the public pages (an admin edit shows within seconds).
 *
 * Every server-side read of public API data (lib/server-api.ts) carries PUBLIC_TAG, and
 * POST /api/internal/revalidate (app/api/internal/revalidate/route.ts) drops those reads and
 * every rendered page of this instance. The API calls it after each admin write, through the
 * Worker on Cloudflare (which calls every running web container and purges the edge cache).
 */
export const PUBLIC_TAG = 'public';
export const REVALIDATE_HEADER = 'x-revalidate-token';

/** Constant-time check of the shared secret; never matches when REVALIDATE_TOKEN is unset or short. */
export function revalidateTokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 32) return false;
  // Equal-length digests: timingSafeEqual needs equal lengths, and the length isn't leaked.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
