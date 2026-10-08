import 'server-only';

const base = () => process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export class ApiUnavailableError extends Error {}

/**
 * Server-side GET to the API for public pages (cached, revalidated by ISR).
 *
 * Returns null only for a real 404. Any other failure throws, so Next keeps
 * serving the last good version of an ISR page instead of caching a 404 for a
 * live course during a brief API restart. Callers that can render without the
 * data (home page, catalog) catch and degrade.
 */
export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${base()}/api${path}`, { next: { revalidate, tags: ['courses'] } });
  } catch (err) {
    console.error(`[server-api] GET ${path} failed: ${(err as Error).name}`);
    throw new ApiUnavailableError(path);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`[server-api] GET ${path} returned ${res.status}`);
    throw new ApiUnavailableError(path);
  }
  return (await res.json()) as T;
}

/** For optional data: an empty fallback instead of an error page. */
export async function serverGetOr<T>(path: string, fallback: T, revalidate = 60): Promise<T> {
  try {
    return (await serverGet<T>(path, revalidate)) ?? fallback;
  } catch {
    return fallback;
  }
}
