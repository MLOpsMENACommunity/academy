import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail } from './support';

/**
 * Speakers study too: someone who signed up as a speaker clicks Apply on a course page and
 * goes through the student profile and the application, instead of being sent back to the
 * speaker portal. Their home stays the portal, which (like the header menu) then links to
 * "My learning".
 */
const stamp = Date.now();
const slug = `e2e-spk-learn-${stamp}`;
const speaker = {
  email: `e2e-spk-learn-${stamp}@example.test`,
  password: 'e2e-speaker-password',
  name: `E2E Learning Speaker ${stamp}`,
};
const QUESTION = 'Why this course?';

let admin: APIRequestContext;
let courseId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  const res = await admin.post('/api/admin/courses', {
    headers: JSON_HEADERS,
    data: {
      slug,
      titleEn: `E2E Speaker Learns ${stamp}`,
      titleAr: `دورة المتحدث المتعلم ${stamp}`,
      shortDescriptionEn: 'A free course a speaker applies to in the end-to-end test.',
      shortDescriptionAr: 'دورة مجانية يقدّم عليها متحدث في الاختبار.',
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
      targetAudience: { en: '', ar: '' },
      notFor: { en: '', ar: '' },
      learningOutcomes: { en: [], ar: [] },
      prerequisites: { en: [], ar: [] },
      outline: [],
      faq: [],
      included: {
        liveSessions: true,
        recordings: true,
        assignments: false,
        finalProject: false,
        certificate: false,
      },
      deliveryPlatform: 'GOOGLE_MEET',
      recordingsPlatform: 'YOUTUBE',
      driveFolderUrl: null,
      youtubePlaylistUrl: null,
      instructorIds: [],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  courseId = (await res.json()).id;
  const q = await admin.put(`/api/admin/courses/${courseId}/questions`, {
    headers: JSON_HEADERS,
    data: {
      questions: [
        { type: 'SHORT_TEXT', labelEn: QUESTION, labelAr: 'لماذا هذه الدورة؟', required: true },
      ],
    },
  });
  expect(q.ok(), await q.text()).toBeTruthy();
});

test.afterAll(async () => {
  // Keep the catalog clean for the next run.
  if (courseId)
    await admin
      .put(`/api/admin/courses/${courseId}`, {
        headers: JSON_HEADERS,
        data: {
          ...(await (await admin.get(`/api/admin/courses/${courseId}`)).json()),
          status: 'ARCHIVED',
        },
      })
      .catch(() => undefined);
  await admin.dispose();
});

test('a speaker clicks Apply on a course, completes the profile and submits, and keeps the speaker portal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Sign up as a speaker: the home is the speaker portal, which says speakers can study too.
  await page.goto('/en/register?as=speaker');
  await expect(page.getByRole('radio', { name: "I'm a speaker" })).toBeChecked();
  await page.getByLabel('Email').fill(speaker.email);
  await page.getByLabel('Password').fill(speaker.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/en\/speaker$/);
  await expect(page.getByText('Speakers can study too')).toBeVisible();
  // Nothing to learn yet: no "My learning" in the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Speaker portal' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'My learning' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Confirm the email from the inbox.
  const html = await latestEmail(page.request, speaker.email);
  const link = html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/)?.[1];
  expect(link, 'verification link').toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, '&'));
  await expect(page.getByText('Your email is confirmed.')).toBeVisible();

  // Apply on the course page: the Apply page, not the speaker portal or the speaker application.
  await page.goto(`/en/courses/${slug}`);
  await page.getByRole('link', { name: 'Apply now' }).first().click();
  await page.waitForURL(new RegExp(`/en/courses/${slug}/apply`));
  await expect(page).not.toHaveURL(/\/speaker/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `E2E Speaker Learns ${stamp}`,
  );

  // The same profile as a student, before applying.
  await page.getByRole('link', { name: 'Complete my profile' }).click();
  await page.waitForURL(/\/en\/onboarding\?returnTo=/);
  await page.getByLabel('Full name (English)').fill(speaker.name);
  await page.getByLabel('Phone / WhatsApp').fill('01001234567');
  await page.getByLabel('Google account email').fill(`e2e.spk.${stamp}@gmail.com`);
  await page.getByLabel('Country of residence').selectOption('EG');
  await page.getByLabel('City').fill('Cairo');
  await page.getByLabel('Current employment status').selectOption('EMPLOYED_FULL_TIME');
  await page.getByLabel('Current job title').fill('Staff ML Engineer');
  await page.getByLabel('Total professional experience').selectOption('Y3_5');
  await page.getByLabel('Primary area').selectOption('MLOPS');
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 2 of 7')).toBeVisible();
  await page.getByLabel('Experience in ML/AI specifically').selectOption('Y1_3');
  await page.getByLabel('Seniority level').selectOption('MID');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 3 of 7')).toBeVisible();
  await page.getByLabel('Highest degree').selectOption('BACHELORS');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 4 of 7')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'LinkedIn', exact: true })
    .fill('https://www.linkedin.com/in/e2e-learning-speaker');
  await page
    .getByRole('textbox', { name: 'GitHub', exact: true })
    .fill('https://github.com/e2e-learning-speaker');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 5 of 7')).toBeVisible();
  await page.getByLabel(/How did you hear about us/).selectOption('LINKEDIN');
  for (const q of [/member of the community/, /Email me about new courses/]) {
    await page.getByRole('radiogroup', { name: q }).getByLabel('No').check();
  }
  // The Telegram and Discord usernames are required, as for students.
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('This field is required.')).toHaveCount(2);
  // The first invalid field takes focus; wait for it so it can't steal the next keystrokes.
  await expect(page.getByLabel('Telegram username')).toBeFocused();
  await page.getByLabel('Telegram username').fill('@e2e_speaker');
  await page.getByLabel('Discord username').fill('E2E.Speaker');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 6 of 7')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByText('Step 7 of 7')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('link', { name: 'Continue to the course' }).click();

  // Back on the Apply page: answer and submit.
  await page.waitForURL(new RegExp(`/en/courses/${slug}/apply`));
  await page.getByLabel(QUESTION).fill('To learn how teams run models in production.');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await page.waitForURL(/\/en\/dashboard\/applications\//);

  // The account menu now has "My learning" next to the speaker portal.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Speaker portal' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'My learning' }).click();
  await page.waitForURL(/\/en\/dashboard$/);
  await expect(page.getByText(`E2E Speaker Learns ${stamp}`).first()).toBeVisible();

  // The speaker portal still works, and links to "My learning".
  await page.goto('/en/speaker');
  await expect(page.getByRole('heading', { level: 1, name: 'Speaker portal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply to speak' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to my courses' }).click();
  await page.waitForURL(/\/en\/dashboard$/);

  // Admins see the application with the others.
  const list = await (await admin.get(`/api/admin/applications?courseId=${courseId}`)).json();
  expect(JSON.stringify(list)).toContain(speaker.email);
  expect(errors).toEqual([]);
});
