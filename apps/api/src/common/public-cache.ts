import { Inject, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, lastValueFrom, tap, type Observable } from 'rxjs';
import { ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE } from '../auth/cookies';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { AuthedRequest } from './decorators';

/**
 * Caching of the public, read-only catalog API (courses, live sessions, speakers, recordings).
 *
 * These are the most requested endpoints (every page render and every visitor of the public
 * pages) and they are the same for every anonymous visitor, so:
 *
 *   - Anonymous requests (no session cookie at all) get
 *       Cache-Control: public, s-maxage=60, stale-while-revalidate=300
 *     which lets the Cloudflare Worker keep them at the edge (deploy/cloudflare/src/edge-cache.ts),
 *     and their result is kept in this process for PUBLIC_CACHE_TTL_S (30 s), with concurrent
 *     misses for the same URL sharing one database query.
 *   - Requests with a session cookie are never cached here and are marked `private, no-cache`
 *     (some of these endpoints add the viewer's own data when signed in, e.g. an event's join link).
 *   - A response that holds a personal field (PERSONAL_KEYS) is never cached or marked public,
 *     whatever the route list says: defence in depth against a future controller change.
 *   - Any successful admin write (or internal job tick) clears the in-process cache, so admins
 *     see their edits at once; the edge copy (at most 60 s old) catches up by itself.
 */

/** Route patterns (Express `req.route.path`, with the /api prefix) whose anonymous GETs are public. */
export const PUBLIC_CACHE_ROUTES: ReadonlySet<string> = new Set([
  '/api/courses',
  '/api/courses/slugs',
  '/api/courses/:slug',
  '/api/events',
  '/api/events/:slug',
  '/api/speakers',
  '/api/speakers/:slug',
  '/api/recordings',
  '/api/recordings/search',
  '/api/settings/public',
]);

export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
export const SIGNED_IN_CACHE_CONTROL = 'private, no-cache';
/** Upper bound on cached URLs (query strings make distinct keys). Oldest go first. */
export const MAX_ENTRIES = 500;

/** Keys that only ever appear in a viewer's own data. Never cached, never public. */
export const PERSONAL_KEYS: ReadonlySet<string> = new Set(['me', 'email', 'phone', 'liveUrl', 'userId', 'passwordHash', 'googleEmail']);

const SESSION_COOKIES = [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when the request carries no session cookie of any kind (even an expired one). */
export function isAnonymous(req: Pick<Request, 'headers'> & { cookies?: Record<string, unknown> }): boolean {
  if (SESSION_COOKIES.some((c) => req.cookies?.[c] !== undefined)) return false;
  const raw = req.headers.cookie;
  if (!raw) return true;
  return !raw.split(';').some((part) => SESSION_COOKIES.includes(part.split('=')[0]!.trim()));
}

/** Whether a response body holds a personal field anywhere in its first few levels. */
export function hasPersonalFields(value: unknown, depth = 4): boolean {
  if (depth < 0 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasPersonalFields(v, depth - 1));
  if (value instanceof Date) return false;
  for (const [k, v] of Object.entries(value)) {
    if (PERSONAL_KEYS.has(k) && v !== null && v !== undefined) return true;
    if (hasPersonalFields(v, depth - 1)) return true;
  }
  return false;
}

export function routeOf(req: Pick<Request, 'baseUrl'> & { route?: { path?: unknown } }): string | null {
  return typeof req.route?.path === 'string' ? `${req.baseUrl ?? ''}${req.route.path}` : null;
}

/** Small TTL cache with single-flight: concurrent misses for one key share one promise. */
@Injectable()
export class PublicCache {
  private readonly entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  readonly ttlMs: number;
  hits = 0;
  misses = 0;

  constructor(@Inject(ENV) env: Env) {
    this.ttlMs = env.PUBLIC_CACHE_TTL_S * 1000;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The cached value for `key`, or the result of `load()` (stored when `keep` says so). */
  get(key: string, load: () => Promise<unknown>, keep: (value: unknown) => boolean, now = Date.now()): Promise<unknown> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) {
      this.hits++;
      return hit.value;
    }
    this.misses++;
    const value = load().then((v) => {
      if (!keep(v) && this.entries.get(key)?.value === value) this.entries.delete(key);
      return v;
    });
    // A failed load is never cached: the next request tries again.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    this.entries.delete(key);
    this.entries.set(key, { expires: now + this.ttlMs, value });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger('PublicCache');

  constructor(private readonly cache: PublicCache) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();

    if (MUTATING.has(req.method)) {
      // Admin edits (and the job tick, which publishes/ends things) make cached catalog reads stale.
      const admin = req.user?.role === 'ADMIN' || req.path.startsWith('/api/admin/') || req.path.startsWith('/api/internal/');
      return admin ? next.handle().pipe(tap(() => this.cache.clear())) : next.handle();
    }

    const route = routeOf(req);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !route || !PUBLIC_CACHE_ROUTES.has(route)) return next.handle();

    if (!isAnonymous(req)) {
      // Signed in: may hold the viewer's own data. Whatever the handler said, never shared.
      return next.handle().pipe(
        tap(() => {
          if (!/\b(private|no-store)\b/.test(String(res.getHeader('Cache-Control') ?? ''))) {
            res.setHeader('Cache-Control', SIGNED_IN_CACHE_CONTROL);
          }
        }),
      );
    }

    const publicOk = (value: unknown) => res.statusCode === 200 && !hasPersonalFields(value);
    const mark = (value: unknown) => {
      if (res.headersSent) return;
      if (publicOk(value)) {
        res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
      } else {
        if (res.statusCode === 200) this.logger.warn({ event: 'personal_field_in_public_route', route });
        res.setHeader('Cache-Control', 'private, no-store');
      }
    };

    if (!this.cache.enabled) return next.handle().pipe(tap(mark));
    const value = this.cache.get(req.originalUrl, () => lastValueFrom(next.handle()), publicOk);
    return from(value).pipe(tap(mark));
  }
}
