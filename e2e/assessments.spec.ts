import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { writeXlsx } from '../packages/shared/src/xlsx';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, MAILPIT } from './support';

/**
 * Assessments: an admin builds a weighted quiz in the course editor, an enrolled
 * student takes it in the course player and sees the score the server computed.
 */
const stamp = Date.now();
const slug = `e2e-quiz-${stamp}`;
const student = { email: `e2e-quiz-${stamp}@example.test`, password: 'e2e-student-password' };
const QUIZ = `Checkpoint quiz ${stamp}`;

let admin: APIRequestContext;
let courseId: string;

/** Registers, confirms the email, completes the profile and enrols in the test course (all through the API). */
async function enrolStudent(api: APIRequestContext, email: string, name: string): Promise<void> {
  expect((await api.post('/api/auth/register', { headers: JSON_HEADERS, data: { email, password: student.password } })).ok()).toBeTruthy();
  const html = await latestEmail(api, email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: name, phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `q.${email.split('@')[0]}@gmail.com`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/quiz-student', githubUrl: 'https://github.com/quiz-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false, telegramUsername: 'e2e_student', discordUsername: 'e2e.student' }],
  ];
  for (const [section, data] of sections) {
    const r = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBeTruthy();
  }
  const applied = await api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: slug, answers: {} } });
  expect(applied.ok(), await applied.text()).toBeTruthy();
  expect((await applied.json()).status).toBe('ENROLLED');
}

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  // A free course that enrols on application, so the student gets in without a review step.
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Quiz Course ${stamp}`,
      titleAr: `دورة اختبار ${stamp}`,
      shortDescriptionEn: 'A course created by the assessments end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار التقييمات.',
      longDescriptionEn: '',
      longDescriptionAr: '',
      type: 'FREE',
      price: 0,
      currency: 'EGP',
      requiresApproval: false,
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
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Pass the quiz'], ar: ['اجتياز الاختبار'] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: true, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'YOUTUBE',
      driveFolderUrl: null,
      youtubePlaylistUrl: null,
      instructorIds: [],
    },
  });
  expect(course.status(), await course.text()).toBe(201);
  courseId = (await course.json()).id;
  await admin.put(`/api/admin/courses/${courseId}/questions`, { headers: JSON_HEADERS, data: { questions: [] } });
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('admin builds a weighted quiz; an enrolled student takes it and sees the score', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. The admin creates the quiz in the course editor's Assessments tab.
  const adminContext = await browser.newContext();
  const ap = await adminContext.newPage();
  await adminContext.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email: ADMIN.email, password: ADMIN.password } });
  await ap.goto(`/en/admin/courses/${courseId}?tab=assessments`);
  await ap.getByRole('button', { name: '+ New assessment' }).click();
  // Scoped to the form: the page also holds the (closed) "Duplicate course" form.
  const form = ap.locator('form', { has: ap.getByRole('heading', { name: 'New assessment' }) });
  await form.getByLabel('Status').selectOption('PUBLISHED');
  // English only: no Arabic fields, no "Order" number.
  await expect(form.getByLabel('Title (Arabic)')).toHaveCount(0);
  await expect(form.getByLabel('Order')).toHaveCount(0);
  await form.getByRole('textbox', { name: 'Title', exact: true }).fill(QUIZ);
  await form.getByLabel('Max points').fill('10');
  await form.getByLabel('Attempts allowed').fill('1');
  const question = async (n: number, en: string, weight: string, options: [string, string]) => {
    await form.getByRole('button', { name: '+ Add question' }).click();
    const q = form.getByRole('group', { name: `Question ${n}` });
    await q.getByRole('textbox', { name: 'Question', exact: true }).fill(en);
    await q.getByLabel('Weight (points)').fill(weight);
    for (const [i, label] of options.entries()) {
      await q.getByRole('textbox', { name: `Option ${i + 1}`, exact: true }).fill(label);
    }
  };
  // Weights 1 and 3: getting only the heavy one right scores 3/4 of 10 = 7.5.
  await question(1, 'Which tool tracks experiments?', '1', ['MLflow', 'Nginx']);
  await question(2, 'Which one schedules containers?', '3', ['Kubernetes', 'Excel']);
  await form.getByRole('button', { name: 'Save assessment' }).click();
  await expect(ap.getByText('Saved.')).toBeVisible();
  await expect(ap.getByText(QUIZ)).toBeVisible();
  await adminContext.close();

  // 2. A student registers, confirms the email, completes the profile and enrols (via the API).
  await enrolStudent(page.request, student.email, 'Quiz Student');

  // 3. The course page lists the quiz as due; the student opens and starts it.
  await page.goto(`/en/learn/${slug}`);
  await expect(page.getByRole('link', { name: /Assessments\s*1 due/ })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(QUIZ) }).click();
  await page.getByRole('button', { name: 'Start the quiz' }).click();
  // The answer key is never in what the browser received.
  await page.getByRole('group', { name: /Which tool tracks experiments/ }).getByLabel('Nginx').check();
  await page.getByRole('group', { name: /Which one schedules containers/ }).getByLabel('Kubernetes').check();
  await expect(page.getByText('2 of 2 answered')).toBeVisible();

  // 4. Confirm before submitting, then the score screen.
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Submit your answers?' })).toBeVisible();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  const result = page.getByRole('region', { name: 'Your result' });
  await expect(result).toContainText('7.5/10');
  await expect(result).toContainText('75%');
  // One attempt, answers after the last one: the key with the right answers is now shown.
  await expect(page.getByRole('heading', { name: /Answers · Attempt 1/ })).toBeVisible();

  // 5. Back on the course page: graded, nothing due.
  await page.goto(`/en/learn/${slug}`);
  await expect(page.getByRole('link', { name: new RegExp(QUIZ) })).toContainText('7.5/10');
  await expect(page.getByText('1 due')).toHaveCount(0);

  expect(errors).toEqual([]);
});

/** 30 questions as spreadsheet rows: 10 single choice, 10 multiple choice, 10 true/false. */
function quizRows(prefix: string, count: number): string[][] {
  const rows = [['Type', 'Question', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6', 'Correct', 'Weight', 'Explanation']];
  for (let i = 1; i <= count; i++) {
    const type = (['single', 'multiple', 'true_false'] as const)[(i - 1) % 3]!;
    const options = type === 'true_false' ? ['', '', ''] : [`${prefix} A${i}`, `${prefix} B${i}`, `${prefix} C${i}`];
    const correct = type === 'single' ? 'B' : type === 'multiple' ? '1,3' : 'true';
    rows.push([type, `${prefix} question ${i}?`, ...options, '', '', '', correct, '1', '']);
  }
  return rows;
}
const csvOf = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');

test('admin uploads questions from .xlsx and .csv, reorders, publishes; enrolled students are told once and read it in Arabic', async ({ browser, page }) => {
  const errors: string[] = [];
  const UPLOADED = `Uploaded quiz ${stamp}`;
  const reader = { email: `e2e-quiz-ar-${stamp}@example.test` };
  const outsider = { email: `e2e-quiz-out-${stamp}@example.test` };
  // An enrolled student (Arabic site) and an account that isn't enrolled.
  await enrolStudent(page.request, reader.email, 'Arabic Reader');
  const out = await playwrightRequest.newContext({ baseURL: BASE });
  expect((await out.post('/api/auth/register', { headers: JSON_HEADERS, data: { email: outsider.email, password: student.password } })).ok()).toBeTruthy();

  const adminContext = await browser.newContext();
  const ap = await adminContext.newPage();
  ap.on('pageerror', (e) => errors.push(String(e)));
  await adminContext.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email: ADMIN.email, password: ADMIN.password } });
  await ap.goto(`/en/admin/courses/${courseId}?tab=assessments`);
  await ap.getByRole('button', { name: '+ New assessment' }).click();
  const form = ap.locator('form', { has: ap.getByRole('heading', { name: 'New assessment' }) });
  await form.getByRole('textbox', { name: 'Title', exact: true }).fill(UPLOADED);
  await form.getByLabel('Max points').fill('30');
  const upload = form.getByRole('region', { name: 'Upload questions from Excel or CSV' });
  const fileInput = upload.locator('input[type=file]');

  // 1. A .csv with mistakes: each bad row is listed with its row number and nothing can be added.
  const bad = quizRows('Bad', 3);
  bad[2]![8] = '9';
  bad[3]![0] = 'essay';
  await fileInput.setInputFiles({ name: 'mistakes.csv', mimeType: 'text/csv', buffer: Buffer.from(csvOf(bad)) });
  await expect(upload.getByText('2 rows need fixing')).toBeVisible();
  await expect(upload.getByText('Row 3: “9” isn’t an option number or letter')).toBeVisible();
  await expect(upload.getByText('Row 4: Unknown type “essay”')).toBeVisible();
  await expect(upload.getByRole('button', { name: 'Add after the current questions' })).toBeDisabled();

  // 2. The 30-question .xlsx: preview, then add.
  await fileInput.setInputFiles({ name: 'quiz.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(writeXlsx(quizRows('Sheet', 30))) });
  await expect(upload.getByText('30 questions ready')).toBeVisible();
  await expect(upload.getByRole('cell', { name: 'Sheet question 30?' })).toBeVisible();
  await upload.getByRole('button', { name: 'Add after the current questions' }).click();
  await expect(form.getByText('30 questions added. Review them below, then save the assessment.')).toBeVisible();
  await expect(form.getByRole('group', { name: 'Question 30' })).toBeVisible();
  // True/false shows fixed True/False answers, not text boxes.
  await expect(form.getByRole('group', { name: 'Question 3' }).getByRole('textbox', { name: 'Option 1', exact: true })).toHaveCount(0);

  // 3. A .csv with 5 more, appended.
  await fileInput.setInputFiles({ name: 'more.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF' + csvOf(quizRows('Csv', 5))) });
  await expect(upload.getByText('5 questions ready')).toBeVisible();
  await upload.getByRole('button', { name: 'Add after the current questions' }).click();
  await expect(form.getByRole('group', { name: 'Question 35' })).toBeVisible();
  await form.getByRole('button', { name: 'Save assessment' }).click();
  await expect(ap.getByText('Saved.')).toBeVisible();
  const row = (title: string) => ap.getByRole('listitem').filter({ hasText: title });
  await expect(row(UPLOADED)).toContainText('35 questions');

  // 4. Reorder with the arrows: the uploaded quiz (last) moves above the first one, and stays there.
  // The list's order, read from the arrows' labels ("Move “…” up").
  const titles = () => ap.getByRole('button', { name: /^Move “.*” up$/ }).evaluateAll((els) => els.map((e) => /“(.*)”/.exec(e.getAttribute('aria-label') ?? '')?.[1]));
  expect((await titles()).at(-1)).toBe(UPLOADED);
  await ap.getByRole('button', { name: `Move “${UPLOADED}” up` }).click();
  await expect(ap.getByText('Order saved.')).toBeVisible();
  await ap.reload();
  await expect(ap.getByRole('button', { name: `Move “${UPLOADED}” up` })).toBeVisible();
  expect(await titles()).toEqual([UPLOADED, QUIZ]);

  // 5. Publish: enrolled students are told in-app and by email, once.
  await row(UPLOADED).getByRole('button', { name: 'Edit' }).click();
  const edit = ap.locator('form', { has: ap.getByRole('heading', { name: 'Edit assessment' }) });
  await edit.getByLabel('Status').selectOption('PUBLISHED');
  await edit.getByRole('button', { name: 'Save assessment' }).click();
  await expect(ap.getByText('Saved.')).toBeVisible();
  const told = async (ctx: APIRequestContext) =>
    ((await (await ctx.get('/api/notifications')).json()) as { items: { titleEn: string }[] }).items.filter((n) => n.titleEn === `New quiz: ${UPLOADED}`).length;
  await expect.poll(() => told(page.request)).toBe(1);
  const noticeMails = async () =>
    ((await (await page.request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${reader.email}" subject:"New quiz"`)}`)).json()) as { messages?: unknown[] }).messages?.length ?? 0;
  await expect.poll(noticeMails).toBe(1);
  // Unpublish and publish again: no second notice.
  for (const status of ['DRAFT', 'PUBLISHED']) {
    await row(UPLOADED).getByRole('button', { name: 'Edit' }).click();
    await edit.getByLabel('Status').selectOption(status);
    await edit.getByRole('button', { name: 'Save assessment' }).click();
    await expect(ap.getByText('Saved.')).toBeVisible();
  }
  await page.waitForTimeout(1000);
  expect(await told(page.request)).toBe(1);
  expect(await noticeMails()).toBe(1);
  expect(await told(out)).toBe(0);

  // 6. The enrolled student reads it on the Arabic site: English wording, True/False in Arabic.
  await page.goto(`/ar/learn/${slug}`);
  await page.getByRole('link', { name: new RegExp(UPLOADED) }).click();
  await expect(page.getByRole('heading', { level: 1, name: UPLOADED })).toBeVisible();
  await page.getByRole('button', { name: 'ابدأ الاختبار' }).click();
  const tf = page.getByRole('group', { name: /Sheet question 3\?/ });
  await expect(tf.getByLabel('صح')).toBeVisible();
  await expect(tf.getByLabel('خطأ')).toBeVisible();
  await expect(page.getByRole('group', { name: /Sheet question 1\?/ }).getByLabel('Sheet B1')).toBeVisible();

  // 7. The Students tab shows learn page access.
  await ap.goto(`/en/admin/courses/${courseId}?tab=enrolled`);
  await expect(ap.locator('th', { hasText: 'Learn page access' })).toBeVisible();
  await expect(ap.getByRole('row').filter({ hasText: reader.email })).toContainText('Yes');

  await out.dispose();
  await adminContext.close();
  expect(errors).toEqual([]);
});
