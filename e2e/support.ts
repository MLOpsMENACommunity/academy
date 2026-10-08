import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@academy.local',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-Admin-2026',
};
/** The API's CSRF check wants a same-origin Origin header on writes. */
export const JSON_HEADERS = { Origin: BASE, 'Content-Type': 'application/json' };

export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<void> {
  const res = await request.post('/api/auth/login', { headers: JSON_HEADERS, data: { email, password } });
  expect(res.status(), 'login').toBe(200);
}

export async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

/** Polls Mailpit for the newest email to `to` and returns its HTML. */
export async function latestEmail(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages?: { ID: string }[] };
    if (messages?.length) {
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json();
      return msg.HTML as string;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to}`);
}

/** A tiny valid PNG (1×1) standing in for a payment screenshot. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
