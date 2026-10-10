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
  // Chips are visually hidden checkboxes inside their labels.
  await page.getByRole('checkbox', { name: 'LLMOps' }).check({ force: true });
  await page.getByLabel('Proposed session title').fill(TITLE);
  await page.getByLabel('Abstract').fill('Guardrails, evaluation and rollout strategies for LLM features, with a live demo on a real product.');
  await page.getByRole('radio', { name: 'Hands-on' }).check();
  await page.getByRole('radio', { name: 'Arabic', exact: true }).check();
  await page.getByRole('group', { name: /Preferred months/ }).getByRole('checkbox').first().check({ force: true });
  await page.getByRole('button', { name: 'Send application' }).click();
  await page.waitForURL(/\/en\/speaker\?sent=1$/);
  await expect(page.getByText('Under review')).toBeVisible();

  // The team approves.
  const list = await admin.get(`/api/admin/speaker-applications?q=${encodeURIComponent(speaker.email)}`);
  const [application] = (await list.json()) as { id: string }[];
  expect(application).toBeTruthy();
  const review = await admin.post(`/api/admin/speaker-applications/${application!.id}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);

  // Book our slot: title and abstract come prefilled from the application.
  await page.reload();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const slots = await page.request.get('/api/speaker/slots');
  const index = ((await slots.json()) as { id: string }[]).findIndex((s) => s.id === slotId);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Book this slot' }).nth(index).click();
  await expect(page.getByLabel('Proposed session title')).toHaveValue(TITLE);
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
  }[];
  expect(all.find((s) => s.id === slotId)).toMatchObject({ status: 'BOOKED', bookedBy: { email: speaker.email }, event: { status: 'DRAFT' } });
});
