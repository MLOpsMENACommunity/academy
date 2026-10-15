import { expect, test } from '@playwright/test';
import { JSON_HEADERS } from './support';

/** Regressions from the accounts / public site audit (October 2026). */

test('login and forgot-password check the address in the page language, never "Validation failed" (ACC-02)', async ({ page }) => {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill('not-an-email');
  await page.getByLabel('كلمة المرور').fill('whatever-password');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(page.getByText('أدخل بريدًا إلكترونيًا صحيحًا.')).toBeVisible();
  await expect(page.getByText('Validation failed')).toHaveCount(0);

  await page.goto('/ar/forgot-password');
  await page.getByLabel('البريد الإلكتروني').fill('still not an email');
  await page.getByRole('button', { name: /رابط/ }).click();
  await expect(page.getByText('أدخل بريدًا إلكترونيًا صحيحًا.')).toBeVisible();
  await expect(page.getByText('Validation failed')).toHaveCount(0);
});

test('a short new password gets a translated message on its field (ACC-02)', async ({ page }) => {
  const email = `audit-pw-${Date.now()}@example.test`;
  const res = await page.request.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password: 'Audit-Passw0rd-1', locale: 'ar' } });
  expect(res.ok()).toBe(true);
  await page.goto('/ar/profile?tab=account');
  await page.getByLabel('كلمة المرور الحالية').first().fill('Audit-Passw0rd-1');
  await page.getByLabel('كلمة المرور الجديدة').fill('short');
  await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
  await expect(page.getByText('يجب ألا يقل عن 10 أحرف.')).toBeVisible();
  await expect(page.getByText('Validation failed')).toHaveCount(0);
});

for (const path of ['/en/speakers', '/ar/speakers', '/en/learning-paths', '/ar/learning-paths', '/en/learning-paths/mlops-engineer', '/ar/learning-paths/kubernetes-for-ml']) {
  test(`${path} has a social card image, site name and locale (ACC-03)`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og-default\.png$/);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', /MLOps MENA/);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', path.startsWith('/ar') ? 'ar_EG' : 'en_US');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', new RegExp(`${path.replace(/\//g, '\\/')}$`));
  });
}

for (const [path, title] of [
  ['/en/no-such-page', 'Page not found | MLOps MENA Academy'],
  ['/ar/no-such-page', 'الصفحة غير موجودة | أكاديمية MLOps MENA'],
  ['/en/courses/no-such-course', 'Page not found | MLOps MENA Academy'],
  ['/ar/sessions/no-such-session', 'الصفحة غير موجودة | أكاديمية MLOps MENA'],
  ['/en/speakers/no-such-speaker', 'Page not found | MLOps MENA Academy'],
  ['/en/learning-paths/no-such-path', 'Page not found | MLOps MENA Academy'],
  ['/ar/roadmaps/no-such-roadmap', 'الصفحة غير موجودة | أكاديمية MLOps MENA'],
] as const) {
  test(`${path} is a 404 titled "${title}" (ACC-05)`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page).toHaveTitle(title);
  });
}

test('deleting the account lands on the homepage with a confirmation (ACC-09)', async ({ page }) => {
  const email = `audit-del-${Date.now()}@example.test`;
  const res = await page.request.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password: 'Audit-Passw0rd-1', locale: 'en' } });
  expect(res.ok()).toBe(true);
  await page.goto('/en/profile?tab=account');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByLabel('Current password').last().fill('Audit-Passw0rd-1');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.waitForURL(/\/en\?deleted=1$/);
  await expect(page.getByText('Your account has been deleted')).toBeVisible();
  // Signing up again with the address explains why it can't be used yet (ACC-10).
  await page.goto('/en/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Audit-Passw0rd-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/belongs to an account that was deleted/)).toBeVisible();
});
