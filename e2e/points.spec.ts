import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Points and the course leaderboard: two enrolled students earn points; only the one
 * who opts in appears on the board (first name + last initial), the other sees their
 * own standing privately, and the admin's Leaderboard tab lists both.
 */
const stamp = Date.now();
const slug = `e2e-points-${stamp}`;
const password = 'e2e-student-password';
const alpha = { email: `e2e-pts-a-${stamp}@example.test`, name: 'Layla Hassan' };
const beta = { email: `e2e-pts-b-${stamp}@example.test`, name: 'Omar Farouk' };

let admin: APIRequestContext;
let courseId: string;

/** Sign-ups are limited per IP (10 a minute) and the suite signs up many accounts: wait out a 429. */
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

async function enrolledStudent(s: { email: string; name: string }): Promise<{ api: APIRequestContext; id: string }> {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await register(api, { email: s.email, password });
  const html = await latestEmail(api, s.email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: s.name, phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `g.${s.email}`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/points-student', githubUrl: 'https://github.com/points-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false, telegramUsername: 'e2e_student', discordUsername: 'e2e.student' }],
  ];
  for (const [section, data] of sections) {
    const r = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBeTruthy();
  }
  const applied = await api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: slug, answers: {} } });
  expect(applied.ok(), await applied.text()).toBeTruthy();
  const me = await (await api.get('/api/auth/me')).json();
  return { api, id: me.id };
}

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Points Course ${stamp}`,
      titleAr: `دورة النقاط ${stamp}`,
      shortDescriptionEn: 'A course created by the points end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار النقاط.',
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
      learningOutcomes: { en: ['Earn points'], ar: ['اكسب النقاط'] },
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
  // Week 1 started two days ago; the next session is next week.
  const day = 86_400_000;
  const r = await admin.post(`/api/admin/courses/${courseId}/sessions/bulk`, {
    headers: JSON_HEADERS,
    data: {
      sessions: [
        { titleEn: 'Kick-off', titleAr: 'البداية', startsAt: new Date(Date.now() - 2 * day).toISOString(), durationMin: 90 },
        { titleEn: 'Pipelines', titleAr: 'خطوط الإنتاج', startsAt: new Date(Date.now() + 5 * day).toISOString(), durationMin: 90 },
      ],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

test('a student opts in and appears on the course leaderboard; others stay hidden', async ({ browser }) => {
  // Room to wait out the sign-up limit (see register).
  test.setTimeout(240_000);
  const a = await enrolledStudent(alpha);
  const b = await enrolledStudent(beta);
  for (const [s, points] of [
    [a, 20],
    [b, 30],
  ] as const) {
    const r = await admin.post(`/api/admin/students/${s.id}/points`, { headers: JSON_HEADERS, data: { points, reason: 'MANUAL_COMMUNITY', note: 'Helped on Telegram', courseId } });
    expect(r.status(), await r.text()).toBe(201);
  }

  // Student A: nobody is on the board yet; A privately sees where they'd stand, then opts in.
  const ac = await browser.newContext({ storageState: await a.api.storageState() });
  const ap = await ac.newPage();
  const errors: string[] = [];
  ap.on('pageerror', (e) => errors.push(String(e)));
  await ap.goto(`/en/learn/${slug}`);
  const board = ap.getByRole('region', { name: 'Leaderboard' });
  await expect(board.getByText('No one is on the board yet')).toBeVisible();
  await expect(board.getByTestId('my-rank')).toHaveText("You're not on the board. With 20 points you'd be #1. Only you can see this.");
  await board.getByLabel('Show me on the leaderboard').check();
  await expect(board.getByText("You're on the leaderboard.")).toBeVisible();
  const rows = board.getByRole('list', { name: 'Week 1' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Layla H.');
  await expect(rows.first()).toContainText('20 points');
  await expect(board.getByTestId('my-rank')).toHaveText("You're #1 with 20 points.");
  // Whole course: the same, and B (30 points, not opted in) is counted but not named.
  await board.getByRole('button', { name: 'Whole course' }).click();
  await expect(board.getByRole('list', { name: 'Whole course' }).getByRole('listitem')).toHaveCount(1);
  await expect(board.getByText('1 of 2 students take part')).toBeVisible();
  await expect(board).not.toContainText('Omar');
  // The dashboard card shows the points.
  await ap.goto('/en/dashboard');
  await expect(ap.getByTestId('points-total')).toHaveText('20 points');
  expect(errors).toEqual([]);
  await ac.close();

  // Student B sees A on the board, and their own (higher) standing privately.
  const bc = await browser.newContext({ storageState: await b.api.storageState() });
  const bp = await bc.newPage();
  await bp.goto(`/en/learn/${slug}`);
  const bBoard = bp.getByRole('region', { name: 'Leaderboard' });
  await expect(bBoard.getByRole('listitem').filter({ hasText: 'Layla H.' })).toBeVisible();
  await expect(bBoard.getByTestId('my-rank')).toContainText("you'd be #1");
  await expect(bBoard).not.toContainText(alpha.email);
  await bc.close();

  // The admin's Leaderboard tab lists both, B marked Hidden.
  const adminContext = await browser.newContext();
  await adminContext.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email: ADMIN.email, password: ADMIN.password } });
  const adm = await adminContext.newPage();
  await adm.goto(`/en/admin/courses/${courseId}?tab=leaderboard`);
  const table = adm.getByRole('table');
  await expect(table.getByRole('row').filter({ hasText: beta.email })).toContainText('Hidden');
  await expect(table.getByRole('row').filter({ hasText: alpha.email })).toContainText('Shown');
  // A name opens the student's points under Points & badges (the academic preset can't open the admissions student page).
  await table.getByRole('link', { name: alpha.name }).click();
  await expect(adm).toHaveURL(/\/en\/admin\/points\/students\//);
  await expect(adm.getByRole('heading', { level: 1, name: alpha.name })).toBeVisible();
  await expect(adm.locator('#points')).toBeVisible();
  await adminContext.close();
  await a.api.dispose();
  await b.api.dispose();
});
