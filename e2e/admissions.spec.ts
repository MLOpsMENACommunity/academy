import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Admissions and enrolment details found in the admissions audit: the payments queue pages,
 * a full course says so before the student applies, the course page closes at the deadline,
 * and students can withdraw an application.
 */
const stamp = Date.now();
const password = 'e2e-student-password';

let admin: APIRequestContext;
const courseIds: string[] = [];

/** Sign-ups are limited per IP (10 a minute): wait out a 429. */
async function register(api: APIRequestContext, data: Record<string, string>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await api.post('/api/auth/register', { headers: JSON_HEADERS, data });
    if (res.status() !== 429 || attempt >= 3) {
      expect(res.ok(), await res.text()).toBeTruthy();
      return;
    }
    await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after']) || 30) * 1000));
  }
}

/** A verified student with the required profile, signed in on `api`. */
async function student(tag: string): Promise<{ api: APIRequestContext; email: string }> {
  const email = `e2e-adm-${tag}-${stamp}@example.test`;
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await register(api, { email, password });
  const html = await latestEmail(api, email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: `Admissions ${tag}`, phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `g.${email}`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/admissions-student', githubUrl: 'https://github.com/admissions-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false }],
  ];
  for (const [section, data] of sections) {
    const r = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBeTruthy();
  }
  return { api, email };
}

async function createCourse(tag: string, data: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = `e2e-adm-${tag}-${stamp}`;
  const res = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Admissions ${tag} ${stamp}`,
      titleAr: `دورة القبول ${tag} ${stamp}`,
      shortDescriptionEn: 'A course created by the admissions end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار القبول.',
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
      ...data,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).id as string;
  courseIds.push(id);
  return { id, slug };
}

/** The student's session cookies, for a browser page. */
async function signIn(page: Page, api: APIRequestContext): Promise<void> {
  await page.context().addCookies((await api.storageState()).cookies);
}

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
});

test.afterAll(async () => {
  for (const id of courseIds) {
    const c = await (await admin.get(`/api/admin/courses/${id}`)).json();
    await admin.put(`/api/admin/courses/${id}`, { headers: JSON_HEADERS, data: { ...c, status: 'ARCHIVED' } }).catch(() => undefined);
  }
  await admin.dispose();
});

test('the payments queue shows how many there are and pages through them', async ({ page }) => {
  await page.context().addCookies((await admin.storageState()).cookies);
  const count = (await (await admin.get('/api/admin/payments-count?status=APPROVED')).json()).count as number;
  await page.goto('/en/admin/payments');
  await page.getByRole('tab', { name: 'Approved' }).click();
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await expect(pager).toBeVisible();
  await expect(pager).toContainText(String(count));
});

test('a full course says so before the student applies, and the button says "Join the waitlist"', async ({ page }) => {
  const course = await createCourse('full', { requiresApproval: false, capacity: 1 });
  const first = await student('seat');
  expect((await first.api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: course.slug, answers: {} } })).ok()).toBeTruthy();
  const late = await student('late');
  await signIn(page, late.api);

  await page.goto(`/en/courses/${course.slug}`);
  await expect(page.getByText("Seats are full: you'll join the waitlist.").first()).toBeVisible();
  await expect(page.getByText('Instant enrolment.')).toHaveCount(0);

  await page.goto(`/en/courses/${course.slug}/apply`);
  await expect(page.getByText(/This course is full\. If you apply now, you'll join the waitlist/)).toBeVisible();
  await page.getByRole('button', { name: 'Join the waitlist' }).click();
  await page.waitForURL(/\/en\/dashboard\/applications\//);
  await expect(page.getByText("You're on the waitlist.").first()).toBeVisible();
  await late.api.dispose();
  await first.api.dispose();
});

test('the course page stops offering "Apply now" when the deadline passes, without a reload', async ({ page }) => {
  const course = await createCourse('deadline', { applicationDeadline: new Date(Date.now() + 25_000).toISOString() });
  await page.goto(`/en/courses/${course.slug}`);
  const apply = page.getByRole('link', { name: 'Apply now' }).first();
  await expect(apply).toBeVisible();
  // The page stays open past the deadline: the button turns into the waiting list.
  await expect(apply).toBeHidden({ timeout: 45_000 });
  await expect(page.getByText('Applications closed').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notify me when it opens' }).first()).toBeVisible();
});

test('a payment under review links to its application, and Arabic digits are accepted in the proof', async ({ page }) => {
  const previous = await (await admin.get('/api/admin/settings')).json();
  await admin.put('/api/admin/settings', { headers: JSON_HEADERS, data: { instapayHandle: 'e2e@instapay', instapayName: 'E2E Academy', vodafoneCashNumber: '01000000000', vodafoneCashName: 'E2E Academy' } });
  try {
    const course = await createCourse('pay', { type: 'PAID', price: 1500, requiresApproval: false });
    const payer = await student('payer');
    const app = await (await payer.api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: course.slug, answers: {} } })).json();
    expect(app.status).toBe('AWAITING_PAYMENT');

    // The proof form, typed on an Arabic keyboard.
    await signIn(page, payer.api);
    await page.goto(`/ar/dashboard/applications/${app.id}`);
    await page.getByLabel(/المبلغ المدفوع/).fill('١٥٠٠');
    await page.getByLabel('الرقم المرجعي للعملية').fill('IP ١٢٣٤ ٥٦٧٨');
    await page.getByLabel('اسم المرسل').fill('عمر تجربة');
    await page.getByLabel(/رقم هاتف المرسل/).fill('٠١٠٠١٢٣٤٥٦٧');
    await page.locator('#payment-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('button', { name: 'إرسال الإثبات' }).click();
    await expect(page.getByText('شكرًا! نتحقق من الدفع')).toBeVisible();

    const detail = await (await admin.get(`/api/admin/applications/${app.id}`)).json();
    const payment = detail.payments[0];
    expect(payment).toMatchObject({ amount: 1500, transactionRef: 'IP 1234 5678', senderPhone: '01001234567' });

    const adminPage = await page.context().browser()!.newPage();
    await adminPage.context().addCookies((await admin.storageState()).cookies);
    await adminPage.goto(`/en/admin/payments/${payment.id}`);
    await adminPage.getByRole('link', { name: `E2E Admissions pay ${stamp}` }).click();
    await adminPage.waitForURL(new RegExp(`/en/admin/applications/${app.id}$`));
    await adminPage.close();
    await payer.api.dispose();
  } finally {
    await admin.put('/api/admin/settings', { headers: JSON_HEADERS, data: previous });
  }
});

test('a student withdraws an application from its page, then applies again from the course page', async ({ page }) => {
  const course = await createCourse('withdraw');
  const s = await student('withdraw');
  const app = await (await s.api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: course.slug, answers: {} } })).json();
  expect(app.status).toBe('SUBMITTED');
  await signIn(page, s.api);

  await page.goto(`/en/dashboard/applications/${app.id}`);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Withdraw application' }).click();
  await expect(page.getByText('You withdrew this application.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw application' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Apply again' }).click();
  await page.waitForURL(new RegExp(`/en/courses/${course.slug}$`));
  await page.getByRole('link', { name: 'Apply again' }).first().click();
  await page.waitForURL(new RegExp(`/en/courses/${course.slug}/apply`));
  await page.getByRole('button', { name: 'Submit application' }).click();
  await page.waitForURL(new RegExp(`/en/dashboard/applications/${app.id}$`));
  await expect(page.getByText("We're reviewing your application.").first()).toBeVisible();
  await s.api.dispose();
});
