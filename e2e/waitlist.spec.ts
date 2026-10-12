import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * "Notify me" on a course that isn't open needs an academy account, like applying: a
 * signed-out visitor is sent to sign-up, confirms their email from the inbox, lands back on
 * the course and is on the list. The confirmation email's link lets them leave.
 */
const stamp = Date.now();
const slug = `e2e-waitlist-${stamp}`;
const title = `E2E Waiting List Course ${stamp}`;
const email = `e2e-waitlist-${stamp}@example.test`;

let admin: APIRequestContext;
let courseId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: title,
      titleAr: `دورة قائمة الانتظار ${stamp}`,
      shortDescriptionEn: 'A coming-soon course created by the waiting-list end-to-end test.',
      shortDescriptionAr: 'دورة قادمة أنشأها اختبار قائمة الانتظار.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: null,
      status: 'COMING_SOON',
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
      learningOutcomes: { en: ['Hear when it opens'], ar: ['اعرف متى يفتح التسجيل'] },
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
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('a signed-out visitor creates an account, confirms the email and is on the waiting list', async ({ page }) => {
  // Without an account the API refuses outright: no row, no email.
  const anon = await page.request.post(`/api/courses/${slug}/interest`, { headers: JSON_HEADERS, data: { email } });
  expect(anon.status()).toBe(401);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/courses/${slug}`);
  // On phones the CTA is the bar pinned to the bottom. No email box any more: an account first.
  const bar = page.locator('div.sticky.bottom-0');
  await expect(bar.getByRole('textbox')).toHaveCount(0);
  await bar.getByRole('link', { name: 'Notify me' }).click();

  // Sign-up, with the way back to the course kept.
  await page.waitForURL(/\/en\/register\?returnTo=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('returnTo') ?? '')).toBe(`/en/courses/${slug}/notify`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-waitlist-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/en\/onboarding/);

  // Not confirmed yet: nobody is added.
  const before = await (await admin.get(`/api/admin/courses/${courseId}/waitlist`)).json();
  expect(before.count).toBe(0);

  // Confirm the email from the inbox: the link brings them back to the course, and adds them.
  const html = await latestEmail(page.request, email);
  const link = html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/)?.[1];
  expect(link, 'verification link').toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, '&'));
  await expect(page.getByText('Your email is confirmed.')).toBeVisible();
  await page.getByRole('link', { name: 'Continue' }).click();
  await page.waitForURL(new RegExp(`/en/courses/${slug}$`));
  await expect(page.locator('div.sticky.bottom-0').getByText("You're on the waiting list")).toBeVisible();

  const list = await (await admin.get(`/api/admin/courses/${courseId}/waitlist`)).json();
  expect(list.entries).toEqual([expect.objectContaining({ email, student: true })]);

  // The confirmation email has a link to leave, which works without signing in.
  // It is queued after the join: wait until it is the newest email (the confirmation link came first).
  let leave: string | undefined;
  for (let i = 0; i < 20 && !leave; i++) {
    leave = /https?:\/\/[^\s"<]+\/waitlist\/leave\?token=[\w-]+\.[\w-]+/.exec(await latestEmail(page.request, email))?.[0];
    if (!leave) await page.waitForTimeout(500);
  }
  expect(leave, 'leave link in the confirmation').toBeTruthy();
  await page.context().clearCookies();
  await page.goto(new URL(leave!).pathname + new URL(leave!).search);
  await page.getByRole('button', { name: 'Leave the list' }).click();
  await expect(page.getByText(/You've left the waiting list/)).toBeVisible();
  expect((await (await admin.get(`/api/admin/courses/${courseId}/waitlist`)).json()).count).toBe(0);
});
