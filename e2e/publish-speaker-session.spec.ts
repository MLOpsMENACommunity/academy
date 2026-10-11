import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, uiLogin } from './support';

/**
 * A speaker books a slot (through the API here: speakers.spec.ts covers the portal), which
 * makes a draft session. The admin opens it, sees the draft banner, presses Publish (it says
 * what is missing first), and the session appears on the public /sessions page.
 */
const stamp = Date.now();
const speaker = { email: `e2e-pub-spk-${stamp}@example.test`, password: 'e2e-publish-speaker-password' };
const TITLE = `Publishing a speaker session ${stamp}`;

let admin: APIRequestContext;
let eventId: string;

/** Sign-ups are limited per IP and the suite makes many: wait out a 429 rather than fail. */
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
  // A slot of our own, bookable (outside the cancel window) and unlikely to clash with another run.
  const startsAt = new Date(Date.now() + (20 + (stamp % 15)) * 86_400_000);
  startsAt.setUTCHours(15, stamp % 60, 0, 0);
  const slot = await admin.post('/api/admin/speaking-slots', { headers: JSON_HEADERS, data: { startsAt: startsAt.toISOString(), durationMin: 60 } });
  expect(slot.status(), await slot.text()).toBe(201);
  const slotId = (await slot.json()).id as string;

  // The speaker signs up, applies, is approved and books it.
  const spk = await playwrightRequest.newContext({ baseURL: BASE });
  await register(spk, { email: speaker.email, password: speaker.password, role: 'SPEAKER', locale: 'en' });
  const applied = await spk.put('/api/speaker/application', {
    headers: JSON_HEADERS,
    data: {
      fullName: `E2E Publisher ${stamp}`,
      phone: '+201001234567',
      linkedinUrl: 'https://www.linkedin.com/in/e2e-publisher',
      title: 'ML Engineer',
      company: 'Acme',
      country: 'EG',
      bio: 'Ships ML systems to production and writes about it.',
      areas: ['MLOPS'],
      sessionTitle: TITLE,
      abstract: 'From a notebook to a monitored service: packaging, rollout and the checks that keep it healthy.',
      format: 'TALK',
      language: 'EN',
      preferredMonths: [startsAt.toISOString().slice(0, 7)],
      referralSource: 'LINKEDIN',
    },
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const review = await admin.post(`/api/admin/speaker-applications/${(await applied.json()).id}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);
  const booked = await spk.post(`/api/speaker/slots/${slotId}/booking`, {
    headers: JSON_HEADERS,
    data: { title: TITLE, abstract: 'From a notebook to a monitored service: packaging, rollout and the checks that keep it healthy.' },
  });
  expect(booked.status(), await booked.text()).toBe(201);
  await spk.dispose();

  const slots = (await (await admin.get('/api/admin/speaking-slots?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')).json()) as { id: string; event: { id: string; status: string } | null }[];
  const mine = slots.find((s) => s.id === slotId);
  expect(mine?.event?.status).toBe('DRAFT');
  eventId = mine!.event!.id;
});

test.afterAll(async () => {
  await admin.dispose();
});

test('the admin publishes a speaker-booked session with the Publish button, and it appears on /sessions', async ({ page }) => {
  test.setTimeout(240_000);
  await uiLogin(page, ADMIN.email, ADMIN.password);

  // The sessions list counts the drafts and filters to them.
  await page.goto('/en/admin/sessions');
  await page.getByRole('button', { name: /^Drafts/ }).click();
  await expect(page).toHaveURL(/status=DRAFT/);
  await page.getByRole('link', { name: TITLE }).click();

  // The draft banner says it isn't public and what is missing.
  const banner = page.getByRole('region', { name: 'Draft: not visible on the public sessions page.' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('The Arabic title');
  await expect(banner).toContainText('The live link');

  // Publish with something missing explains instead of failing silently, and nothing is published.
  await banner.getByRole('button', { name: 'Publish' }).click();
  await expect(banner.getByRole('alert')).toContainText('Not published yet. Add: The Arabic title · The live link');
  await expect(page.getByRole('textbox', { name: /^Title \(Arabic\)/ })).toBeFocused();

  // Save as a draft: saved, and the page says it's not public yet.
  await page.getByRole('textbox', { name: /^Title \(Arabic\)/ }).fill(`نشر جلسة متحدث ${stamp}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText("Saved as a draft: it's not on the public sessions page yet.")).toBeVisible();

  // Add the Meet link and publish in one step.
  await page.getByRole('textbox', { name: /^Live link/ }).fill('https://meet.google.com/abc-defg-hij');
  await expect(banner).toContainText('Everything it needs is filled in.');
  await banner.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. It shows on the public sessions page within about 2 minutes.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Draft: not visible on the public sessions page.' })).toHaveCount(0);
  const stored = await (await admin.get(`/api/admin/events/${eventId}`)).json();
  expect(stored.status).toBe('PUBLISHED');

  // The speaker hears, with the public link (their newest email, after the booking confirmation).
  await expect(async () => {
    expect(await latestEmail(page.request, speaker.email)).toContain(`/en/sessions/${stored.slug}`);
  }).toPass({ timeout: 30_000 });

  // The public page shows it once its cache window (60 s) has passed.
  const visitor = await page.context().browser()!.newContext();
  const pub = await visitor.newPage();
  await expect(async () => {
    await pub.goto('/en/sessions');
    await expect(pub.getByText(TITLE).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 180_000, intervals: [5_000] });
  await visitor.close();
});
