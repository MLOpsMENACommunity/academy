import { expect, test } from '@playwright/test';
import { ADMIN, apiLogin, JSON_HEADERS, uiLogin } from './support';

/**
 * An admin edit is on the public pages within the freshness guarantee (DEPLOY.md, "How fast
 * an admin edit shows"): the API asks the web app to revalidate right after the save, so the
 * cached course page and home page re-render with the new values. Locally there is no edge
 * cache, so this checks the web app's part, which takes about a second; the guarantee is 30 s.
 */
const GUARANTEE_MS = 30_000;

test('an admin edit of hours per week and the application deadline shows on the course page and the home page', async ({ browser, page }) => {
  const anon = await browser.newContext();
  const courses = (await (await anon.request.get('/api/courses')).json()) as { id: string; slug: string; availability: string; completed: boolean }[];
  // An open course on the home page (its card shows "Apply by <deadline>").
  const home = await (await anon.request.get('/en')).text();
  const course = courses.find((c) => c.availability === 'OPEN' && !c.completed && home.includes(`/en/courses/${c.slug}"`));
  test.skip(!course, 'no open course on the home page');
  const path = `/en/courses/${course!.slug}`;

  const admin = await browser.newContext();
  await apiLogin(admin.request, ADMIN.email, ADMIN.password);
  const original = await (await admin.request.get(`/api/admin/courses/${course!.id}`)).json();

  // New values that can't be on the page already: a deadline 40–70 days out, at 23:59 in the
  // browser's timezone (Africa/Cairo, as the admin's), and an unusual weekly load.
  const day = new Date(Date.now() + (40 + Math.floor(Math.random() * 30)) * 86_400_000);
  const ymd = day.toISOString().slice(0, 10);
  const hours = 41 + Math.floor(Math.random() * 19);
  const dateText = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));

  try {
    // Warm the cache: both pages are rendered and cached with the old values.
    for (const p of [path, '/en']) expect((await anon.request.get(p)).status()).toBe(200);
    expect(await (await anon.request.get(path)).text()).not.toContain(`${hours} hours/week`);

    // The admin edits the course in the admin panel.
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto(`/en/admin/courses/${course!.id}`);
    await page.getByLabel('Hours per week').fill(String(hours));
    await page.getByLabel('Application deadline').fill(`${ymd}T23:59`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('✓ Saved')).toBeVisible();
    const savedAt = Date.now();

    // Stored as entered, in the admin's timezone (23:59 Cairo time is before midnight UTC).
    const saved = await (await admin.request.get(`/api/admin/courses/${course!.id}`)).json();
    expect(saved.hoursPerWeek).toBe(hours);
    expect(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(saved.applicationDeadline))).toBe(`${dateText}, 23:59`);

    // An anonymous visitor sees both on the course page, and the deadline on the home page's card.
    await expect
      .poll(async () => {
        const html = await (await anon.request.get(path)).text();
        return html.includes(`${hours} hours/week`) && html.includes(`${dateText}, 23:59`);
      }, { timeout: GUARANTEE_MS, intervals: [250, 500, 1000] })
      .toBe(true);
    await expect
      .poll(async () => (await (await anon.request.get('/en')).text()).includes(`Apply by ${dateText}`), { timeout: GUARANTEE_MS, intervals: [250, 500, 1000] })
      .toBe(true);
    test.info().annotations.push({ type: 'freshness', description: `visible ${((Date.now() - savedAt) / 1000).toFixed(1)} s after saving` });

    // And in a real browser, without a session.
    const visitor = await anon.newPage();
    await visitor.goto(path);
    await expect(visitor.getByText(`${hours} hours/week`).first()).toBeVisible();
  } finally {
    const { id: _id, questions: _q, sessions: _s, instructors: _i, createdAt: _c, updatedAt: _u, archivedAt: _a, ...rest } = original;
    await admin.request.put(`/api/admin/courses/${course!.id}`, { headers: JSON_HEADERS, data: rest });
    await admin.close();
    await anon.close();
  }
});
