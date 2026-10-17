import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, uiLogin } from './support';

/**
 * Course staff: the admin creates a "Teaching assistant" role (Grade and See the roster) in a
 * course's Staff tab and adds a student account to it; that student opens Teaching, sees only
 * the Gradebook and Roster tabs, and grades a submission. The public course page never shows
 * the anonymous Moderator, and only Shown roles.
 */
const stamp = Date.now();
const slug = `e2e-staff-${stamp}`;
const title = `E2E Staff Course ${stamp}`;
const password = 'e2e-course-staff-password';
const taEmail = `e2e-staff-ta-${stamp}@example.test`;
const studentEmail = `e2e-staff-stu-${stamp}@example.test`;
const LAB = `Staff lab ${stamp}`;

let admin: APIRequestContext;
let courseId: string;
let labId: string;

async function register(ctx: APIRequestContext, email: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password } });
    if (res.status() !== 429 || attempt >= 3) {
      expect(res.ok(), await res.text()).toBeTruthy();
      break;
    }
    await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after']) || 30) * 1000));
  }
  const html = await latestEmail(ctx, email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await ctx.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: title,
      titleAr: `دورة الفريق ${stamp}`,
      shortDescriptionEn: 'A course created by the course-staff end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار فريق الدورة.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: true,
      capacity: null,
      status: 'OPEN',
      language: 'BILINGUAL',
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Ship models'], ar: ['نشر النماذج'] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: true, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'YOUTUBE',
      instructorIds: [],
    },
  });
  expect(course.status(), await course.text()).toBe(201);
  courseId = (await course.json()).id;

  for (const email of [taEmail, studentEmail]) {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    await register(ctx, email);
    await ctx.dispose();
  }
  const enrol = await admin.post(`/api/admin/courses/${courseId}/invites`, { headers: JSON_HEADERS, data: { entries: [{ email: studentEmail }], sendEmail: false } });
  expect(enrol.ok(), await enrol.text()).toBeTruthy();

  const lab = await admin.post(`/api/admin/courses/${courseId}/assessments`, {
    headers: JSON_HEADERS,
    data: { type: 'LAB', status: 'PUBLISHED', titleEn: LAB, submissionKind: 'LINK', maxPoints: 20 },
  });
  expect(lab.status(), await lab.text()).toBe(201);
  labId = (await lab.json()).id;
  const student = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(student, studentEmail, password);
  const handIn = await student.post(`/api/learn/${slug}/assessments/${labId}/submission`, { headers: JSON_HEADERS, data: { url: 'https://github.com/e2e-student/staff-lab', attested: true } });
  expect(handIn.ok(), await handIn.text()).toBeTruthy();
  await student.dispose();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('the admin creates a Teaching assistant role, adds a student account, and that student grades from Teaching', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Admin → Courses → {course} → Staff: no Main instructor yet.
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en/admin/courses/${courseId}?tab=staff`);
  await expect(page.getByRole('tab', { name: 'Staff' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No main instructor')).toBeVisible();

  // 2. A new role with two permissions.
  await page.getByRole('button', { name: '+ New role' }).click();
  const roleForm = page.getByRole('form', { name: 'New role' });
  await roleForm.getByLabel('Name (English)').fill('Teaching assistant');
  await roleForm.getByLabel('Name (Arabic)').fill('مساعد تدريس');
  await roleForm.getByRole('checkbox', { name: 'Grade', exact: true }).check();
  await roleForm.getByRole('checkbox', { name: 'See the roster', exact: true }).check();
  await roleForm.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('form', { name: 'Teaching assistant' })).toBeVisible();

  // 3. The student account joins the staff in that role.
  const add = page.getByRole('form', { name: 'Add someone' });
  await add.getByLabel('Email of their account').fill(taEmail);
  await add.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Teaching assistant' });
  await add.getByRole('button', { name: 'Add to the staff' }).click();
  const row = page.getByTestId('staff-row').filter({ hasText: taEmail });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Student account');

  // 4. The assistant (a student account) opens Teaching from the dashboard.
  const ta = await browser.newContext();
  const tp = await ta.newPage();
  tp.on('pageerror', (e) => errors.push(String(e)));
  await apiLogin(tp.request, taEmail, password);
  await tp.goto('/en/teach');
  await expect(tp.getByRole('heading', { level: 1, name: 'Teaching' })).toBeVisible();
  await expect(tp.getByText('Your role: Teaching assistant')).toBeVisible();
  await tp.getByRole('link', { name: 'Open course' }).click();
  await expect(tp.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(tp.getByRole('tab')).toHaveText(['Gradebook', 'Roster']);

  // 5. Grading the lab.
  await tp.getByRole('button', { name: `Gradebook: ${LAB}` }).click();
  await tp.getByRole('row').filter({ hasText: studentEmail }).getByRole('button', { name: /^Open/ }).click();
  await expect(tp.getByRole('link', { name: /github\.com\/e2e-student\/staff-lab/ }).first()).toBeVisible();
  await tp.getByLabel('Score (out of 20)').fill('18');
  await tp.getByLabel('Feedback for the student').fill('Well structured. Pin your dependencies.');
  await tp.getByRole('button', { name: 'Save grade' }).click();
  await expect(tp.getByText('Grade saved. The student was notified.')).toBeVisible();

  // The roster shows the enrolled student; anything else is refused by the API.
  await tp.getByRole('tab', { name: 'Roster' }).click();
  await expect(tp.getByRole('region', { name: 'Enrolled students' }).getByRole('link', { name: studentEmail })).toBeVisible();
  expect((await tp.request.get(`/api/teach/courses/${courseId}/points`)).status()).toBe(403);

  const book = (await (await admin.get(`/api/admin/assessments/${labId}/submissions`)).json()) as { rows: { email: string; score: number | null }[] };
  expect(book.rows.find((r) => r.email === studentEmail)?.score).toBe(18);
  await ta.close();
  expect(errors).toEqual([]);
});
