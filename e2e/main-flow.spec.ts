import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, PNG, uiLogin } from './support';

/**
 * The flow the academy exists for: a visitor finds a paid course, registers,
 * completes the required profile, applies, gets shortlisted and accepted,
 * pays, an admin approves the payment, and the student sees the live link.
 */
const stamp = Date.now();
const slug = `e2e-paid-${stamp}`;
const student = { email: `e2e-${stamp}@example.test`, password: 'e2e-student-password', name: `E2E Student ${stamp}` };
const QUESTION = 'What do you want to get out of this course?';

let admin: APIRequestContext;
let courseId: string;
let previousSettings: Record<string, unknown>;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);

  // Payments are blocked while settings hold placeholders.
  previousSettings = await (await admin.get('/api/admin/settings')).json();
  const s = await admin.put('/api/admin/settings', {
    headers: JSON_HEADERS,
    data: { instapayHandle: 'e2e@instapay', instapayName: 'E2E Academy', vodafoneCashNumber: '01000000000', vodafoneCashName: 'E2E Academy' },
  });
  expect(s.ok()).toBeTruthy();

  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Paid Course ${stamp}`,
      titleAr: `دورة مدفوعة ${stamp}`,
      shortDescriptionEn: 'A paid course created by the end-to-end test.',
      shortDescriptionAr: 'دورة مدفوعة أنشأها اختبار شامل.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'PAID',
      price: 1500,
      currency: 'EGP',
      requiresApproval: true,
      capacity: 20,
      status: 'OPEN',
      level: 'INTERMEDIATE',
      language: 'BILINGUAL',
      startDate: new Date(Date.now() + 20 * 60_000).toISOString(),
      applicationsOpenAt: null,
      applicationDeadline: null,
      durationWeeks: 4,
      hoursPerWeek: 3,
      coverImageUrl: null,
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Ship models'], ar: ['نشر النماذج'] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'GOOGLE_DRIVE',
      driveFolderUrl: 'https://drive.google.com/drive/folders/e2e',
      youtubePlaylistUrl: null,
      instructorIds: [],
    },
  });
  expect(course.status(), await course.text()).toBe(201);
  courseId = (await course.json()).id;

  await admin.put(`/api/admin/courses/${courseId}/questions`, {
    headers: JSON_HEADERS,
    data: { questions: [{ type: 'SHORT_TEXT', labelEn: QUESTION, labelAr: 'ماذا تريد أن تتعلم؟', required: true }] },
  });
  // Starts in 20 minutes: inside the live-link reveal window (60 by default).
  const session = await admin.post(`/api/admin/courses/${courseId}/sessions`, {
    headers: JSON_HEADERS,
    data: {
      titleEn: 'Kickoff',
      titleAr: 'البداية',
      startsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      durationMin: 90,
      liveUrl: 'https://meet.google.com/e2e-test-link',
      materials: [],
    },
  });
  expect(session.status()).toBe(201);
});

test.afterAll(async () => {
  if (previousSettings) await admin.put('/api/admin/settings', { headers: JSON_HEADERS, data: previousSettings });
  // Keep the catalog clean for the next run.
  if (courseId) await admin.put(`/api/admin/courses/${courseId}`, { headers: JSON_HEADERS, data: { ...(await (await admin.get(`/api/admin/courses/${courseId}`)).json()), status: 'ARCHIVED' } }).catch(() => undefined);
  await admin.dispose();
});

test('visitor → register → profile → apply → shortlist → pay → approve → session link', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Visitor finds the course and clicks apply: sent to log in, then registers.
  await page.goto(`/en/courses/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`E2E Paid Course ${stamp}`);
  await page.getByRole('link', { name: 'Apply now' }).first().click();
  await page.waitForURL(/\/en\/login\?returnTo=/);
  await page.getByRole('link', { name: 'Create account' }).last().click();
  await page.waitForURL(/\/en\/register/);
  await page.getByLabel('Email').fill(student.email);
  await page.getByLabel('Password').fill(student.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // 2. Required profile step.
  await page.waitForURL(/\/en\/onboarding/);
  await page.getByLabel('Full name (English)').fill(student.name);
  await page.getByLabel('Phone / WhatsApp').fill('+201001234567');
  await page.getByLabel('Google account email').fill(`e2e.${stamp}@gmail.com`);
  await page.getByLabel('Country of residence').selectOption('EG');
  await page.getByLabel('City').fill('Cairo');
  await page.getByLabel('Current employment status').selectOption('EMPLOYED_FULL_TIME');
  await page.getByLabel('Current job title').fill('ML Engineer');
  await page.getByLabel('Total professional experience').selectOption('Y3_5');
  await page.getByLabel('Primary area').selectOption('MLOPS');
  await page.getByLabel('English', { exact: true }).check();
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 2 of 7')).toBeVisible();

  // 3. Confirm the email from the inbox.
  const html = await latestEmail(page.request, student.email);
  const link = html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/)?.[1];
  expect(link, 'verification link').toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, '&'));
  await expect(page.getByText('Your email is confirmed.')).toBeVisible();

  // 4. Apply.
  await page.goto(`/en/courses/${slug}/apply`);
  await page.getByLabel(QUESTION).fill('Run models in production with confidence.');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await page.waitForURL(/\/en\/dashboard\/applications\//);
  const applicationId = page.url().split('/').pop()!.split('?')[0]!;

  // 5. Admin shortlists, then accepts (paid course → awaiting payment).
  for (const event of ['SHORTLIST', 'ACCEPT']) {
    const r = await admin.post(`/api/admin/applications/${applicationId}/transition`, { headers: JSON_HEADERS, data: { event } });
    expect(r.ok(), `${event}: ${await r.text()}`).toBeTruthy();
  }
  expect((await (await admin.get(`/api/admin/applications/${applicationId}`)).json()).status).toBe('AWAITING_PAYMENT');

  // 6. Student pays and uploads proof.
  await page.goto('/en/dashboard');
  await page.getByRole('link', { name: 'Pay and upload proof' }).first().click();
  await page.getByLabel('Transaction reference number').fill(`E2E ${stamp}`);
  await page.getByLabel('Sender name').fill(student.name);
  await page.getByLabel('Sender phone or InstaPay address').fill('e2e@instapay');
  await page.locator('#payment-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Submit proof' }).click();
  await expect(page.getByText("Thanks! We're verifying your payment")).toBeVisible();

  // 7. Admin approves in the review UI.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await uiLogin(adminPage, ADMIN.email, ADMIN.password);
  await adminPage.goto('/en/admin/payments');
  await adminPage.getByText(student.name).first().click();
  await adminPage.getByLabel('I verified this reference and amount in the transaction history').check();
  await adminPage.getByRole('button', { name: 'Approve and enrol' }).click();
  await expect(adminPage.getByText('Approved', { exact: true }).first()).toBeVisible();
  await adminContext.close();

  // 8. Student is enrolled and sees the live session link.
  await page.goto(`/en/learn/${slug}`);
  const join = page.getByRole('link', { name: /Join live session/ });
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute('href', 'https://meet.google.com/e2e-test-link');

  expect(errors).toEqual([]);
});
