import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, uiLogin } from './support';

/**
 * "Enrol by email": the admin pastes two addresses (one with an account, one without),
 * checks the preview and confirms. The existing student sees the course on their dashboard
 * and can open it; the new address gets an invitation and stays pending.
 */
const stamp = Date.now();
const slug = `e2e-invite-${stamp}`;
const title = `E2E Invite Course ${stamp}`;
const password = 'e2e-student-password';
const existing = `e2e-inv-old-${stamp}@example.test`;
const fresh = `e2e-inv-new-${stamp}@example.test`;

let admin: APIRequestContext;
let student: APIRequestContext;
let courseId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: title,
      titleAr: `دورة الدعوات ${stamp}`,
      shortDescriptionEn: 'A course created by the enrol-by-email end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار التسجيل بالبريد.',
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
      learningOutcomes: { en: ['Join by invitation'], ar: ['الانضمام بدعوة'] },
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

  // A student with a confirmed address and no profile at all: direct enrolment needs neither the form nor a profile.
  student = await playwrightRequest.newContext({ baseURL: BASE });
  expect((await student.post('/api/auth/register', { headers: JSON_HEADERS, data: { email: existing, password } })).ok()).toBeTruthy();
  const html = await latestEmail(student, existing);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await student.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
});

test.afterAll(async () => {
  if (courseId) await admin.post(`/api/admin/courses/${courseId}/archive`, { headers: JSON_HEADERS }).catch(() => undefined);
  await admin.dispose();
  await student.dispose();
});

test('the admin enrols one student and invites one new address; the student sees the course', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en/admin/courses/${courseId}?tab=invites`);
  await expect(page.getByRole('tab', { name: 'Enrol by email' })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('Email addresses').fill(`${existing.toUpperCase()}, Mona <${fresh}>`);
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('table').first();
  await expect(preview.getByRole('row', { name: new RegExp(existing) })).toContainText('Enrol now');
  await expect(preview.getByRole('row', { name: new RegExp(fresh) })).toContainText('Invite');
  await page.getByRole('button', { name: 'Enrol 1 now and invite 1' }).click();
  await expect(page.getByText('Done: 1 enrolled, 1 invited.')).toBeVisible();

  // The list shows both, with what happened.
  await expect(page.getByRole('row', { name: new RegExp(existing) })).toContainText('Enrolled');
  await expect(page.getByRole('row', { name: new RegExp(fresh) })).toContainText('Invited');
  // The new address got an invitation with a sign-up link for this address and course.
  const invite = await latestEmail(admin, fresh);
  // The address is in the fragment (never sent to a server), and prefills the sign-up form.
  const link = `/en/register?returnTo=${encodeURIComponent(`/en/learn/${slug}`)}#email=${encodeURIComponent(fresh)}`;
  expect(invite).toContain(link);
  expect(errors).toEqual([]);
  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(link);
  await expect(vp.locator('input[type="email"]')).toHaveValue(fresh);
  await visitor.close();

  // The existing student: the course is on the dashboard, and the course page opens.
  const ctx = await browser.newContext({ storageState: await student.storageState() });
  const sp = await ctx.newPage();
  await sp.goto('/en/dashboard');
  await expect(sp.getByText(title).first()).toBeVisible();
  await sp.goto(`/en/learn/${slug}`);
  await expect(sp.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // No profile yet: a gentle nudge, not a gate.
  await expect(sp.getByText(/your profile isn't complete yet/)).toBeVisible();
  await ctx.close();
});
