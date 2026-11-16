import { afterEach, describe, expect, it, vi } from 'vitest';

/** robots.ts reads the environment when it loads: import it fresh for each one. */
async function load(environment: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ACADEMY_ENVIRONMENT', environment);
  return import('./robots');
}

describe('robots.txt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('in production, keeps SEO-tool crawlers out of the whole site', async () => {
    const { default: robots, BLOCKED_CRAWLERS } = await load('production');
    const rules = [robots().rules].flat();
    expect(rules).toContainEqual({ userAgent: BLOCKED_CRAWLERS, disallow: '/' });
    // Everyone else still crawls the public pages.
    expect(rules.find((r) => r.userAgent === '*')?.allow).toBe('/');
  });

  it('never blocks search engines or AI assistants', async () => {
    const { BLOCKED_CRAWLERS } = await load('production');
    const blocked = BLOCKED_CRAWLERS.map((b) => b.toLowerCase());
    for (const ua of ['Googlebot', 'bingbot', 'ChatGPT-User', 'GPTBot', 'ClaudeBot', 'Amazonbot']) expect(blocked).not.toContain(ua.toLowerCase());
  });

  it('outside production, still disallows everything for everyone', async () => {
    const { default: robots } = await load('staging');
    expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });
});
