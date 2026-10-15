import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, apiLogin, BASE, JSON_HEADERS, latestEmail, uiLogin } from './support';

/**
 * Audit regressions in the browser: an academic admin opens a session a speaker booked. They
 * see who booked it, but not the link to Speakers → Availability, which their preset can't open
 * (SPK-10); deleting the session asks them to release the booking instead (SPK-03).
 */
const stamp = Date.now();
const academic = { email: `e2e-academic-${stamp}@example.test`, password: 'e2e-academic-password' };
const speaker = { email: `e2e-aud-speaker-${stamp}@example.test`, password: 'e2e-aud-speaker-password' };
const TITLE = `Audit booked session ${stamp}`;

let admin: APIRequestContext;
let speakerApi: APIRequestContext;
let eventId: string;

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(admin, ADMIN.email, ADMIN.password);

  // An academic admin, who chooses their password from the welcome email.
  const added = await admin.post('/api/admin/team', { headers: JSON_HEADERS, data: { email: academic.email, permissions: ['ACADEMIC'] } });
  expect(added.status(), await added.text()).toBe(201);
  const token = /reset-password\?token=([\w-]+)/.exec(await latestEmail(admin, academic.email))?.[1];
  // In a context of its own: the answer clears the session cookies of whoever sends it.
  const anon = await playwrightRequest.newContext({ baseURL: BASE });
  const reset = await anon.post('/api/auth/reset-password', { headers: JSON_HEADERS, data: { token, password: academic.password } });
  expect(reset.status(), await reset.text()).toBeLessThan(300);
  await anon.dispose();

  // A speaker, approved, books a slot: a draft session.
  speakerApi = await playwrightRequest.newContext({ baseURL: BASE });
  const reg = await speakerApi.post('/api/auth/register', { headers: JSON_HEADERS, data: { email: speaker.email, password: speaker.password, role: 'SPEAKER' } });
  expect(reg.status(), await reg.text()).toBe(201);
  const app = await speakerApi.put('/api/speaker/application', {
    headers: JSON_HEADERS,
    data: {
      fullName: `Audit Speaker ${stamp}`,
      phone: '+201001234567',
      linkedinUrl: 'https://www.linkedin.com/in/audit-speaker',
      title: 'Staff ML Engineer',
      company: 'Acme',
      country: 'EG',
      bio: 'Ten years shipping models to production across fintech and telecom.',
      areas: ['MLOPS'],
      sessionTitle: TITLE,
      abstract: 'How we run a feature store for real-time fraud models, and what we would do differently today.',
      format: 'TALK',
      language: 'EN',
      preferredMonths: ['2026-12'],
      referralSource: 'LINKEDIN',
    },
  });
  expect(app.status(), await app.text()).toBe(200);
  const review = await admin.post(`/api/admin/speaker-applications/${(await app.json()).id}/review`, { headers: JSON_HEADERS, data: { decision: 'APPROVE' } });
  expect(review.status(), await review.text()).toBe(200);
  const startsAt = new Date(Date.now() + (50 + (stamp % 100)) * 86_400_000);
  startsAt.setUTCHours(15, stamp % 60, 0, 0);
  const slot = await admin.post('/api/admin/speaking-slots', { headers: JSON_HEADERS, data: { startsAt: startsAt.toISOString(), durationMin: 60 } });
  expect(slot.status(), await slot.text()).toBe(201);
  const slotId = (await slot.json()).id;
  const booked = await speakerApi.post(`/api/speaker/slots/${slotId}/booking`, {
    headers: JSON_HEADERS,
    data: { title: TITLE, abstract: 'Feature pipelines, online and offline stores, and the monitoring that keeps them honest in production.' },
  });
  expect(booked.status(), await booked.text()).toBe(201);
  const slots = (await (await admin.get('/api/admin/speaking-slots')).json()) as { id: string; event: { id: string } | null }[];
  eventId = slots.find((s) => s.id === slotId)!.event!.id;
});

test.afterAll(async () => {
  await admin.dispose();
  await speakerApi.dispose();
});

test('an academic admin sees who booked a session, without a link they cannot open, and is told to release it', async ({ page }) => {
  await uiLogin(page, academic.email, academic.password);
  await page.goto(`/en/admin/sessions/${eventId}`);
  await expect(page.getByText(/Booked by Audit Speaker/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open availability' })).toHaveCount(0);

  // Deleting it is refused with what to do instead.
  const message = new Promise<string>((resolve) => {
    page.on('dialog', (d) => {
      if (d.type() === 'alert') resolve(d.message());
      void d.accept();
    });
  });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  expect(await message).toContain('Release the booking');

  // The super admin, who has the speakers preset, gets the link.
  await page.context().clearCookies();
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en/admin/sessions/${eventId}`);
  await expect(page.getByRole('link', { name: 'Open availability' })).toBeVisible();
});
