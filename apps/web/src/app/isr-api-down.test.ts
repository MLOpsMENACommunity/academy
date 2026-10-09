import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real module refuses to load outside a React Server Components bundle.
vi.mock('server-only', () => ({}));

/**
 * ISR pages must fail, not degrade, when the API is down: a thrown render keeps Next's
 * last good copy (or gives an uncached 500), while an empty 200 ("0 courses") would be
 * cached by Next for the revalidate window and by Cloudflare's edge.
 */
const pages: [string, () => Promise<{ default: (p: { params: Promise<{ locale: string }> }) => Promise<unknown> }>][] = [
  ['home', () => import('./[locale]/page')],
  ['catalog', () => import('./[locale]/courses/page')],
  ['live sessions', () => import('./[locale]/sessions/page')],
  ['recordings', () => import('./[locale]/sessions/recordings/page')],
  ['login', () => import('./[locale]/(auth)/login/page')],
  ['register', () => import('./[locale]/(auth)/register/page')],
  ['contact (policy pages)', () => import('./[locale]/contact/page')],
];

describe('ISR pages when the API is unreachable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const [name, load] of pages) {
    it(`${name}: throws on a network error instead of rendering an empty page`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
      const { default: Page } = await load();
      await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow();
    });

    it(`${name}: throws on an API 5xx/503 too`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 503 })));
      const { default: Page } = await load();
      await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow();
    });
  }
});
