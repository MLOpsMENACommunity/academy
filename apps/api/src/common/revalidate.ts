import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * Tells the public site that public data changed, so an admin edit shows within seconds
 * instead of after every cache layer's own lifetime (see DEPLOY.md, "How fast an edit shows").
 *
 * The API's own in-process cache is cleared by PublicCacheInterceptor; this asks the site to
 * drop its copies too: POST REVALIDATE_URL with the shared REVALIDATE_TOKEN.
 *   - On Cloudflare, REVALIDATE_URL is the Worker's /_internal/revalidate: it revalidates every
 *     running web container (Next's page and data caches) and purges the edge cache.
 *   - Locally (docker compose), it is the web app's own /api/internal/revalidate.
 *
 * Calls are coalesced: changes within DEBOUNCE_MS make one call, and calls are at least
 * MIN_INTERVAL_MS apart (a bulk edit is one revalidation, not hundreds); a change that comes
 * in while a call is in flight gets a call of its own afterwards, so the last edit is never
 * missed. One follow-up call MIN_INTERVAL_MS after the last one catches a page whose
 * re-render was already under way when the edit landed (it could otherwise store the old
 * data as fresh). A failed call is retried once; if that fails too the pages still catch up
 * through their time-based revalidation (60 s). Never throws, never delays the admin's request.
 */
export const DEBOUNCE_MS = 300;
export const MIN_INTERVAL_MS = 5_000;
export const RETRY_MS = 5_000;
export const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

@Injectable()
export class PublicRevalidator implements OnModuleDestroy {
  private readonly logger = new Logger('Revalidate');
  private readonly url?: string;
  private readonly token?: string;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  /** A change arrived after the last call started: another call is owed. */
  private pending = false;
  private lastSent = 0;
  /** Calls made (for tests and logs). */
  sent = 0;

  constructor(
    @Inject(ENV) env: Pick<Env, 'REVALIDATE_URL' | 'REVALIDATE_TOKEN'>,
    @Optional() private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
    @Optional() private readonly now: () => number = Date.now,
  ) {
    this.url = env.REVALIDATE_URL;
    this.token = env.REVALIDATE_TOKEN;
  }

  get enabled(): boolean {
    return Boolean(this.url && this.token);
  }

  /** Public data changed: revalidate soon. Cheap to call on every write. */
  changed(): void {
    if (!this.enabled) return;
    this.pending = true;
    if (this.timer || this.inFlight) return;
    this.schedule();
  }

  private schedule(followUp = false): void {
    const wait = Math.max(DEBOUNCE_MS, this.lastSent + MIN_INTERVAL_MS - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      // A change since the follow-up was planned makes it a regular call (with its own follow-up).
      const isFollowUp = followUp && !this.pending;
      this.pending = false;
      this.inFlight = this.send().finally(() => {
        this.inFlight = null;
        if (this.pending) this.schedule();
        else if (!isFollowUp) this.schedule(true);
      });
    }, wait);
    this.timer.unref?.();
  }

  private async send(): Promise<void> {
    this.lastSent = this.now();
    this.sent++;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.fetchFn(this.url!, {
          method: 'POST',
          headers: { 'x-revalidate-token': this.token!, 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          this.logger.log({ event: 'revalidated', detail: (await res.text()).slice(0, 300) });
          return;
        }
        this.logger.warn({ event: 'revalidate_failed', status: res.status, attempt });
      } catch (err) {
        this.logger.warn({ event: 'revalidate_failed', error: (err as Error).name, attempt });
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, RETRY_MS).unref?.());
    }
  }

  /** Waits for a scheduled or running call (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.timer || this.inFlight) {
      if (this.inFlight) await this.inFlight;
      else await new Promise((r) => setTimeout(r, 20));
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
