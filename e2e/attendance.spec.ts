import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Attendance from Google Meet: a teaching speaker uploads the session's Meet attendance CSV,
 * checks the preview (one guest isn't matched and is ignored), saves; the student sees
 * "Present" on their learn page and the attendance points on the course leaderboard.
 * Every name and address is made up.
 */
const stamp = Date.now();
const slug = `e2e-attend-${stamp}`;
const title = `E2E Attendance Course ${stamp}`;
const password = 'e2e-attendance-password';
const speaker = { email: `e2e-att-spk-${stamp}@example.test`, name: `E2E Att Speaker ${stamp}` };
const studentEmail = `e2e-att-stu-${stamp}@example.test`;

let admin: APIRequestContext;
let courseId: string;

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
      titleAr: `دورة الحضور ${stamp}`,
      shortDescriptionEn: 'A course created by the attendance end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار الحضور.',
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
      learningOutcomes: { en: ['Show up'], ar: ['الحضور'] },
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
  // A session that already happened (an hour long), so this week's board has its points.
  const sessions = await admin.post(`/api/admin/courses/${courseId}/sessions/bulk`, {
    headers: JSON_HEADERS,
    data: { sessions: [{ titleEn: 'Kick-off', titleAr: 'البداية', startsAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), durationMin: 60, liveUrl: 'https://meet.google.com/abc-defg-hij' }] },
  });
  expect(sessions.ok(), await sessions.text()).toBeTruthy();

  const student = await playwrightRequest.newContext({ baseURL: BASE });
  await register(student, { email: studentEmail, password });
  const html = await latestEmail(student, studentEmail);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await student.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  await student.dispose();
  const enrol = await admin.post(`/api/admin/courses/${courseId}/invites`, { headers: JSON_HEADERS, data: { entries: [{ email: studentEmail }], sendEmail: false } });
  expect(enrol.ok(), await enrol.text()).toBeTruthy();

  const spk = await playwrightRequest.newContext({ baseURL: BASE });
  await register(spk, { email: speaker.email, password, role: 'SPEAKER' });
  const app = await spk.put('/api/speaker/application', {
    headers: JSON_HEADERS,
    data: {
      fullName: speaker.name,
      phone: '+201001234567',
      linkedinUrl: 'https://www.linkedin.com/in/e2e-att-speaker',
      title: 'Staff ML Engineer',
      company: 'Acme',
      country: 'EG',
      bio: 'Ten years shipping ML systems to production in fintech and telecom.',
      areas: ['MLOPS'],
      sessionTitle: 'Attendance in practice',
      abstract: 'Who came, for how long, and what it is worth: a talk that exists only for a test.',
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
  const instructorId = ((await review.json()) as { instructor: { id: string } }).instructor.id;
  const assigned = await admin.put(`/api/admin/instructors/${instructorId}/courses/${courseId}`, { headers: JSON_HEADERS });
  expect(assigned.ok(), await assigned.text()).toBeTruthy();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('a speaker uploads a Meet CSV, previews and saves; the student sees Present and the points', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await apiLogin(page.request, speaker.email, password);
  await page.goto(`/en/speaker/courses/${courseId}`);
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await page.getByRole('button', { name: /1\. Kick-off/ }).click();
  await expect(page.getByText('Nothing recorded yet.')).toBeVisible();

  // The Google Workspace report: the student (rejoined once) and a guest nobody knows.
  const csv = [
    'First name,Last name,Email,Duration,Time joined,Time exited',
    `Sam,Student,${studentEmail.toUpperCase()},40 min,7:00 PM,7:40 PM`,
    `Sam,Student,${studentEmail},15 min,7:45 PM,8:00 PM`,
    'Guest,Visitor,guest-visitor@example.test,1 hr,7:00 PM,8:00 PM',
  ].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'meet-attendance.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Preview: meet-attendance.csv')).toBeVisible();
  const unmatched = page.getByRole('region', { name: 'Not matched to a student (1)' });
  await expect(unmatched).toContainText('Guest Visitor');
  await unmatched.getByRole('button', { name: 'Ignore' }).click();
  await expect(unmatched).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: studentEmail });
  await expect(row).toContainText('55');
  await expect(row).toContainText('92%');
  await expect(row.getByRole('combobox')).toHaveValue('PRESENT');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Saved: 1 present, 0 partial, 0 absent.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recorded attendance' })).toBeVisible();

  // The student: "Present" on the session, and the points on the course leaderboard.
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  sp.on('pageerror', (e) => errors.push(String(e)));
  await apiLogin(sp.request, studentEmail, password);
  await sp.goto(`/en/learn/${slug}`);
  await expect(sp.getByText('Present · 55 min')).toBeVisible();
  const board = sp.getByRole('region', { name: 'Leaderboard' });
  await expect(board).toContainText('10 points');
  await ctx.close();
  expect(errors).toEqual([]);
});
