import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { Env } from '../config/env';
import {
  hasPersonalFields,
  isAnonymous,
  MAX_ENTRIES,
  PUBLIC_CACHE_CONTROL,
  PublicCache,
  PublicCacheInterceptor,
  SIGNED_IN_CACHE_CONTROL,
} from './public-cache';

const cacheWith = (ttlS = 30) => new PublicCache({ PUBLIC_CACHE_TTL_S: ttlS } as Env);

describe('isAnonymous', () => {
  const req = (cookie?: string, cookies?: Record<string, string>) => ({ headers: cookie ? { cookie } : {}, cookies });
  it('is true without any session cookie', () => {
    expect(isAnonymous(req())).toBe(true);
    expect(isAnonymous(req('NEXT_LOCALE=ar; _ga=GA1'))).toBe(true);
  });
  it('is false with any session cookie, valid or not', () => {
    for (const c of ['access_token=x', 'has_session=1791556000', 'refresh_token=y', 'NEXT_LOCALE=en; has_session=1']) {
      expect(isAnonymous(req(c))).toBe(false);
    }
    expect(isAnonymous(req(undefined, { access_token: 'x' }))).toBe(false);
  });
});

describe('hasPersonalFields', () => {
  it('finds viewer data at any reasonable depth', () => {
    expect(hasPersonalFields({ slug: 'x', me: { registered: true } })).toBe(true);
    expect(hasPersonalFields({ upcoming: [{ slug: 'x', me: { liveUrl: null } }] })).toBe(true);
    expect(hasPersonalFields([{ instructor: { email: 'a@b.c' } }])).toBe(true);
  });
  it('ignores public data and empty personal keys', () => {
    expect(hasPersonalFields({ slug: 'x', titleEn: 'T', startsAt: new Date(), me: undefined })).toBe(false);
    expect(hasPersonalFields({ supportEmail: 's@x.y', recordingUrl: 'https://y' })).toBe(false);
    expect(hasPersonalFields(null)).toBe(false);
  });
});

describe('PublicCache', () => {
  it('serves hits within the TTL and shares one load between concurrent misses', async () => {
    const cache = cacheWith(30);
    const load = jest.fn(async () => ({ n: 1 }));
    const [a, b] = await Promise.all([cache.get('/api/courses', load, () => true, 0), cache.get('/api/courses', load, () => true, 1)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await cache.get('/api/courses', load, () => true, 29_000);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get('/api/courses', load, () => true, 31_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never keeps failures or values `keep` refuses', async () => {
    const cache = cacheWith(30);
    await expect(cache.get('k', () => Promise.reject(new Error('db')), () => true)).rejects.toThrow('db');
    await new Promise((r) => setImmediate(r));
    expect(cache.size).toBe(0);
    await cache.get('p', async () => ({ me: {} }), () => false);
    expect(cache.size).toBe(0);
  });

  it('is bounded, and clear() empties it', async () => {
    const cache = cacheWith(30);
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cache.get(`/api/recordings?q=${i}`, async () => i, () => true);
    expect(cache.size).toBe(MAX_ENTRIES);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('PublicCacheInterceptor', () => {
  function context(opts: { method?: string; route?: string; path?: string; cookie?: string; role?: string; header?: string; status?: number }) {
    const headers: Record<string, string> = {};
    if (opts.header) headers['Cache-Control'] = opts.header;
    const res = {
      statusCode: opts.status ?? 200,
      headersSent: false,
      getHeader: (k: string) => headers[k],
      setHeader: (k: string, v: string) => (headers[k] = v),
    };
    const req = {
      method: opts.method ?? 'GET',
      path: opts.path ?? opts.route ?? '/api/courses',
      originalUrl: opts.path ?? opts.route ?? '/api/courses',
      baseUrl: '',
      route: opts.route ? { path: opts.route } : undefined,
      headers: opts.cookie ? { cookie: opts.cookie } : {},
      cookies: {},
      user: opts.role ? { id: 'u', role: opts.role } : undefined,
    };
    const ctx = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
    return { ctx, headers };
  }
  const handler = (value: unknown, calls = { n: 0 }): CallHandler & { calls: { n: number } } => ({
    calls,
    handle: () => {
      calls.n++;
      return of(value);
    },
  });

  it('marks anonymous public reads shared-cacheable and caches them', async () => {
    const cache = cacheWith(30);
    const icpt = new PublicCacheInterceptor(cache);
    const h = handler([{ slug: 'x' }]);
    for (let i = 0; i < 3; i++) {
      const { ctx, headers } = context({ route: '/api/courses' });
      await lastValueFrom(icpt.intercept(ctx, h));
      expect(headers['Cache-Control']).toBe(PUBLIC_CACHE_CONTROL);
    }
    expect(h.calls.n).toBe(1);
  });

  it('never shares or caches signed-in reads, and keeps a handler’s private header', async () => {
    const cache = cacheWith(30);
    const icpt = new PublicCacheInterceptor(cache);
    const h = handler({ slug: 'x' });
    const a = context({ route: '/api/courses/:slug', path: '/api/courses/x', cookie: 'has_session=1', header: 'public, max-age=60' });
    await lastValueFrom(icpt.intercept(a.ctx, h));
    expect(a.headers['Cache-Control']).toBe(SIGNED_IN_CACHE_CONTROL);
    const b = context({ route: '/api/events/:slug', path: '/api/events/x', cookie: 'access_token=t', header: 'private, no-store' });
    await lastValueFrom(icpt.intercept(b.ctx, handler({ me: { registered: true } })));
    expect(b.headers['Cache-Control']).toBe('private, no-store');
    expect(cache.size).toBe(0);
  });

  it('refuses to make a personal answer public even on a public route', async () => {
    const icpt = new PublicCacheInterceptor(cacheWith(30));
    const { ctx, headers } = context({ route: '/api/events/:slug', path: '/api/events/x' });
    await lastValueFrom(icpt.intercept(ctx, handler({ slug: 'x', me: { registered: true, liveUrl: 'https://secret' } })));
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('leaves other routes alone', async () => {
    const cache = cacheWith(30);
    const icpt = new PublicCacheInterceptor(cache);
    const { ctx, headers } = context({ route: '/api/notifications/unread-count' });
    await lastValueFrom(icpt.intercept(ctx, handler({ unread: 1 })));
    expect(headers['Cache-Control']).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('clears the cache after a successful admin write, not after a failed one or a student write', async () => {
    const cache = cacheWith(30);
    const icpt = new PublicCacheInterceptor(cache);
    const fill = () => cache.get('/api/courses', async () => [], () => true);
    await fill();
    await lastValueFrom(icpt.intercept(context({ method: 'POST', path: '/api/courses/x/interest', role: 'STUDENT' }).ctx, handler({ ok: true })));
    expect(cache.size).toBe(1);
    const failing: CallHandler = { handle: () => throwError(() => new Error('nope')) };
    await expect(lastValueFrom(icpt.intercept(context({ method: 'PUT', path: '/api/admin/courses/1', role: 'ADMIN' }).ctx, failing))).rejects.toThrow();
    expect(cache.size).toBe(1);
    await lastValueFrom(icpt.intercept(context({ method: 'PUT', path: '/api/admin/courses/1', role: 'ADMIN' }).ctx, handler({ ok: true })));
    expect(cache.size).toBe(0);
  });

  it('with the cache off, still sets the headers but always calls the handler', async () => {
    const icpt = new PublicCacheInterceptor(cacheWith(0));
    const h = handler([]);
    for (let i = 0; i < 2; i++) {
      const { ctx, headers } = context({ route: '/api/events' });
      await lastValueFrom(icpt.intercept(ctx, h));
      expect(headers['Cache-Control']).toBe(PUBLIC_CACHE_CONTROL);
    }
    expect(h.calls.n).toBe(2);
  });
});
