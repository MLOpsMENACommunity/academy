import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, apiLogin, BASE, emailWithSubject, JSON_HEADERS, latestEmail, runJobsTick, sql } from './support';

/**
 * Feedback emails after every session: the hourly tick asks each student once (in-app and
 * email), the email's button opens the session's rating form (through sign-in), the
 * dashboard shows "Rate your last session", the per-course "stop feedback emails" link
 * works without signing in, and the last session's email also asks for the course rating.
 *
 * SHOTS=<dir> saves screenshots of the email (en/ar), the dashboard card and the opt-out
 * page at 390 px and 1280 px.
 */
const stamp = Date.now();
const slug = `e2e-feedback-${stamp}`;
const password = 'e2e-student-password';
const student = { email: `e2e-fb-${stamp}@example.test`, name: 'Mona Adel' };
const HOUR = 3_600_000;
const SHOTS = process.env.SHOTS;

let admin: APIRequestContext;
let courseId: string;

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${SHOTS}/fb1a-${name}-${width}.png`, fullPage: true });
  }
}

/** Sign-ups are limited per IP: wait out a 429 (see points.spec.ts). */
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

test.beforeAll(async () => {
  test.setTimeout(240_000);
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `MLOps Feedback ${stamp}`,
      titleAr: `تقييم MLOps ${stamp}`,
      shortDescriptionEn: 'A course created by the feedback end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار التقييم.',
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
      durationWeeks: 3,
      hoursPerWeek: 2,
      coverImageUrl: null,
      targetAudience: { en: 'Engineers', ar: 'المهندسون' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: ['Give feedback'], ar: ['قدّم رأيك'] },
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
  await admin.put(`/api/admin/courses/${courseId}/questions`, { headers: JSON_HEADERS, data: { questions: [] } });
  // Session 1 ended two hours ago; sessions 2 and 3 are next week.
  const r = await admin.post(`/api/admin/courses/${courseId}/sessions/bulk`, {
    headers: JSON_HEADERS,
    data: {
      sessions: [
        { titleEn: 'Feature stores', titleAr: 'مخازن الميزات', startsAt: new Date(Date.now() - 3.5 * HOUR).toISOString(), durationMin: 90 },
        { titleEn: 'Model serving', titleAr: 'خدمة النماذج', startsAt: new Date(Date.now() + 7 * 24 * HOUR).toISOString(), durationMin: 90 },
        { titleEn: 'Monitoring', titleAr: 'المراقبة', startsAt: new Date(Date.now() + 8 * 24 * HOUR).toISOString(), durationMin: 90 },
      ],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();

  // One student through the API: sign up, confirm, profile, apply (free, no approval: enrolled).
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  await register(api, { email: student.email, password });
  const token = /verify-email\?token=([^"&<\s]+)/.exec(await latestEmail(api, student.email))?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: student.name, phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `g.${student.email}`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/feedback-student', githubUrl: 'https://github.com/feedback-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false, telegramUsername: 'e2e_student', discordUsername: 'e2e.student' }],
  ];
  for (const [section, data] of sections) {
    const res = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(res.ok(), `${section}: ${await res.text()}`).toBeTruthy();
  }
  const applied = await api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: slug, answers: {} } });
  expect(applied.ok(), await applied.text()).toBeTruthy();
  await api.dispose();
  // Fixture: they enrolled two days ago, before session 1 (the API can't backdate an enrolment).
  sql(`UPDATE "Enrollment" SET "enrolledAt" = (now() AT TIME ZONE 'UTC') - interval '2 days' WHERE "courseId" = '${courseId}'`);
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
});

/** Renders an email's HTML in the browser for a screenshot. */
async function shootEmail(page: Page, html: string, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(html);
    await page.screenshot({ path: `${SHOTS}/fb1a-${name}-${width}.png`, fullPage: true });
  }
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));

test('feedback email after a session → rating form through sign-in, dashboard card, opt-out without sign-in, combined email at the end', async ({ browser }) => {
  test.setTimeout(240_000);
  const anon = await playwrightRequest.newContext({ baseURL: BASE });

  // The hourly tick asks once: an email and an in-app notification.
  const first = await runJobsTick(anon);
  expect(first.feedbackPromptsQueued).toBeGreaterThanOrEqual(1);
  const mail = await emailWithSubject(anon, student.email, 'How was "Feature stores"?');
  expect(mail.subject).toBe('How was "Feature stores"? Rate it in 10 seconds');
  expect(mail.html).not.toMatch(/today|tonight/i);
  const rate = hrefs(mail.html).find((h) => h.endsWith(`/en/learn/${slug}#session-1-feedback`));
  const stop = hrefs(mail.html).find((h) => h.includes('/en/unsubscribe?token='));
  expect(rate, 'rate link').toBeTruthy();
  expect(mail.html).toContain('/en/unsubscribe?token=');
  expect(sql(`SELECT count(*) FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u.email = '${student.email}' AND n.type = 'feedback.prompt'`)).toBe('1');
  // A second tick asks nothing new.
  await runJobsTick(anon);
  expect(sql(`SELECT count(*) FROM "OutboundEmail" o JOIN "User" u ON u.id = o."userId" WHERE u.email = '${student.email}' AND o.category = 'feedback'`)).toBe('1');
  expect(sql(`SELECT status FROM "OutboundEmail" o JOIN "User" u ON u.id = o."userId" WHERE u.email = '${student.email}' AND o.category = 'feedback'`)).toBe('SENT');

  const shots = await browser.newPage();
  await shootEmail(shots, mail.html, 'email-en');

  // The button, signed out: sign-in keeps the #session-1-feedback and lands on the open form.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(rate!.replace(/^https?:\/\/[^/]+/, ''));
  await page.waitForURL(/\/en\/login\?returnTo=/);
  await page.getByLabel('Email').fill(student.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(new RegExp(`/en/learn/${slug}#session-1-feedback$`));
  const form = page.locator('#session-1-feedback');
  await expect(form.getByRole('group', { name: 'How was this session?' })).toBeVisible();
  await expect(form).toBeInViewport();
  await expect(form.getByRole('radio').first()).toBeFocused();

  // The dashboard asks too, until it's rated.
  await page.goto('/en/dashboard');
  const card = page.getByRole('region', { name: 'Rate your last session' });
  await expect(card).toContainText('Session 1: Feature stores');
  await shoot(page, 'dashboard-card-en');
  await card.getByRole('link', { name: /Rate it/ }).click();
  await page.waitForURL(new RegExp(`#session-1-feedback$`));
  await form.getByRole('radio', { name: /4/ }).check({ force: true });
  await form.getByRole('button', { name: 'Send feedback' }).click();
  await expect(form.getByRole('status')).toHaveText('Thanks for your feedback!');
  await page.goto('/en/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Rate your last session' })).toHaveCount(0);
  await page.goto('/ar/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // "Stop feedback emails", from a browser that isn't signed in.
  const out = await (await browser.newContext()).newPage();
  await out.goto(stop!.replace(/^https?:\/\/[^/]+/, ''));
  await expect(out.getByText(/Stop the "How was the session\?" emails for MLOps Feedback/)).toBeVisible();
  await shoot(out, 'optout-en');
  await out.getByRole('button', { name: 'Stop these emails' }).click();
  await expect(out.getByText(/won't get feedback emails for MLOps Feedback/)).toBeVisible();
  await shoot(out, 'optout-done-en');
  await out.goto(stop!.replace(/^https?:\/\/[^/]+/, '').replace('/en/', '/ar/'));
  await expect(out.getByText(/لن تصلك رسائل التقييم/)).toBeVisible();
  await shoot(out, 'optout-done-ar');

  // Session 2 ends: still asked in-app, but no email.
  sql(`UPDATE "CourseSession" SET "startsAt" = (now() AT TIME ZONE 'UTC') - interval '3 hours' WHERE "courseId" = '${courseId}' AND "order" = 2`);
  await runJobsTick(anon);
  expect(sql(`SELECT o.status || ':' || o."lastError" FROM "OutboundEmail" o JOIN "CourseSession" s ON o."dedupeKey" = 'feedback:' || s.id || ':' || o."userId" WHERE s."courseId" = '${courseId}' AND s."order" = 2`)).toBe('SKIPPED:opted_out');
  expect(sql(`SELECT count(*) FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u.email = '${student.email}' AND n.type = 'feedback.prompt'`)).toBe('2');

  // Turned back on, in Arabic now; the last session's email asks for the session and the course.
  await out.getByRole('button', { name: 'أعد تشغيلها' }).click();
  await expect(out.getByText(/أُعيد تشغيلها/)).toBeVisible();
  sql(`UPDATE "User" SET locale = 'ar' WHERE email = '${student.email}'`);
  sql(`UPDATE "CourseSession" SET "startsAt" = (now() AT TIME ZONE 'UTC') - interval '2 hours', "durationMin" = 60 WHERE "courseId" = '${courseId}' AND "order" = 3`);
  await runJobsTick(anon);
  const last = await emailWithSubject(anon, student.email, 'المراقبة');
  expect(last.subject).toBe(`كيف كانت «المراقبة» ودورة تقييم MLOps ${stamp}؟`);
  expect(hrefs(last.html)).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`/ar/learn/${slug}#session-3-feedback$`)), expect.stringMatching(new RegExp(`/ar/learn/${slug}#course-feedback$`))]));
  await shootEmail(shots, last.html, 'email-ar');

  // The Arabic dashboard card offers the last session and the course.
  await page.goto('/ar/dashboard');
  const arCard = page.getByRole('region', { name: 'قيّم جلستك الأخيرة' });
  await expect(arCard).toContainText('الجلسة 3: المراقبة');
  await expect(arCard).toContainText('قيّم الدورة أيضًا');
  await shoot(page, 'dashboard-card-ar');
  await page.goto(`/ar/learn/${slug}#course-feedback`);
  await expect(page.locator('#course-feedback')).toBeInViewport();

  expect(errors).toEqual([]);
  await ctx.close();
  await anon.dispose();
});
