/**
 * Staging must never run against production's database. The GitHub deploy checked the
 * staging environment's database URLs on every deploy, because it uploaded them to the
 * Worker each time. With Workers Builds the secrets live on the Worker and a deploy never
 * sees them, so the Worker checks them itself: a staging Worker whose DATABASE_URL or
 * DIRECT_DATABASE_URL isn't the staging role on a staging database answers 503 and never
 * starts a container (fetch() in index.ts; production never reaches this code).
 *
 * The rules are the ones deploy-cloudflare.yml applied, and set-worker-secret.sh applies
 * before setting a value. Nothing parsed from a URL is ever returned or logged (a malformed
 * one could hold the password).
 */
export interface StagingDatabaseEnv {
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
}

/** Why this staging Worker's database secrets are unsafe, or null when they're fine. */
export function stagingDatabaseProblem(env: StagingDatabaseEnv): string | null {
  for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const) {
    const raw = env[name];
    if (!raw) return `${name} is not set`;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return `${name} is not a valid URL`;
    }
    const db = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const role = decodeURIComponent(url.username);
    if (!/^[A-Za-z0-9_-]+$/.test(db) || !db.includes('staging')) return `${name} must point at a staging database`;
    if (!role.includes('staging')) return `${name} must connect with the staging database role`;
  }
  return null;
}

/** What a misconfigured staging Worker answers instead of starting a container. */
export function stagingMisconfigured(): Response {
  return new Response('Staging is misconfigured: its database secrets are not staging ones. See the Worker logs.\n', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
  });
}
