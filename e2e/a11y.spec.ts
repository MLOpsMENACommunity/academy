import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** WCAG 2.2 AA automated checks on the public pages, in both languages. */
const PAGES = ['/en', '/ar', '/en/courses', '/ar/courses', '/en/sessions', '/ar/sessions', '/en/login', '/ar/register', '/en/privacy', '/ar/contact', '/en/learning-paths', '/ar/learning-paths/mlops-engineer', '/en/roadmaps', '/ar/roadmaps', '/en/roadmaps/basic-mlops-engineer', '/ar/roadmaps/devops-to-mlops', '/en/speakers', '/ar/whats-new'];

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

test('live sessions pages render in both languages', async ({ page }) => {
  await page.goto('/en/sessions');
  await expect(page.getByRole('heading', { level: 1, name: 'Live sessions' })).toBeVisible();
  await page.goto('/ar/sessions');
  await expect(page.getByRole('heading', { level: 1, name: 'الجلسات المباشرة' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const first = page.locator('a[href*="/ar/sessions/"]').first();
  test.skip((await first.count()) === 0, 'no published session');
  await first.click();
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('the header menus open with the keyboard, pass axe and close on Escape', async ({ page }) => {
  await page.goto('/en');
  const learn = page.getByRole('button', { name: 'Learn' });
  await learn.focus();
  await page.keyboard.press('Enter');
  await expect(learn).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('region', { name: 'Learn' });
  await expect(panel.getByRole('link', { name: /MLOps MENA learning paths/ }).first()).toBeVisible();
  await expect(panel.getByRole('link', { name: /Open-source roadmaps/ }).first()).toBeVisible();
  await expect(panel.getByRole('link', { name: /Basic MLOps Engineer Roadmap/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(learn).toHaveAttribute('aria-expanded', 'false');
  await expect(learn).toBeFocused();
});

test('the phone drawer is a dialog that traps focus, in Arabic too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ar');
  const open = page.getByRole('button', { name: 'القائمة' });
  await open.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'إغلاق القائمة' })).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('an open-source roadmap: Arabic chrome, English body read left to right', async ({ page }) => {
  await page.goto('/ar/roadmaps/basic-mlops-engineer');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'خريطة مهندس MLOps المبتدئ' })).toBeVisible();
  const body = page.locator('article[dir="ltr"][lang="en"]');
  await expect(body.getByRole('heading', { level: 2, name: /Phase 0/ })).toBeVisible();
  const external = body.locator('a[href^="https://"]').first();
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mlopsmena.com/ar/roadmaps/basic-mlops-engineer/');
  expect((await page.request.get('/en/roadmaps/not-a-roadmap')).status()).toBe(404);
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
