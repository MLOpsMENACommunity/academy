import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, MAILPIT } from './support';

/**
 * Speakers teach their assigned courses: the team assigns an approved speaker to a course; the
 * speaker uploads a quiz from a CSV on their portal and publishes it; the enrolled student is
 * told, takes it, and the speaker sees the score in the gradebook; the speaker grades a lab
 * link with feedback and the student is emailed. Admins see "by {speaker}".
 */
const stamp = Date.now();
const slug = `e2e-teach-${stamp}`;
const title = `E2E Teaching Course ${stamp}`;
const password = 'e2e-speaker-teach-password';
const speaker = { email: `e2e-teach-spk-${stamp}@example.test`, name: `E2E Teacher ${stamp}` };
const studentEmail = `e2e-teach-stu-${stamp}@example.test`;
const QUIZ = `Uploaded week 1 quiz ${stamp}`;
const LAB = `Week 1 lab ${stamp}`;

let admin: APIRequestContext;
let courseId: string;
let instructorId: string;

/** Sign-ups are limited per IP (10 a minute) and the suite signs up many accounts: wait out a 429. */
async function register(ctx: APIRequestContext, data: Record<string, string>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.post('/api/auth/register', { headers: JSON_HEADERS, data });
    if (res.status() !== 429 || attempt >= 3) {
      expect(res.ok(), await res.text()).toBeTruthy();
      return;
    }
    await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after']) || 30) * 1000));
  }
}

const csvOf = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');

test.beforeAll(async () => {
  test.setTimeout(240_000);
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: title,
      titleAr: `دورة التدريس ${stamp}`,
      shortDescriptionEn: 'A course created by the speakers-teach end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار تدريس المتحدثين.',
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
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Learn from the speaker'], ar: ['التعلم من المتحدث'] },
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
  const sessions = await admin.post(`/api/admin/courses/${courseId}/sessions/bulk`, {
    headers: JSON_HEADERS,
    data: { sessions: [{ titleEn: 'Kick-off', titleAr: 'البداية', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), durationMin: 90, liveUrl: 'https://meet.google.com/abc-defg-hij' }] },
  });
  expect(sessions.ok(), await sessions.text()).toBeTruthy();

  // A student with a confirmed address, enrolled directly by the team.
  const student = await playwrightRequest.newContext({ baseURL: BASE });
  await register(student, { email: studentEmail, password });
  const html = await latestEmail(student, studentEmail);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await student.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  await student.dispose();
  const enrol = await admin.post(`/api/admin/courses/${courseId}/invites`, { headers: JSON_HEADERS, data: { entries: [{ email: studentEmail }], sendEmail: false } });
  expect(enrol.ok(), await enrol.text()).toBeTruthy();

  // A speaker account, approved by the team (which creates their public profile), assigned to the course.
  const spk = await playwrightRequest.newContext({ baseURL: BASE });
  await register(spk, { email: speaker.email, password, role: 'SPEAKER' });
  const app = await spk.put('/api/speaker/application', {
    headers: JSON_HEADERS,
    data: {
      fullName: speaker.name,
      phone: '+201001234567',
      linkedinUrl: 'https://www.linkedin.com/in/e2e-teacher',
      title: 'Staff ML Engineer',
      company: 'Acme',
      country: 'EG',
      bio: 'Ten years shipping ML systems to production in fintech and telecom.',
      areas: ['MLOPS'],
      sessionTitle: 'Model monitoring in practice',
      abstract: 'What to monitor once a model is live, how to alert on it, and how to act on drift without panic.',
      format: 'TALK',
      language: 'EN',
      referralSource: 'LINKEDIN',
      preferredMonths: [new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 7)],
    },
  });
  expect(app.ok(), await app.text()).toBeTruthy();
  const applicationId = (await app.json()).id as string;
  await spk.dispose();
  const review = await admin.post(`/api/admin/speaker-applications/${applicationId}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);
  instructorId = ((await review.json()) as { instructor: { id: string } }).instructor.id;
  const assigned = await admin.put(`/api/admin/instructors/${instructorId}/courses/${courseId}`, { headers: JSON_HEADERS });
  expect(assigned.ok(), await assigned.text()).toBeTruthy();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('a speaker uploads and publishes a quiz; the student takes it; the speaker sees the score and grades a lab link', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. The speaker opens the course from My courses.
  await apiLogin(page.request, speaker.email, password);
  await page.goto('/en/speaker');
  const mine = page.getByRole('region', { name: 'My courses', exact: true });
  await expect(mine.getByText(title)).toBeVisible();
  await expect(mine.getByText('1 student')).toBeVisible();
  await mine.getByRole('link', { name: 'Open course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Assessments' })).toHaveAttribute('aria-selected', 'true');

  // 2. A new quiz from a CSV, published at once.
  await page.getByRole('button', { name: '+ New assessment' }).click();
  const form = page.locator('form', { has: page.getByRole('heading', { name: 'New assessment' }) });
  await form.getByRole('textbox', { name: 'Title', exact: true }).fill(QUIZ);
  await form.getByLabel('Max points').fill('10');
  await form.getByLabel('Status').selectOption('PUBLISHED');
  const upload = form.getByRole('region', { name: 'Upload questions from Excel or CSV' });
  const rows = [
    ['type', 'question', 'option1', 'option2', 'option3', 'option4', 'option5', 'option6', 'correct', 'weight', 'explanation'],
    ['single', 'Which tool tracks experiments?', 'MLflow', 'Nginx', '', '', '', '', '1', '1', ''],
    ['true_false', 'Feast is a feature store.', '', '', '', '', '', '', 'true', '1', ''],
  ];
  await upload.locator('input[type=file]').setInputFiles({ name: 'quiz.csv', mimeType: 'text/csv', buffer: Buffer.from(csvOf(rows)) });
  await expect(upload.getByText('2 questions ready')).toBeVisible();
  await upload.getByRole('button', { name: 'Add after the current questions' }).click();
  await expect(form.getByRole('group', { name: 'Question 2' })).toBeVisible();
  await form.getByRole('button', { name: 'Save assessment' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: QUIZ });
  await expect(row).toContainText('2 questions');
  await expect(row).toContainText(`Last edited by ${speaker.name}`);

  // A lab that takes a link, created through the speaker's API.
  const lab = await page.request.post(`/api/speaker/courses/${courseId}/assessments`, {
    headers: JSON_HEADERS,
    data: { type: 'LAB', status: 'PUBLISHED', titleEn: LAB, submissionKind: 'LINK', maxPoints: 20 },
  });
  expect(lab.status(), await lab.text()).toBe(201);
  const labId = (await lab.json()).id as string;

  // 3. The student is told (in-app and by email), takes the quiz and hands in the lab.
  const studentContext = await browser.newContext();
  const sp = await studentContext.newPage();
  sp.on('pageerror', (e) => errors.push(String(e)));
  await apiLogin(sp.request, studentEmail, password);
  const told = async () => ((await (await sp.request.get('/api/notifications')).json()) as { items: { titleEn: string }[] }).items.filter((n) => n.titleEn === `New quiz: ${QUIZ}`).length;
  await expect.poll(told).toBe(1);
  const noticeMails = async () =>
    ((await (await sp.request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${studentEmail}" subject:"New quiz"`)}`)).json()) as { messages?: unknown[] }).messages?.length ?? 0;
  await expect.poll(noticeMails).toBe(1);

  await sp.goto(`/en/learn/${slug}`);
  await sp.getByRole('link', { name: new RegExp(QUIZ) }).click();
  await sp.getByRole('button', { name: 'Start the quiz' }).click();
  await sp.getByRole('group', { name: /Which tool tracks experiments/ }).getByLabel('MLflow').check();
  await sp.getByRole('group', { name: /Feast is a feature store/ }).getByLabel('False').check();
  await sp.getByRole('button', { name: 'Review and submit' }).click();
  await sp.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(sp.getByRole('region', { name: 'Your result' })).toContainText('5/10');
  const handIn = await sp.request.post(`/api/learn/${slug}/assessments/${labId}/submission`, { headers: JSON_HEADERS, data: { url: 'https://github.com/e2e-student/week1-lab', attested: true } });
  expect(handIn.ok(), await handIn.text()).toBeTruthy();

  // 4. The speaker's gradebook shows the quiz score, then they grade the lab with feedback.
  await page.getByRole('tab', { name: 'Gradebook' }).click();
  await page.getByRole('button', { name: `Gradebook: ${QUIZ}` }).click();
  await expect(page.getByRole('heading', { level: 2, name: `Gradebook: ${QUIZ}` })).toBeVisible();
  const studentRow = page.getByRole('row').filter({ hasText: studentEmail });
  await expect(studentRow).toContainText('5/10');
  await expect(studentRow).toContainText('Graded');
  await page.getByRole('button', { name: 'All assessments' }).click();
  await page.getByRole('button', { name: `Gradebook: ${LAB}` }).click();
  await page.getByRole('row').filter({ hasText: studentEmail }).getByRole('button', { name: /^Open/ }).click();
  await expect(page.getByRole('link', { name: /github\.com\/e2e-student\/week1-lab/ }).first()).toBeVisible();
  await page.getByLabel('Score (out of 20)').fill('17');
  await page.getByLabel('Feedback for the student').fill('Clear README. Add tests for the data loader.');
  await page.getByRole('button', { name: 'Save grade' }).click();
  await expect(page.getByText('Grade saved. The student was notified.')).toBeVisible();
  await expect(page.getByText(`Graded by ${speaker.name}`)).toBeVisible();

  // The student is emailed and sees the feedback.
  await expect.poll(async () => latestEmail(sp.request, studentEmail), { timeout: 30_000 }).toContain('17');
  await sp.goto(`/en/learn/${slug}/assessments/${labId}`);
  await expect(sp.getByText('Clear README. Add tests for the data loader.')).toBeVisible();
  await studentContext.close();

  // 5. The admin sees who graded it.
  const adminContext = await browser.newContext();
  await adminContext.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email: ADMIN.email, password: ADMIN.password } });
  const book = (await (await adminContext.request.get(`/api/admin/assessments/${labId}/submissions`)).json()) as { rows: { email: string; gradedBy: string | null }[] };
  expect(book.rows.find((r) => r.email === studentEmail)?.gradedBy).toBe(speaker.name);
  await adminContext.close();

  // 6. Removing the speaker from the course closes it at once.
  expect((await admin.delete(`/api/admin/instructors/${instructorId}/courses/${courseId}`, { headers: JSON_HEADERS })).ok()).toBeTruthy();
  expect((await page.request.get(`/api/speaker/courses/${courseId}/assessments`)).status()).toBe(403);
  await page.reload();
  await expect(page.getByText("You aren't assigned to this course")).toBeVisible();

  expect(errors).toEqual([]);
});
