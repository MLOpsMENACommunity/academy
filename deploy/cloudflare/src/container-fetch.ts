/**
 * Talking to a container without hanging and without opaque 500s. Pure functions (plus a
 * fetch wrapper), so they can be tested without a Worker runtime.
 *
 * @cloudflare/containers answers some failures itself, as plain-text responses:
 *   - 500 "Failed to start container: …" (e.g. "the container is not listening in the TCP
 *     address 10.0.0.1:4000": it is still starting, or restarting after a crash),
 *   - 500 "Container suddenly disconnected, try again" (it restarted mid-request),
 *   - 500 "Error proxying request to container: …",
 *   - 503 "There is no Container instance available at this time…".
 * None of these is an application error: they mean "not available right now", so the Worker
 * turns them into one 503 with Retry-After, logged as a warning, never as a 500.
 * The API and the web app never answer text/plain 5xx with these words themselves (the API
 * answers JSON, Next answers HTML), so they can't be mistaken for one.
 *
 * A request that gets no answer within the timeout also becomes a 503 with Retry-After. The
 * timeouts sit above the slowest legitimate case: a cold start (the container library waits
 * up to 20 s for the port; the API now listens within seconds) plus the API's own fast-fail
 * limits (5 s database pool wait), so they only cut off requests that are truly stuck; writes
 * and admin requests (exports) wait as long as the API would.
 */

/** Public and personal reads (GET/HEAD): cold start + a slow render, nothing more. */
export const READ_TIMEOUT_MS = 25_000;
/**
 * Writes and admin requests (uploads, CSV exports, bulk actions) get as long as the API itself
 * allows a request (server.requestTimeout, apps/api/src/main.ts), so the Worker never answers
 * "try again" for a write the API is still carrying out (which could be repeated twice).
 */
export const LONG_TIMEOUT_MS = 120_000;

export const RETRY_AFTER_STARTING_S = 10;
export const RETRY_AFTER_TIMEOUT_S = 5;

const LIBRARY_FAILURES = [
  'failed to start container',
  'container suddenly disconnected',
  'error proxying request to container',
  'there is no container instance available',
];

export function timeoutFor(method: string, pathname = '/'): number {
  if (method !== 'GET' && method !== 'HEAD') return LONG_TIMEOUT_MS;
  return pathname.startsWith('/api/admin/') ? LONG_TIMEOUT_MS : READ_TIMEOUT_MS;
}

/** Whether a response could be one of the container library's own failures (needs a body check). */
export function maybeLibraryFailure(response: Response): boolean {
  if (response.status !== 500 && response.status !== 503) return false;
  return (response.headers.get('content-type') ?? 'text/plain').toLowerCase().startsWith('text/plain');
}

/** Whether a body is one of the container library's failure messages. */
export function isLibraryFailureText(text: string): boolean {
  const t = text.trimStart().slice(0, 120).toLowerCase();
  return LIBRARY_FAILURES.some((p) => t.startsWith(p));
}

export function unavailable(retryAfterS: number): Response {
  return new Response('The academy is busy or starting up, please try again in a moment.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': String(retryAfterS), 'cache-control': 'no-store' },
  });
}

export type ContainerOutcome = 'ok' | 'starting' | 'timeout' | 'unreachable';

/**
 * One request to a container: answers within `ms` or becomes a 503, and library failures
 * become a 503 too. `log` receives one warning per failure (never console.error).
 */
export async function fetchContainer(
  doFetch: () => Promise<Response>,
  opts: { ms: number; name: string; log?: (message: string) => void },
): Promise<{ response: Response; outcome: ContainerOutcome }> {
  const log = opts.log ?? ((m: string) => console.warn(m));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.ms);
  });
  try {
    const result = await Promise.race([doFetch(), timedOut]);
    if (result === 'timeout') {
      log(`${opts.name} container: no response within ${opts.ms} ms; answered 503`);
      return { response: unavailable(RETRY_AFTER_TIMEOUT_S), outcome: 'timeout' };
    }
    if (maybeLibraryFailure(result)) {
      const text = await result.clone().text();
      if (isLibraryFailureText(text)) {
        await result.body?.cancel();
        log(`${opts.name} container unavailable (${result.status}: ${text.slice(0, 160)}); answered 503`);
        return { response: unavailable(RETRY_AFTER_STARTING_S), outcome: 'starting' };
      }
    }
    return { response: result, outcome: 'ok' };
  } catch (err) {
    log(`${opts.name} container fetch failed: ${(err as Error).message}; answered 503`);
    return { response: unavailable(RETRY_AFTER_TIMEOUT_S), outcome: 'unreachable' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
