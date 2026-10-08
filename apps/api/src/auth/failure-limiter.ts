import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Counts failed attempts per key (email) in a sliding window, in memory. The
 * academy runs a single API instance; with several replicas move this to the
 * database or Redis.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  check(key: string, now = Date.now()): void {
    if (this.recent(key, now).length >= this.max) {
      throw new HttpException(
        { statusCode: 429, code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts. Try again later or reset your password.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  fail(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
    if (this.failures.size > 50_000) this.failures.delete(this.failures.keys().next().value as string);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
