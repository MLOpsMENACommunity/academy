import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { finalize, tap, type Observable } from 'rxjs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * A few seconds' memory of the database reads every signed-in click repeats: the account's
 * role, admin presets and token version (AuthGuard) and a course by its address (the learn
 * page's three calls each look it up). Each one is a round trip to the database, and a learn
 * page used to make about ten of them before doing any real work.
 *
 * Safe because it is short and every change empties it:
 *   - Only reads use it (GET and HEAD). A write always reads the database, so a revoked
 *     session, a deleted account or a removed admin can't change anything once that commits.
 *   - Any write request (and the Google sign-in callback, the one GET that can end sessions)
 *     clears all of it when the handler finishes, i.e. after its transaction committed, and
 *     before the response goes out. So does every scheduled job run.
 *   - A load that started before a clear is never stored after it (the entry holds the
 *     promise from the start, and clear() drops it).
 * A change made outside this process (a script, psql) shows within SIGNED_IN_CACHE_TTL_S.
 * One API container (see DEPLOY.md): a second one would not see the first one's clears and
 * would also lag by up to the TTL.
 */
@Injectable()
export class SignedInCache {
  private readonly entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  readonly ttlMs: number;

  constructor(@Inject(ENV) env: Pick<Env, 'SIGNED_IN_CACHE_TTL_S'>) {
    this.ttlMs = env.SIGNED_IN_CACHE_TTL_S * 1000;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The cached value for `key`, or `load()` (shared by concurrent misses). Off when the TTL is 0. */
  get<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value as Promise<T>;
    const value = load();
    // A failed load is never kept: the next request tries again.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    this.entries.delete(key);
    this.entries.set(key, { expires: now + this.ttlMs, value });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The key for a whole Course row by its address: the same row wherever it's read. Never mutate the cached row. */
export const courseKey = (slug: string): string => `course:${slug}`;

/** Upper bound on cached keys (accounts and courses). Oldest go first. */
export const MAX_ENTRIES = 5000;

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** GETs that write what SignedInCache holds: Google sign-in can claim an account and end its sessions. */
const WRITING_GETS = new Set(['/api/auth/google/callback']);

/** Whether a request may change what SignedInCache holds (so it clears it when done). */
export function clearsSignedInCache(req: Pick<Request, 'method' | 'path'>): boolean {
  return !READS.has(req.method) || WRITING_GETS.has(req.path);
}

/** Empties SignedInCache after every request that can write, once its handler finished. */
@Injectable()
export class SignedInCacheInterceptor implements NestInterceptor {
  constructor(private readonly cache: SignedInCache) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http' || !clearsSignedInCache(ctx.switchToHttp().getRequest<Request>())) return next.handle();
    const clear = () => this.cache.clear();
    // On the value (before Nest sends the response), on an error, and on any other ending.
    return next.handle().pipe(tap({ next: clear, error: clear }), finalize(clear));
  }
}
