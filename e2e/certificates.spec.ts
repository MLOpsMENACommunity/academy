import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Certificates: an admin issues a certificate from the course's Certificates tab, the
 * student sees it on the dashboard, and the public verification page shows it as valid
 * (then revoked, at once, after the admin revokes it).
 */
const stamp = Date.now();
const slug = `e2e-cert-${stamp}`;
const TITLE = `E2E Certificate Course ${stamp}`;
const student = { email: `e2e-cert-${stamp}@example.test`, password: 'e2e-student-password', name: `Cert Student ${stamp}` };

let admin: APIRequestContext;
let courseId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const course = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: TITLE,
      titleAr: `دورة الشهادة ${stamp}`,
      shortDescriptionEn: 'A course created by the certificates end-to-end test.',
      shortDescriptionAr: 'دورة أنشأها اختبار الشهادات.',
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
      learningOutcomes: { en: ['Finish the course'], ar: ['إتمام الدورة'] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: true },
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

test('admin issues a certificate; the student sees it; the public page verifies it', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. A student registers, confirms the email, completes the profile and enrols (via the API).
  const api = page.request;
  expect((await api.post('/api/auth/register', { headers: JSON_HEADERS, data: { email: student.email, password: student.password } })).ok()).toBeTruthy();
  const html = await latestEmail(api, student.email);
  const token = /verify-email\?token=([^"&<\s]+)/.exec(html)?.[1];
  expect(token, 'verification token').toBeTruthy();
  expect((await api.post('/api/auth/verify-email', { headers: JSON_HEADERS, data: { token: decodeURIComponent(token!) } })).ok()).toBeTruthy();
  const sections: [string, object][] = [
    ['core', { fullNameEn: student.name, phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME', jobTitle: 'ML Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: `c.${stamp}@gmail.com`, preferredLanguage: 'en', acceptTerms: true }],
    ['professional', { industry: 'TELECOM', mlExperienceYears: 'Y1_3', seniority: 'MID', secondaryAreas: [] }],
    ['education', { educationLevel: 'BACHELORS' }],
    ['links', { linkedinUrl: 'https://www.linkedin.com/in/cert-student', githubUrl: 'https://github.com/cert-student' }],
    ['community', { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: false, shareWithPartners: false, marketingEmails: false }],
  ];
  for (const [section, data] of sections) {
    const r = await api.put(`/api/me/profile/${section}`, { headers: JSON_HEADERS, data });
    expect(r.ok(), `${section}: ${await r.text()}`).toBeTruthy();
  }
  const applied = await api.post('/api/applications', { headers: JSON_HEADERS, data: { courseSlug: slug, answers: {} } });
  expect(applied.ok(), await applied.text()).toBeTruthy();

  // Before issue: the course shows how to earn the certificate.
  await page.goto(`/en/learn/${slug}`);
  await expect(page.getByRole('heading', { name: 'How to earn the certificate' })).toBeVisible();

  // 2. The admin issues it from the Certificates tab (no rule: everyone enrolled is eligible).
  const adminContext = await browser.newContext();
  const ap = await adminContext.newPage();
  await adminContext.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email: ADMIN.email, password: ADMIN.password } });
  await ap.goto(`/en/admin/courses/${courseId}?tab=certificates`);
  await expect(ap.getByRole('tab', { name: 'Certificates' })).toHaveAttribute('aria-selected', 'true');
  await expect(ap.getByText(student.name).first()).toBeVisible();
  await ap.getByRole('button', { name: 'Select all eligible' }).click();
  await ap.getByLabel('Grade (optional)').fill('Distinction');
  await ap.getByRole('button', { name: 'Issue 1 certificate' }).click();
  await expect(ap.getByText('1 certificate issued.')).toBeVisible();
  const serial = (await ap.getByRole('link', { name: /^MMA-\d{4}-/ }).first().textContent())!.trim();
  expect(serial).toMatch(/^MMA-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/);
  await adminContext.close();

  // 3. The student sees it on the dashboard, with the LinkedIn link formed correctly.
  await page.goto('/en/dashboard');
  const card = page.getByRole('region', { name: 'My certificates' });
  await expect(card).toContainText(TITLE);
  await expect(card).toContainText('Valid');
  const linkedIn = new URL((await card.getByRole('link', { name: /Add to LinkedIn/ }).getAttribute('href'))!);
  expect(linkedIn.origin + linkedIn.pathname).toBe('https://www.linkedin.com/profile/add');
  expect(linkedIn.searchParams.get('startTask')).toBe('CERTIFICATION_NAME');
  expect(linkedIn.searchParams.get('certId')).toBe(serial);
  expect(linkedIn.searchParams.get('organizationName')).toBe('MLOps MENA Community');

  // The learn page shows the banner instead of the rule.
  await page.goto(`/en/learn/${slug}`);
  await expect(page.getByRole('heading', { name: 'Your certificate is ready' })).toBeVisible();

  // 4. The public verification page (signed out) says valid.
  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(`/en/certificates/${serial}`);
  await expect(vp.getByText('Valid certificate')).toBeVisible();
  await expect(vp.getByRole('heading', { name: student.name })).toBeVisible();
  await expect(vp.getByText('Distinction')).toBeVisible();
  const pdf = await visitor.request.get(`/api/certificates/${serial}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');

  // 5. Revoked: the next view says so at once.
  const roster = await (await admin.get(`/api/admin/courses/${courseId}/certificates`)).json();
  const certId = roster.rows[0].certificate.id as string;
  expect((await admin.post(`/api/admin/certificates/${certId}/revoke`, { headers: JSON_HEADERS, data: { reason: 'E2E revocation' } })).status()).toBe(204);
  await vp.reload();
  await expect(vp.getByText('This certificate has been revoked')).toBeVisible();
  expect((await visitor.request.get(`/api/certificates/${serial}/pdf`)).status()).toBe(410);
  await visitor.close();

  expect(errors).toEqual([]);
});
