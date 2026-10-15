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
