import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Speakers send announcements: the team approves a speaker and assigns them to a course
 * (Admin → Speakers → {speaker} → Assigned courses); the speaker writes an announcement on
 * their portal, reviews the audience and sends it; an enrolled student sees it, "From" the
 * speaker, on the course's learning page and in their inbox.
 */
const stamp = Date.now();
const slug = `e2e-spk-ann-${stamp}`;
const title = `E2E Speaker Course ${stamp}`;
const password = 'e2e-speaker-ann-password';
const speaker = { email: `e2e-spk-ann-${stamp}@example.test`, name: `E2E Announcer ${stamp}` };
const studentEmail = `e2e-spk-ann-stu-${stamp}@example.test`;
const SUBJECT = `Slides and repo for week 1 ${stamp}`;

let admin: APIRequestContext;
let courseId: string;
let instructorId: string;

/**
 * Sign-ups are limited per IP (10 a minute) and the suite signs up many accounts: wait out
 * a 429 rather than fail. (This file is named to run after speakers.spec.ts, which signs up through the form, for the same reason.)
 */
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

test.beforeAll(async () => {
  test.setTimeout(240_000);
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: title,
      titleAr: `دورة المتحدث ${stamp}`,
      shortDescriptionEn: 'A course created by the speaker announcements end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار إعلانات المتحدثين.',
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
      learningOutcomes: { en: ['Hear from the speaker'], ar: ['الاستماع إلى المتحدث'] },
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
  const sessions = await admin.post(`/api/admin/courses/${courseId}/sessions/bulk`, {
    headers: JSON_HEADERS,
    data: { sessions: [{ titleEn: 'Kick-off', titleAr: 'البداية', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), durationMin: 90 }] },
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

  // A speaker account, approved by the team (which creates their public profile).
  const spk = await playwrightRequest.newContext({ baseURL: BASE });
  await register(spk, { email: speaker.email, password, role: 'SPEAKER' });
  const app = await spk.put('/api/speaker/application', {
    headers: JSON_HEADERS,
    data: {
      fullName: speaker.name,
      phone: '+201001234567',
      linkedinUrl: 'https://www.linkedin.com/in/e2e-announcer',
      title: 'Staff ML Engineer',
      company: 'Acme',
      country: 'EG',
      bio: 'Ten years shipping ML systems to production in fintech and telecom.',
      areas: ['MLOPS'],
      sessionTitle: 'Feature stores in practice',
      abstract: 'What a feature store buys you, what it costs, and how to run one in production without regret.',
      format: 'TALK',
      language: 'EN',
      preferredMonths: [new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 7)],
    },
  });
  expect(app.ok(), await app.text()).toBeTruthy();
  const applicationId = (await app.json()).id as string;
  await spk.dispose();
  const review = await admin.post(`/api/admin/speaker-applications/${applicationId}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);
  instructorId = ((await review.json()) as { instructor: { id: string } }).instructor.id;
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('the team assigns a speaker to a course; the speaker sends an announcement; the student sees it', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Admin → Speakers → {speaker} → Assigned courses.
  await apiLogin(page.request, ADMIN.email, ADMIN.password);
  await page.goto(`/en/admin/speakers/${instructorId}`);
  await expect(page.getByRole('heading', { name: 'Assigned courses' })).toBeVisible();
  await expect(page.getByText(`Speaker account: ${speaker.email}`)).toBeVisible();
  await expect(page.getByText('Not assigned to any course yet.')).toBeVisible();
  await page.getByRole('combobox', { name: /Course to assign/ }).selectOption({ label: `${title} · Open` });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.context().clearCookies();

  // The speaker writes, reviews and sends.
  await apiLogin(page.request, speaker.email, password);
  await page.goto('/en/speaker');
  await expect(page.getByRole('heading', { name: 'My courses & sessions' })).toBeVisible();
  await expect(page.getByText('1 enrolled student')).toBeVisible();
  await page.getByRole('button', { name: 'Write an announcement' }).click();
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(SUBJECT);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Thanks for joining!\n\nSlides: https://example.test/slides');
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(page.getByText('Send to 1 person?')).toBeVisible();
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText(/Sent to 1 person/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sent announcements' })).toBeVisible();
  await expect(page.getByText(SUBJECT)).toBeVisible();

  // The student sees it on the learning page, from the speaker.
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  student.on('pageerror', (e) => errors.push(String(e)));
  await apiLogin(student.request, studentEmail, password);
  await student.goto(`/en/learn/${slug}`);
  const item = student.getByRole('listitem').filter({ hasText: SUBJECT });
  await expect(item).toBeVisible();
  await expect(item).toContainText(`From ${speaker.name}`);
  await expect(item.getByRole('link', { name: 'https://example.test/slides' })).toBeVisible();
  await studentContext.close();

  // And by email (bulk lane), with the speaker's name.
  const html = await latestEmail(admin, studentEmail);
  expect(html).toContain(SUBJECT);
  expect(html).toContain(`From ${speaker.name}`);
  expect(errors).toEqual([]);
});
