/**
 * On-demand revalidation: an admin edit shows on the public site within seconds.
 *
 *   API (after an admin write)  --POST /_internal/revalidate, x-revalidate-token-->  this Worker
 *     1. every running web container: POST /api/internal/revalidate (Next drops its cached
 *        public API reads and rendered pages; apps/web/src/app/api/internal/revalidate).
 *        A sleeping container is left asleep: it starts from its image, with no cache.
 *     2. the edge cache: every stored page and public API answer carries Cache-Tag EDGE_TAG
 *        (edge-cache.ts),
 *        purged in every data centre through the Cloudflare API when EDGE_PURGE_ZONE_ID and
 *        EDGE_PURGE_API_TOKEN are set, and then copies are kept an hour (PURGED_TTL). Without
 *        them, edge copies expire on their own (PAGE_TTL / API_TTL in edge-cache.ts, 30 s).
 *
 * The token is REVALIDATE_TOKEN when that secret is set, otherwise derived from JOBS_TOKEN
 * (HMAC), so no new secret is needed; the Worker hands it to both containers.
 * Pure functions here (tested under Node); the wiring is in index.ts.
 */
export const REVALIDATE_PATH = '/_internal/revalidate';
export const REVALIDATE_HEADER = 'x-revalidate-token';
/** The web app's endpoint, inside each web container. */
export const WEB_REVALIDATE_URL = 'http://container/api/internal/revalidate';

export function isRevalidateRequest(request: Request): boolean {
  return new URL(request.url).pathname === REVALIDATE_PATH;
}

/** REVALIDATE_TOKEN, or HMAC-SHA256(JOBS_TOKEN, "academy-revalidate-v1") in hex; null without either. */
export async function revalidateToken(env: { REVALIDATE_TOKEN?: string; JOBS_TOKEN?: string }): Promise<string | null> {
  if (env.REVALIDATE_TOKEN && env.REVALIDATE_TOKEN.length >= 32) return env.REVALIDATE_TOKEN;
  if (!env.JOBS_TOKEN || env.JOBS_TOKEN.length < 32) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JOBS_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('academy-revalidate-v1'));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PurgeConfig {
  EDGE_PURGE_ZONE_ID?: string;
  EDGE_PURGE_API_TOKEN?: string;
}

/** The Cloudflare API call that purges every edge copy tagged `tag`, or null when not configured. */
export function purgeRequest(env: PurgeConfig, tag: string): Request | null {
  const zone = env.EDGE_PURGE_ZONE_ID?.trim();
  const token = env.EDGE_PURGE_API_TOKEN?.trim();
  if (!zone || !token || !/^[0-9a-f]{32}$/.test(zone)) return null;
  return new Request(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tags: [tag] }),
  });
}
