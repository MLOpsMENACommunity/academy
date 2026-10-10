'use client';

import { useSyncExternalStore } from 'react';

/**
 * A query-string value read on the client only.
 *
 * Unlike `useSearchParams()`, this does not opt a statically rendered page out of
 * server rendering: the server (and the first client render, during hydration) sees
 * `null`, and the real value follows straight after hydration. Use it on pages that are
 * served from the ISR / edge cache, where the HTML must not depend on the query string.
 * Next's client navigations update the URL in the same commit as the new page, which
 * React re-checks after commit, and back/forward fire `popstate`.
 */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/**
 * A value from the URL fragment (`#email=…`), read on the client only, like useSearchParam.
 * The fragment never reaches a server, so it suits values that must stay out of request logs.
 */
export function useHashParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeHash,
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get(name),
    () => null,
  );
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}
