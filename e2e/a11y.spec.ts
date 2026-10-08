import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** WCAG 2.2 AA automated checks on the public pages, in both languages. */
const PAGES = ['/en', '/ar', '/en/courses', '/ar/courses', '/en/login', '/ar/register', '/en/privacy', '/ar/contact'];

for (const path of PAGES) {
  test(`no axe violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
    expect(summary).toEqual([]);
  });
}

test('no axe violations on a course page', async ({ page }) => {
  await page.goto('/en/courses');
  const first = page.locator('a[href*="/en/courses/"]').first();
  test.skip((await first.count()) === 0, 'no published course');
  await first.click();
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('security headers are set', async ({ request }) => {
  const res = await request.get('/en');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  const api = await request.get('/api/courses');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(api.headers()['x-request-id']).toBeTruthy();
});
