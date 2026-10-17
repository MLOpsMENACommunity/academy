import { expect, request as playwrightRequest, test } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS } from './support';

/** Telegram and Discord usernames: required in the community step; students from before get a banner. */

const PASSWORD = 'Handles-Passw0rd-1';

const sections = (email: string, handles: { telegramUsername: string; discordUsername: string }): [string, object][] => [
  ['core', { fullNameEn: 'Nour Handles', phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `g.${email.split('@')[0]}@gmail.com`, preferredLanguage: 'en', acceptTerms: true }],
  ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
  ['education', { educationLevel: 'BACHELORS' }],
  ['links', { linkedinUrl: 'https://www.linkedin.com/in/nour-handles', githubUrl: 'https://github.com/nour-handles' }],
  ['community', { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false, ...handles }],
];

test('a student from before the usernames were asked gets a banner, adds them, and the banner goes', async ({ page }) => {
  const email = `handles-${Date.now()}@example.test`;
  const reg = await page.request.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password: PASSWORD, locale: 'en' } });
  expect(reg.ok()).toBe(true);
  const { id } = (await reg.json()) as { id: string };
  for (const [section, data] of sections(email, { telegramUsername: 'nour_handles', discordUsername: 'nour.handles' })) {
    const r = await page.request.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBe(true);
  }
  // Like a student who completed their profile before the usernames were asked: an admin clears them.
  const admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const cleared = await admin.put(`/api/admin/students/${id}/profile/community`, {
    headers: JSON_HEADERS,
    data: { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false, telegramUsername: '', discordUsername: '' },
  });
  expect(cleared.ok(), await cleared.text()).toBe(true);
  await admin.dispose();

  await page.goto('/en/dashboard');
  await expect(page.getByText('Add your Telegram and Discord usernames')).toBeVisible();
  // Nothing they have is taken away: no "Complete your profile" card.
  await expect(page.getByRole('heading', { name: 'Complete your profile' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Add them now' }).click();
  await page.waitForURL(/\/en\/profile\?tab=community/);
  await page.getByLabel('Telegram username').fill('nour');
  await page.getByLabel('Discord username').fill('Nour.Handles');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Enter a Telegram username/)).toBeVisible();
  await page.getByLabel('Telegram username').fill('@nour_handles');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();
  await expect(page.getByText('Add your Telegram and Discord usernames')).toHaveCount(0);
  const profile = await (await page.request.get('/api/me/profile')).json();
  expect(profile).toMatchObject({ telegramUsername: 'nour_handles', discordUsername: 'nour.handles' });
});

test('the community step in Arabic shows both fields left to right, and they are required', async ({ page }) => {
  const email = `handles-ar-${Date.now()}@example.test`;
  expect((await page.request.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password: PASSWORD, locale: 'ar' } })).ok()).toBe(true);
  await page.goto('/ar/profile?tab=community');
  const telegram = page.getByLabel('اسم المستخدم على Telegram');
  await expect(telegram).toHaveAttribute('dir', 'ltr');
  await expect(page.getByLabel('اسم المستخدم على Discord')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('هذا الحقل مطلوب.').first()).toBeVisible();
});

test('the privacy policy mentions the Telegram and Discord usernames in both languages', async ({ page }) => {
  await page.goto('/en/privacy');
  await expect(page.getByText(/Telegram and Discord usernames are needed to apply/)).toBeVisible();
  await page.goto('/ar/privacy');
  await expect(page.getByText(/اسمي المستخدم على Telegram وDiscord للتقديم/)).toBeVisible();
});
