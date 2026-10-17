import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, registerAccount } from './support';

/**
 * Signed-in users never see the login form. The bug: a signed-out visitor's Apply button
 * prefetched /courses/x/apply, which the middleware answers with a redirect to /login; the
 * client router cached that, and after logging in it reused it, so the login form came back
 * with the header showing the user signed in. Leaving the login page is now a full page load.
 */
let admin: APIRequestContext;
const stamp = Date.now();
const slug = `e2e-login-loop-${stamp}`;
let courseId = '';

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const res = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Login loop ${stamp}`,
      titleAr: `دورة اختبار تسجيل الدخول ${stamp}`,
      shortDescriptionEn: 'A course created by the login loop end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار تسجيل الدخول.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: null,
      status: 'OPEN',
      level: 'INTERMEDIATE',
      language: 'BILINGUAL',
      startDate: null,
      applicationsOpenAt: null,
      applicationDeadline: null,
      durationWeeks: 2,
      hoursPerWeek: 2,
      coverImageUrl: null,
      targetAudience: { en: '', ar: '' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: [], ar: [] },
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
  expect(res.status(), await res.text()).toBe(201);
  courseId = (await res.json()).id;
});

test.afterAll(async () => {
  if (courseId) {
    const c = await (await admin.get(`/api/admin/courses/${courseId}`)).json();
    await admin.put(`/api/admin/courses/${courseId}`, { headers: JSON_HEADERS, data: { ...c, status: 'ARCHIVED' } }).catch(() => undefined);
  }
  await admin.dispose();
});

async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('form button[type=submit]').click();
}

/** Off the login page, and the form is gone. */
async function expectForwarded(page: Page, url: RegExp): Promise<void> {
  await page.waitForURL(url);
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
}

async function newStudent(locale: 'en' | 'ar', role?: 'SPEAKER'): Promise<{ email: string; password: string }> {
  const email = `login-loop.${role ?? 'student'}.${locale}.${Date.now()}@example.com`;
  const password = 'Login-Loop-2026!';
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await registerAccount(api, { email, password, locale, ...(role ? { role } : {}) });
  await api.dispose();
  return { email, password };
}

test('admin: Apply clicked while signed out, then logging in, lands on the application, not the login form', async ({ page }) => {
  await page.goto(`/en/courses/${slug}`);
  const apply = page.locator('main').getByRole('link', { name: 'Apply' }).first();
  await expect(apply).toBeVisible();
  // Let the router prefetch whatever it will (the bug: a prefetched redirect to /login).
  await page.waitForTimeout(1500);
  await apply.click();
  await page.waitForURL(/\/en\/login\?returnTo=/);
  await fillLogin(page, ADMIN.email, ADMIN.password);
  await expectForwarded(page, new RegExp(`/en/courses/${slug}/apply`));
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

test('student (ar): Apply while signed out, then logging in, goes on to the profile and back to the application', async ({ page }) => {
  const { email, password } = await newStudent('ar');
  await page.goto(`/ar/courses/${slug}`);
  const apply = page.locator('main').locator(`a[href^="/ar/courses/${slug}/apply"]`).first();
  await expect(apply).toBeVisible();
  await page.waitForTimeout(1500);
  await apply.click();
  await page.waitForURL(/\/ar\/login\?returnTo=/);
  await fillLogin(page, email, password);
  // An incomplete profile: onboarding first, carrying the application as returnTo.
  await expectForwarded(page, /\/ar\/onboarding\?returnTo=.*apply/);
});

test('header Log in after browsing a course lands on the dashboard', async ({ page }) => {
  await page.goto(`/en/courses/${slug}`);
  await page.waitForTimeout(1500);
  await page.getByRole('banner').getByRole('link', { name: 'Log in' }).click();
  await page.waitForURL(/\/en\/login/);
  await fillLogin(page, ADMIN.email, ADMIN.password);
  await expectForwarded(page, /\/en\/dashboard/);
});

test('opening /login or /register while signed in shows a spinner, never the form, then forwards', async ({ page }) => {
  await apiLogin(page.request, ADMIN.email, ADMIN.password);
  // Hold /me back so the waiting state is visible.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/auth/me', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/en/login');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  release();
  await expectForwarded(page, /\/en\/dashboard/);
  await page.unroute('**/api/auth/me');

  await page.goto('/ar/register');
  await expectForwarded(page, /\/ar\/(dashboard|onboarding)/);
});

test('a returnTo pointing at the login page itself goes to the dashboard', async ({ page }) => {
  await apiLogin(page.request, ADMIN.email, ADMIN.password);
  await page.goto(`/en/login?returnTo=${encodeURIComponent('/en/login?returnTo=%2Fen%2Flogin')}`);
  await expectForwarded(page, /\/en\/dashboard/);
});

test('a speaker opening /login with a student-only returnTo goes to the speaker portal', async ({ page }) => {
  const { email, password } = await newStudent('en', 'SPEAKER');
  await page.goto(`/en/login?returnTo=${encodeURIComponent('/en/dashboard')}`);
  await fillLogin(page, email, password);
  await expectForwarded(page, /\/en\/speaker/);
  await page.goto('/en/login');
  await expectForwarded(page, /\/en\/speaker/);
});

test('an expired access token is refreshed: the private page opens, not the login form', async ({ page, context }) => {
  await apiLogin(page.request, ADMIN.email, ADMIN.password);
  // What the browser holds once the 15-minute access cookie has expired: no access_token, and
  // has_session saying it expired a while ago.
  const cookies = await context.cookies();
  await context.clearCookies({ name: 'access_token' });
  const flag = cookies.find((c) => c.name === 'has_session')!;
  await context.addCookies([{ ...flag, value: String(Math.floor(Date.now() / 1000) - 600) }]);
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/dashboard/);
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('logging out and in again never reuses pages cached while signed out or in', async ({ page }) => {
  await page.goto('/en/login');
  await fillLogin(page, ADMIN.email, ADMIN.password);
  await expectForwarded(page, /\/en\/dashboard/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL(/\/en$/);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible();
  await page.goto(`/en/courses/${slug}`);
  await page.waitForTimeout(1500);
  await page.locator('main').getByRole('link', { name: 'Apply' }).first().click();
  await page.waitForURL(/\/en\/login\?returnTo=/);
  await fillLogin(page, ADMIN.email, ADMIN.password);
  await expectForwarded(page, new RegExp(`/en/courses/${slug}/apply`));
});

test('if forwarding keeps bouncing back, the page offers a link instead of reloading forever', async ({ page }) => {
  await apiLogin(page.request, ADMIN.email, ADMIN.password);
  // Simulate a target that always sends us back to the login page.
  await page.route('**/en/dashboard', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({ status: 302, headers: { Location: '/en/login?returnTo=%2Fen%2Fdashboard' } })
      : route.continue(),
  );
  await page.goto('/en/login?returnTo=%2Fen%2Fdashboard');
  await expect(page.getByText('You are signed in')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/en/dashboard');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});
