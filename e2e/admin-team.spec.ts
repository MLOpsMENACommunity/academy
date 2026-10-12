import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, PNG, uiLogin } from './support';

/**
 * Admin → Team: the super admin adds a social media (content) admin by email. They choose
 * their password from the email, see only Admin → Media, can't open student pages, and
 * upload a course cover that the site then serves from /api/media.
 */
const stamp = Date.now();
const email = `e2e-content-${stamp}@example.test`;
const password = 'e2e-content-password';
const title = `E2E Media Course ${stamp}`;

let admin: APIRequestContext;
let courseId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug: `e2e-media-${stamp}`,
      titleEn: title,
      titleAr: `دورة الوسائط ${stamp}`,
      shortDescriptionEn: 'A course created by the admin team end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار فريق الإدارة.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: null,
      status: 'DRAFT',
      level: 'INTERMEDIATE',
      language: 'BILINGUAL',
      startDate: null,
      applicationsOpenAt: null,
      applicationDeadline: null,
      durationWeeks: 2,
      hoursPerWeek: 2,
      coverImageUrl: null,
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Covers'], ar: ['الأغلفة'] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'YOUTUBE',
      driveFolderUrl: null,
      youtubePlaylistUrl: null,
      instructorIds: [],
    },
  });
  expect(course.status(), await course.text()).toBe(201);
  courseId = (await course.json()).id;
});

test.afterAll(async () => {
  await admin.dispose();
});

test('a super admin adds a content admin, who sees only Media and uploads a cover', async ({ page, browser }) => {
  // The super admin adds them from Admin → Team.
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/team');
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add admin' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('checkbox', { name: /Social media and content/ }).check();
  await page.getByRole('button', { name: 'Add to the team' }).click();
  await expect(page.getByText(`Account created for ${email}`)).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  // They choose their password from the email.
  const html = await latestEmail(admin, email);
  const token = /reset-password\?token=([\w-]+)/.exec(html)?.[1];
  expect(token).toBeTruthy();
  const ctx = await browser.newContext({ baseURL: BASE });
  const p = await ctx.newPage();
  await p.goto(`/en/reset-password?token=${token}&welcome=1`);
  await p.getByLabel('New password').fill(password);
  await p.getByRole('button', { name: 'Save new password' }).click();
  await expect(p.getByText('Your password has been changed')).toBeVisible();

  // Signed in, the admin panel shows Media only, and opens on it.
  await uiLogin(p, email, password);
  await p.goto('/en/admin');
  await p.waitForURL(/\/en\/admin\/media$/);
  const nav = p.getByRole('navigation', { name: 'Admin' });
  await expect(nav.getByRole('link')).toHaveText(['Media']);
  await p.goto('/en/admin/students');
  await expect(p.getByText('No access')).toBeVisible();
  expect((await p.request.get('/api/admin/students')).status()).toBe(403);

  // Upload the course cover from Admin → Media.
  await p.goto('/en/admin/media');
  await p.getByRole('searchbox', { name: 'Search by name' }).fill(title);
  const card = p.getByRole('listitem').filter({ has: p.getByRole('heading', { name: title }) });
  await card.locator('input[type=file]').first().setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await expect(card.getByLabel('Cover image')).toHaveValue(/^\/api\/media\/[0-9a-f-]{36}\.png$/);
  await card.getByRole('button', { name: 'Save' }).first().click();
  await expect(card.getByText('✓ Saved').first()).toBeVisible();

  const saved = await (await admin.get(`/api/admin/courses/${courseId}`)).json();
  expect(saved.coverImageUrl).toMatch(/^\/api\/media\/[0-9a-f-]{36}\.png$/);
  const img = await p.request.get(saved.coverImageUrl);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');
  expect(img.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  await ctx.close();

  // Back on the team page, the super admin removes them again.
  page.once('dialog', (d) => void d.accept());
  await page.reload();
  const row = page.getByRole('listitem').filter({ hasText: email });
  await row.getByRole('button', { name: 'Remove from team' }).click();
  await expect(page.getByText(`${email} was removed from the team.`)).toBeVisible();
});
