import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Env } from '../config/env';
import { PublicCache, PublicCacheInterceptor, revalidatesPublicPages } from './public-cache';
import { DEBOUNCE_MS, MIN_INTERVAL_MS, PublicRevalidator, RETRY_MS } from './revalidate';

const TOKEN = 'x'.repeat(40);
const URL_ = 'http://web.test/api/internal/revalidate';

function make(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const statuses = Array.isArray(status) ? [...status] : null;
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: statuses?.shift() ?? status });
  });
  const r = new PublicRevalidator({ REVALIDATE_URL: URL_, REVALIDATE_TOKEN: TOKEN }, fetchFn, Date.now);
  return { r, calls, fetchFn };
}

describe('PublicRevalidator', () => {
  beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => jest.useRealTimers());

  it('does nothing when not configured', async () => {
    const fetchFn = jest.fn();
    const r = new PublicRevalidator({}, fetchFn, Date.now);
    r.changed();
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 2);
    expect(r.enabled).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts the token to the site shortly after a change, then once more as a follow-up', async () => {
    const { r, calls } = make();
    r.changed();
    expect(calls).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL_);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['x-revalidate-token']).toBe(TOKEN);
    // The follow-up catches a re-render that was under way during the edit; then nothing.
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 5);
    expect(calls).toHaveLength(2);
  });

  it('coalesces a burst of changes into one call, and never drops the last change', async () => {
    const { r, calls } = make();
    for (let i = 0; i < 50; i++) r.changed();
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    // A change after the call: owed a second call, no sooner than MIN_INTERVAL_MS after the first.
    r.changed();
    r.changed();
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 10);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(2);
    // Then one follow-up after the last call, and quiet afterwards.
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(calls).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 5);
    expect(calls).toHaveLength(3);
  });

  it('retries a failed call once, and never throws', async () => {
    const { r, calls } = make(503);
    r.changed();
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(RETRY_MS);
    expect(calls).toHaveLength(2);
    // The follow-up (and its own retry), then nothing more.
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 10);
    expect(calls).toHaveLength(4);
  });

  it('survives a network error', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const r = new PublicRevalidator({ REVALIDATE_URL: URL_, REVALIDATE_TOKEN: TOKEN }, fetchFn, Date.now);
    r.changed();
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + RETRY_MS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 10);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe('which writes revalidate the public pages', () => {
  const w = (method: string, path: string, role?: string) => revalidatesPublicPages({ method, path, user: role ? { role } : null });
  it('every admin write, and the speaker writes that change public content', () => {
    expect(w('PUT', '/api/admin/courses/c1')).toBe(true);
    expect(w('PATCH', '/api/admin/media/instructors/i1')).toBe(true);
    expect(w('PUT', '/api/admin/settings')).toBe(true);
    expect(w('POST', '/api/anything', 'ADMIN')).toBe(true);
    expect(w('PUT', '/api/speaker/courses/c1/sessions/s1/materials', 'SPEAKER')).toBe(true);
    expect(w('PUT', '/api/speaker/application', 'SPEAKER')).toBe(true);
    expect(w('DELETE', '/api/speaker/slots/s1/booking', 'SPEAKER')).toBe(true);
    expect(w('POST', '/api/me/delete', 'STUDENT')).toBe(true);
    // Course staff (any account role) changing what the public course page shows.
    expect(w('PUT', '/api/teach/courses/c1/sessions/s1/materials', 'STUDENT')).toBe(true);
    expect(w('PUT', '/api/teach/courses/c1/details', 'STUDENT')).toBe(true);
    expect(w('POST', '/api/teach/courses/c1/sessions', 'SPEAKER')).toBe(true);
    expect(w('PUT', '/api/teach/courses/c1/sessions/order', 'SPEAKER')).toBe(true);
    expect(w('DELETE', '/api/teach/courses/c1/sessions/s1', 'SPEAKER')).toBe(true);
    // Not grading, attendance or points.
    expect(w('PUT', '/api/teach/courses/c1/submissions/x/grade', 'STUDENT')).toBe(false);
    expect(w('POST', '/api/teach/courses/c1/sessions/s1/attendance', 'STUDENT')).toBe(false);
  });
  it('not reads, student writes, seat counts or the hourly job tick', () => {
    expect(w('GET', '/api/admin/courses')).toBe(false);
    expect(w('POST', '/api/events/x/registration', 'STUDENT')).toBe(false);
    expect(w('POST', '/api/courses/x/apply', 'STUDENT')).toBe(false);
    expect(w('PUT', '/api/me/profile/basics', 'STUDENT')).toBe(false);
    expect(w('POST', '/api/internal/jobs/tick')).toBe(false);
  });
});

describe('PublicCacheInterceptor and the revalidator', () => {
  function context(method: string, path: string, role?: string) {
    const req = { method, path, originalUrl: path, baseUrl: '', headers: {}, user: role ? { role } : undefined };
    const res = { statusCode: 200, headersSent: false, getHeader: () => undefined, setHeader: () => undefined };
    return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  }
  const ok: CallHandler = { handle: () => of({ ok: true }) };

  it('clears the cache, then asks for a revalidation, after an admin write', async () => {
    const cache = new PublicCache({ PUBLIC_CACHE_TTL_S: 30 } as Env);
    const order: string[] = [];
    jest.spyOn(cache, 'clear').mockImplementation(() => void order.push('clear'));
    const revalidator = { changed: jest.fn(() => void order.push('revalidate')) } as unknown as PublicRevalidator;
    const icpt = new PublicCacheInterceptor(cache, revalidator);
    await lastValueFrom(icpt.intercept(context('PUT', '/api/admin/courses/c1', 'ADMIN'), ok));
    expect(order).toEqual(['clear', 'revalidate']);
  });

  it('a seat-count write clears the cache without revalidating every page', async () => {
    const cache = new PublicCache({ PUBLIC_CACHE_TTL_S: 30 } as Env);
    const revalidator = { changed: jest.fn() } as unknown as PublicRevalidator;
    const icpt = new PublicCacheInterceptor(cache, revalidator);
    await cache.get('/api/events', async () => [], () => true);
    await lastValueFrom(icpt.intercept(context('POST', '/api/events/x/registration', 'STUDENT'), ok));
    expect(cache.size).toBe(0);
    expect(revalidator.changed).not.toHaveBeenCalled();
  });
});
