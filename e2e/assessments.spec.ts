import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

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
  await form.getByLabel('Title (English)').fill(QUIZ);
  await form.getByLabel('Title (Arabic)').fill('اختبار المراجعة');
  await form.getByLabel('Max points').fill('10');
  await form.getByLabel('Attempts allowed').fill('1');
  const question = async (n: number, en: string, weight: string, options: [string, string]) => {
    await form.getByRole('button', { name: '+ Add question' }).click();
    const q = form.getByRole('group', { name: `Question ${n}` });
    await q.getByLabel('Question (English)').fill(en);
    await q.getByLabel('Question (Arabic)').fill(`${en} (ar)`);
    await q.getByLabel('Weight (points)').fill(weight);
    for (const [i, label] of options.entries()) {
      await q.getByLabel(`Option ${i + 1} (English)`).fill(label);
      await q.getByLabel(`Option ${i + 1} (Arabic)`).fill(`${label} (ar)`);
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
  const api = page.request;
  expect((await api.post('/api/auth/register', { headers: JSON_HEADERS, data: { email: student.email, password: student.password } })).ok()).toBeTruthy();
  const html = await latestEmail(api, student.email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: 'Quiz Student', phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `q.${stamp}@gmail.com`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/quiz-student', githubUrl: 'https://github.com/quiz-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false }],
  ];
  for (const [section, data] of sections) {
    const r = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBeTruthy();
  }
  const applied = await api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: slug, answers: {} } });
  expect(applied.ok(), await applied.text()).toBeTruthy();
  expect((await applied.json()).status).toBe('ENROLLED');

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
