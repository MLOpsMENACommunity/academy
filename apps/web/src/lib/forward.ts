/**
 * Leaving the login or register page for where a signed-in user belongs.
 *
 * Always a full page load, never a client-side router.replace: the router keeps the pages it
 * prefetched while the visitor was signed out (an Apply button prefetches /courses/x/apply),
 * and for a private page that prefetch is the middleware's redirect to /login. Reusing it
 * after sign-in sent people straight back to the login form, now signed in (the header said
 * so, the page didn't). A full load drops that cache and asks the server again, with the
 * new cookies.
 *
 * Loop guard: if the same target bounces us back here more than MAX_ATTEMPTS times within
 * WINDOW_MS, stop and let the page offer a link instead of reloading forever.
 */
const KEY = 'academy.forward';
export const MAX_ATTEMPTS = 2;
const WINDOW_MS = 30_000;

interface Attempts {
  target: string;
  count: number;
  at: number;
}

function read(storage: Storage): Attempts | null {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as Attempts | null;
    return value && typeof value.target === 'string' && typeof value.count === 'number' && typeof value.at === 'number' ? value : null;
  } catch {
    return null;
  }
}

/** Records one more attempt at `target`; false once it has already failed MAX_ATTEMPTS times. */
export function recordForward(target: string, storage: Storage | null, now = Date.now()): boolean {
  if (!storage) return true;
  const last = read(storage);
  const count = last && last.target === target && now - last.at < WINDOW_MS ? last.count + 1 : 1;
  if (count > MAX_ATTEMPTS) return false;
  try {
    storage.setItem(KEY, JSON.stringify({ target, count, at: now }));
  } catch {
    // storage full or blocked: forward anyway
  }
  return true;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Full-page navigation to `target`, replacing the login page in history. False when the loop guard stopped it. */
export function forwardTo(target: string): boolean {
  if (!recordForward(target, sessionStore())) return false;
  window.location.replace(target);
  return true;
}

/** Full-page navigation after signing out, so no page cached while signed in is shown again. */
export function leaveAfterLogout(target: string): void {
  window.location.assign(target);
}
