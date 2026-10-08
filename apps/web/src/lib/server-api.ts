import 'server-only';

const base = () => process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Server-side GET to the API for public pages. Cached and revalidated (ISR).
 * Returns null on 404 and on network errors, so a build without a running API
 * still succeeds and pages fill in on the next revalidation.
 */
export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${base()}/api${path}`, { next: { revalidate, tags: ['courses'] } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
