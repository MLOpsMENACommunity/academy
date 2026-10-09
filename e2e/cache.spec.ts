import { expect, test } from '@playwright/test';
import { JSON_HEADERS } from './support';

/**
 * Public pages are static (ISR) and Cloudflare caches their HTML for anonymous visitors,
 * so the HTML must be the same for everyone: personal state (who is signed in, my
 * application status, Notify me) is loaded by client components after the page.
 */
test('a cached course page carries no personal data; the signed-in header loads after', async ({ browser }) => {
  const stamp = Date.now();
  const email = `cache.${stamp}@example.com`;

  // A signed-in student.
  const student = await browser.newContext();
  const reg = await student.request.post('/api/auth/register', {
    headers: JSON_HEADERS,
    data: { email, password: 'Cache-Test-2026!', locale: 'en' },
  });
  expect(reg.status(), 'register').toBeLessThan(300);
  const page = await student.newPage();

  await page.goto('/en/courses');
  const first = page.locator('main a[href^="/en/courses/"]').first();
  test.skip((await first.count()) === 0, 'no published course');
  const path = (await first.getAttribute('href'))!;

  // The student's view: their account in the header, once loaded.
  await page.goto(path);
  const menu = page.getByRole('button', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('menu')).toContainText(email);

  // The HTML the server sends, even to the signed-in student, is not personalised.
  const own = await student.request.get(path);
  expect(own.status()).toBe(200);
  expect(await own.text()).not.toContain(email);

  // An anonymous visitor gets a shared-cacheable page with nothing of the student's in it.
  const anon = await browser.newContext();
  const res = await anon.request.get(path);
  expect(res.status()).toBe(200);
  const cc = res.headers()['cache-control'] ?? '';
  expect(cc).toContain('s-maxage');
  expect(cc).not.toMatch(/private|no-store/);
  expect(await res.text()).not.toContain(email);

  const visitor = await anon.newPage();
  await visitor.goto(path);
  await expect(visitor.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(visitor.getByText(email)).toHaveCount(0);

  await student.close();
  await anon.close();
});

test('catalog filters run in the browser on the static catalog', async ({ page }) => {
  await page.goto('/en/courses');
  const cards = page.locator('main ul > li');
  const status = page.locator('main').getByRole('status');
  const total = await cards.count();
  await expect(status).toHaveText(`${total} courses`);

  await page.getByLabel('Price').selectOption('FREE');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/\/en\/courses\?type=FREE$/);
  const shown = await cards.count();
  await expect(status).toHaveText(`${shown} courses`);
  expect(shown).toBeLessThanOrEqual(total);

  // The back button restores the full list, and a filtered link applies on load.
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/courses$/);
  await expect(status).toHaveText(`${total} courses`);
  await page.goto('/en/courses?type=FREE');
  await expect(status).toHaveText(`${shown} courses`);
});

test('recordings search asks the API from the static page', async ({ page }) => {
  await page.goto('/en/sessions/recordings?q=zz-no-such-recording-zz');
  await expect(page.getByRole('heading', { name: 'No recordings match' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('zz-no-such-recording-zz');
});

test("the waiting list's joined state loads after the page and is never in its HTML", async ({ browser }) => {
  const email = `cache.wl.${Date.now()}@example.com`;
  const student = await browser.newContext();
  const courses = (await (await student.request.get('/api/courses')).json()) as { slug: string; availability: string }[];
  const course = courses.find((c) => c.availability !== 'OPEN');
  test.skip(!course, 'no public course that is closed or coming soon');
  const path = `/en/courses/${course!.slug}`;
  const reg = await student.request.post('/api/auth/register', {
    headers: JSON_HEADERS,
    data: { email, password: 'Cache-Test-2026!', locale: 'en' },
  });
  expect(reg.status(), 'register').toBeLessThan(300);

  // Signed in: one click joins, and the joined state comes back on the next visit (from my-status).
  const page = await student.newPage();
  await page.goto(path);
  const side = page.locator('aside');
  await side.getByRole('button', { name: 'Notify me when it opens' }).click();
  await expect(side.getByText("You're on the waiting list")).toBeVisible();
  await page.reload();
  await expect(side.getByText("You're on the waiting list")).toBeVisible();

  // The HTML (the student's own request, and an anonymous one) carries neither.
  const own = await (await student.request.get(path)).text();
  expect(own).not.toContain("You're on the waiting list");
  expect(own).not.toContain(email);
  const anon = await browser.newContext();
  const res = await anon.request.get(path);
  expect(res.headers()['cache-control'] ?? '').toContain('s-maxage');
  const html = await res.text();
  expect(html).not.toContain("You're on the waiting list");
  expect(html).not.toContain(email);
  const visitor = await anon.newPage();
  await visitor.goto(path);
  await expect(visitor.locator('aside').getByRole('button', { name: 'Notify me when it opens' }).or(visitor.locator('aside').getByRole('textbox')).first()).toBeVisible();
  await expect(visitor.getByText("You're on the waiting list")).toHaveCount(0);

  await student.close();
  await anon.close();
});
