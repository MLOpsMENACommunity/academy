import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { clearsSignedInCache, SignedInCache, SignedInCacheInterceptor } from './signed-in-cache';

const cacheWith = (ttlS = 15) => new SignedInCache({ SIGNED_IN_CACHE_TTL_S: ttlS });

describe('SignedInCache', () => {
  it('reuses a value until it expires, and shares one load between concurrent misses', async () => {
    const cache = cacheWith();
    const load = jest.fn().mockResolvedValue('v');
    await Promise.all([cache.get('k', load, 0), cache.get('k', load, 0)]);
    await cache.get('k', load, 14_999);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get('k', load, 15_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is off with a TTL of 0', async () => {
    const cache = cacheWith(0);
    const load = jest.fn().mockResolvedValue('v');
    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('never keeps a failed load', async () => {
    const cache = cacheWith();
    await expect(cache.get('k', () => Promise.reject(new Error('db')))).rejects.toThrow('db');
    expect(await cache.get('k', () => Promise.resolve('ok'))).toBe('ok');
  });

  it('never stores a load that was in flight when the cache was cleared', async () => {
    const cache = cacheWith();
    let finish!: (v: string) => void;
    const slow = cache.get('k', () => new Promise<string>((r) => (finish = r)));
    cache.clear();
    finish('old');
    expect(await slow).toBe('old');
    expect(await cache.get('k', () => Promise.resolve('new'))).toBe('new');
  });
});

describe('SignedInCacheInterceptor', () => {
  const ctx = (method: string, path: string) =>
    ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, path }) }) }) as unknown as ExecutionContext;
  const filled = () => {
    const cache = cacheWith();
    void cache.get('k', () => Promise.resolve(1));
    return cache;
  };

  it('knows which requests can write', () => {
    expect(clearsSignedInCache({ method: 'GET', path: '/api/learn/x' })).toBe(false);
    expect(clearsSignedInCache({ method: 'HEAD', path: '/api/learn/x' })).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(clearsSignedInCache({ method, path: '/api/learn/x' })).toBe(true);
    expect(clearsSignedInCache({ method: 'GET', path: '/api/auth/google/callback' })).toBe(true);
    expect(clearsSignedInCache({ method: 'GET', path: '/api/auth/Google/callback/' })).toBe(true);
  });

  it('leaves the cache alone on reads', async () => {
    const cache = filled();
    await lastValueFrom(new SignedInCacheInterceptor(cache).intercept(ctx('GET', '/api/learn/x'), { handle: () => of('ok') } as CallHandler));
    expect(cache.size).toBe(1);
  });

  it('empties it after a write, before the response goes out, and after a failed one', async () => {
    const cache = filled();
    const seen: number[] = [];
    const handler = { handle: () => of('ok') } as CallHandler;
    const out = new SignedInCacheInterceptor(cache).intercept(ctx('POST', '/api/x'), handler);
    await new Promise<void>((done) => out.subscribe({ next: () => seen.push(cache.size), complete: done }));
    expect(seen).toEqual([0]);

    const again = filled();
    const failing = { handle: () => throwError(() => new Error('no')) } as CallHandler;
    await expect(lastValueFrom(new SignedInCacheInterceptor(again).intercept(ctx('PUT', '/api/x'), failing))).rejects.toThrow('no');
    expect(again.size).toBe(0);
  });
});
