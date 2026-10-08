'use client';

import type { ClientFunnelEvent } from '@academy/shared';

/** Random per-browser id so anonymous funnel steps can be counted once. Not a cookie. */
function anonymousId(): string | undefined {
  try {
    let id = localStorage.getItem('academy_aid');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('academy_aid', id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function trackFunnel(courseSlug: string, event: ClientFunnelEvent['event']): void {
  const body = JSON.stringify({ courseSlug, event, anonymousId: anonymousId() });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/funnel/events', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // fall through
  }
  void fetch('/api/funnel/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(
    () => undefined,
  );
}

export function courseSlugFromPath(path: string | null | undefined): string | null {
  return path?.match(/^\/(?:en|ar)\/courses\/([a-z0-9-]+)/)?.[1] ?? null;
}
