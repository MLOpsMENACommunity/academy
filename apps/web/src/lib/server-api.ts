import 'server-only';
import { PUBLIC_TAG } from './revalidate';

const base = () => process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export class ApiUnavailableError extends Error {}

/**
 * On Cloudflare these reads go back through the Worker (API_INTERNAL_URL is the public host),
 * and the Worker keeps anonymous catalog reads at the edge for a few seconds. A page that is
 * being re-rendered because an admin just changed something must read the API itself, not
 * that copy: this header makes the Worker skip its edge cache (the API's own in-process
 * cache, which every admin write clears, still shields the database).
 */
export const SKIP_EDGE_CACHE = { 'x-skip-edge-cache': '1' } as const;

/**
 * `next build` prerenders pages while the API is unreachable (the image build has no API).
 * Those renders are thrown away after the build (scripts/drop-isr-prerenders.mjs), so there
 * a failed fetch just means "no data" rather than a failed build.
 */
const building = () => process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Server-side GET to the API for public pages (cached, revalidated by ISR, and at once after
 * an admin edit: every read is tagged PUBLIC_TAG, see lib/revalidate.ts).
 *
 * Returns null only for a real 404. Any other failure throws, so Next keeps
 * serving the last good version of an ISR page instead of caching a 404 for a
 * live course during a brief API restart; with no good version yet (a fresh
 * container), the visitor gets an uncached 500 rather than an empty page that the
 * ISR and edge caches would keep. Use it for every ISR page's main data.
 */
export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${base()}/api${path}`, { headers: SKIP_EDGE_CACHE, next: { revalidate, tags: [PUBLIC_TAG] } });
  } catch (err) {
    if (building()) return null;
    console.error(`[server-api] GET ${path} failed: ${(err as Error).name}`);
    throw new ApiUnavailableError(path);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    if (building()) return null;
    console.error(`[server-api] GET ${path} returned ${res.status}`);
    throw new ApiUnavailableError(path);
  }
  return (await res.json()) as T;
}

/** For optional extras only (never an ISR page's main data): an empty fallback instead of an error page. */
export async function serverGetOr<T>(path: string, fallback: T, revalidate = 60): Promise<T> {
  try {
    return (await serverGet<T>(path, revalidate)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Slugs to prerender at build time, for generateStaticParams. The API is usually not
 * reachable while the image builds: then nothing is prerendered and every page renders
 * on its first request instead (dynamicParams), then is cached like any ISR page.
 * Never fails the build, and gives up after a few seconds.
 */
const MAX_PRERENDER = 100;

export async function staticSlugs<T>(path: string, slugs: (data: T) => string[]): Promise<{ slug: string }[]> {
  try {
    const res = await fetch(`${base()}/api${path}`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
    if (!res.ok) return [];
    return slugs((await res.json()) as T)
      .filter((slug) => /^[a-z0-9-]{1,80}$/.test(slug))
      // A bounded build: anything past this renders on first request instead.
      .slice(0, MAX_PRERENDER)
      .map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

/**
 * Uncached server-side GET for pages that must always be current (the certificate
 * verification page: a revocation shows at once).
 * Returns null for a 404; throws for anything else that isn't OK.
 */
export async function serverGetFresh<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${base()}/api${path}`, {
      headers: SKIP_EDGE_CACHE,
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.error(`[server-api] GET ${path} failed: ${(err as Error).name}`);
    throw new ApiUnavailableError(path);
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new RateLimitedError(path);
  if (!res.ok) {
    console.error(`[server-api] GET ${path} returned ${res.status}`);
    throw new ApiUnavailableError(path);
  }
  return (await res.json()) as T;
}

/** The API's rate limit answered instead (too many lookups from this visitor). */
export class RateLimitedError extends Error {}

/** The visitor's IP as the entry Worker set it (from cf-connecting-ip; the last X-Forwarded-For entry). */
export function forwardedIp(h: Headers): string | null {
  const parts = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}
