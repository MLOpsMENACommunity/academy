import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, uiLogin } from './support';

/**
 * Course pages and cards say how many students are enrolled (the number only) and how many
 * seats are left. An enrolment refreshes the cached public pages within seconds (the API asks
 * the site to revalidate), and the admin can hide the count per course.
 */
const stamp = Date.now();
const slug = `e2e-enc-${stamp}`;
const title = `E2E Enrolled Count ${stamp}`;
const studentEmail = `e2e-enc-student-${stamp}@example.test`;
/** The freshness guarantee (DEPLOY.md); locally the web app's part takes about a second. */
const GUARANTEE_MS = 30_000;

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
      titleAr: `دورة عدد المسجلين ${stamp}`,
      shortDescriptionEn: 'A course created by the enrolled-count end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار عدد الطلاب المسجلين.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: 20,
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
  expect(course.status(), await course.text()).toBe(201);
  courseId = (await course.json()).id;

  // A student made by the team (no sign-up form, so no sign-up rate limit), whose address is
  // confirmed by setting a password from the welcome email: direct enrolment needs that.
  const created = await admin.post('/api/admin/students', { headers: JSON_HEADERS, data: { email: studentEmail, locale: 'en' } });
  expect(created.status(), await created.text()).toBe(201);
  const html = await latestEmail(admin, studentEmail);
  const token = /reset-password\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'welcome link').toBeTruthy();
  const anon = await playwrightRequest.newContext({ baseURL: BASE });
  const reset = await anon.post('/api/auth/reset-password', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!), password: 'e2e-student-password' } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  await anon.dispose();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('the course page shows the enrolled count and seats left, and updates after the admin enrols someone', async ({ browser, page }) => {
  const visitor = await (await browser.newContext()).newPage();
  const enrolment = visitor.getByTestId('course-enrolment');

  // Before: nobody yet, every seat free (and the page is now rendered and cached).
  await visitor.goto(`/en/courses/${slug}`);
  await expect(enrolment).toHaveText(/No students enrolled yet\s*·\s*20 seats left/);
  await visitor.goto(`/ar/courses/${slug}`);
  await expect(enrolment).toContainText('لا يوجد طلاب مسجلون بعد');

  // The admin enrols the student by email.
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en/admin/courses/${courseId}?tab=invites`);
  await page.getByLabel('Email addresses').fill(studentEmail);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('table').first().getByRole('row', { name: new RegExp(studentEmail) })).toContainText('Enrol now');
  await page.getByRole('button', { name: /^Enrol 1 now/ }).click();
  await expect(page.getByText('Done: 1 enrolled, 0 invited.')).toBeVisible();
  const enrolledAt = Date.now();

  // The cached course page catches up within seconds, in both languages, and so does the catalog card.
  await expect
    .poll(async () => {
      await visitor.goto(`/en/courses/${slug}`);
      return (await enrolment.textContent()) ?? '';
    }, { timeout: GUARANTEE_MS, intervals: [250, 500, 1000] })
    .toMatch(/1 student enrolled\s*·\s*19 seats left/);
  test.info().annotations.push({ type: 'freshness', description: `visible ${((Date.now() - enrolledAt) / 1000).toFixed(1)} s after enrolling` });
  await visitor.goto(`/ar/courses/${slug}`);
  await expect(enrolment).toContainText('طالب واحد مسجّل');
  await visitor.goto('/en/courses');
  await expect(visitor.getByRole('article').filter({ hasText: title })).toContainText('1 student enrolled · 19 seats left');
  // Only the number: never who.
  await visitor.goto(`/en/courses/${slug}`);
  expect(await visitor.content()).not.toContain(studentEmail);

  // The admin hides the count: the page keeps the seats left and drops the number.
  await page.goto(`/en/admin/courses/${courseId}`);
  const toggle = page.getByLabel('Show enrolled count publicly');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();
  await expect
    .poll(async () => {
      await visitor.goto(`/en/courses/${slug}`);
      return (await enrolment.textContent()) ?? '';
    }, { timeout: GUARANTEE_MS, intervals: [250, 500, 1000] })
    .toBe('19 seats left');
  await visitor.context().close();
});
