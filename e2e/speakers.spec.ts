import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS } from './support';

/**
 * The speaker portal: someone registers as a speaker, applies, the team approves
 * (through the API here), and the speaker books an open slot, which becomes a draft session.
 */
const stamp = Date.now();
const speaker = { email: `e2e-speaker-${stamp}@example.test`, password: 'e2e-speaker-password', name: `E2E Speaker ${stamp}` };
const TITLE = `Shipping LLM features safely ${stamp}`;

let admin: APIRequestContext;
let slotId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);
  // A slot of our own, far enough ahead to be cancellable, within the 180 days speakers see, and unlikely to clash with another run.
  const startsAt = new Date(Date.now() + (40 + (stamp % 100)) * 86_400_000);
  startsAt.setUTCHours(16, stamp % 60, 0, 0);
  const res = await admin.post('/api/admin/speaking-slots', { headers: JSON_HEADERS, data: { startsAt: startsAt.toISOString(), durationMin: 60 } });
  expect(res.status(), await res.text()).toBe(201);
  slotId = (await res.json()).id;
});

test.afterAll(async () => {
  await admin.dispose();
});

test('a speaker registers, applies, is approved and books a slot', async ({ page }) => {
  // Register with "I'm a speaker" chosen (the link from the speakers page preselects it).
  await page.goto('/en/register?as=speaker');
  await expect(page.getByRole('radio', { name: "I'm a speaker" })).toBeChecked();
  await page.getByLabel('Email').fill(speaker.email);
  await page.getByLabel('Password').fill(speaker.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Speakers skip student onboarding.
  await page.waitForURL(/\/en\/speaker$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Speaker portal' })).toBeVisible();

  // Apply.
  await page.getByRole('link', { name: 'Apply to speak' }).click();
  await page.waitForURL(/\/en\/speaker\/apply$/);
  await page.getByLabel('Full name').fill(speaker.name);
  await page.getByLabel('Phone / WhatsApp').fill('+201001234567');
  await page.getByLabel('LinkedIn profile').fill('https://www.linkedin.com/in/e2e-speaker');
  await page.getByLabel('Current title').fill('Staff ML Engineer');
  await page.getByLabel('Company').fill('Acme');
  await page.getByLabel('Country').selectOption('EG');
  await page.getByLabel('Short bio').fill('Ten years shipping ML systems to production in fintech and telecom.');
  // GitHub is optional. "An MLOps MENA member" asks for the member's name, and requires it.
  await expect(page.getByLabel(/Member's name/)).toHaveCount(0);
  await page.getByLabel('How did you hear about us?').selectOption('MLOPS_MENA_MEMBER');
  await expect(page.getByLabel(/Member's name/)).toBeVisible();
  // Chips are visually hidden checkboxes inside their labels.
  await page.getByRole('checkbox', { name: 'LLMOps' }).check({ force: true });
  // Session, course or podcast: the title's label follows the choice.
  await page.getByRole('radio', { name: 'Podcast' }).first().check();
  await expect(page.getByLabel('Episode title')).toBeVisible();
  await page.getByRole('radio', { name: 'Session', exact: true }).check();
  await page.getByLabel('Session title').fill(TITLE);
  await page.getByLabel('Abstract').fill('Guardrails, evaluation and rollout strategies for LLM features, with a live demo on a real product.');
  await page.getByRole('radio', { name: 'Hands-on' }).check();
  await page.getByRole('radio', { name: 'Arabic', exact: true }).check();
  await page.getByRole('group', { name: /Preferred months/ }).getByRole('checkbox').first().check({ force: true });
  await page.getByRole('button', { name: 'Send application' }).click();
  // The member's name is missing: nothing is sent until it's there.
  await expect(page.getByText('Please fix the highlighted fields.')).toBeVisible();
  await page.getByLabel(/Member's name/).fill('Layla Member');
  await page.getByRole('button', { name: 'Send application' }).click();
  await page.waitForURL(/\/en\/speaker\?sent=1$/);
  await expect(page.getByText('Under review')).toBeVisible();

  // The team approves.
  const list = await admin.get(`/api/admin/speaker-applications?q=${encodeURIComponent(speaker.email)}`);
  const [application] = (await list.json()) as { id: string; referralSource: string; referralMemberName: string; kind: string }[];
  expect(application).toMatchObject({ referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: 'Layla Member', kind: 'SESSION' });
  const review = await admin.post(`/api/admin/speaker-applications/${application!.id}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);

  // Book our slot: title and abstract come prefilled from the application.
  await page.reload();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const slots = await page.request.get('/api/speaker/slots');
  const index = ((await slots.json()) as { id: string }[]).findIndex((s) => s.id === slotId);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Book this slot' }).nth(index).click();
  await expect(page.getByLabel('Session title')).toHaveValue(TITLE);
  // A failed booking shows the API's reason and code, never just "Something went wrong".
  await page.route('**/api/speaker/slots/*/booking', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, code: 'BOOKING_FAILED', message: 'The booking could not be saved (error P2028).' }) })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'BOOKING_FAILED' })).toContainText("couldn't be saved and nothing was booked");
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await page.unroute('**/api/speaker/slots/*/booking');
  // The details are optional; this one says who it's for.
  await page.getByText('Session details (optional)').click();
  await page.getByLabel("Who it's for").fill('ML engineers shipping LLM features');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText("You're booked!")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to Google Calendar' }).first()).toHaveAttribute('href', /calendar\.google\.com/);
  await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible();

  // A draft session exists for the team to finish and publish.
  const all = (await (await admin.get('/api/admin/speaking-slots?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')).json()) as {
    id: string;
    status: string;
    bookedBy: { email: string } | null;
    event: { status: string } | null;
    kind: string | null;
    details: Record<string, unknown>;
  }[];
  expect(all.find((s) => s.id === slotId)).toMatchObject({
    status: 'BOOKED',
    bookedBy: { email: speaker.email },
    event: { status: 'DRAFT' },
    kind: 'SESSION',
    details: { audience: 'ML engineers shipping LLM features' },
  });
  // Until the team publishes it, the speaker can still edit the details.
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();
});
