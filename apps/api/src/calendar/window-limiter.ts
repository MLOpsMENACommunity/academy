/**
 * Fixed-window request counter, in memory (the API runs as one instance, like
 * the global throttler). Expired windows are pruned as the map grows.
 */
export class WindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Whether `key` has used up its window (without counting a request). */
  exhausted(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    return Boolean(w && w.resetAt > now && w.count >= this.limit);
  }

  /** Counts a request; false once the key is over the limit for this window. */
  hit(key: string, now = Date.now()): boolean {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.prune(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    // Still full of live windows (a flood of distinct keys): start over rather than grow without bound.
    if (this.windows.size >= this.maxKeys) this.windows.clear();
  }
}
