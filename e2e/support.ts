import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@academy.local',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-Admin-2026',
};
/** The API's CSRF check wants a same-origin Origin header on writes. */
export const JSON_HEADERS = { Origin: BASE, 'Content-Type': 'application/json' };

/** Sign-ups are limited per IP (10 a minute) and the suite makes many: wait out a 429 rather than fail. */
export async function registerAccount(api: APIRequestContext, data: Record<string, string>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await api.post('/api/auth/register', { headers: JSON_HEADERS, data });
    if (res.status() !== 429 || attempt >= 3) {
      if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after']) || 30) * 1000));
  }
}

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

/** The compose stack's jobs token (docker-compose.yml): runs the hourly jobs tick on demand. */
export const JOBS_TOKEN = process.env.E2E_JOBS_TOKEN ?? 'local-compose-jobs-token-not-for-production-0123';

export async function runJobsTick(request: APIRequestContext): Promise<Record<string, number | string>> {
  const res = await request.post('/api/internal/jobs/tick', { headers: { 'x-jobs-token': JOBS_TOKEN } });
  expect(res.status(), 'jobs tick').toBe(200);
  return res.json();
}

/**
 * Test fixtures the API can't create, e.g. an enrolment from two days ago. Runs SQL against
 * the stack's database: E2E_DATABASE_URL (default: the compose Postgres on 127.0.0.1:5433)
 * with psql, or psql inside the compose container when psql isn't installed. Returns the
 * rows as tab-separated text. DateTime columns hold UTC: write `(now() AT TIME ZONE 'UTC')`, not
 * `now()`, which a non-UTC database session would shift.
 */
export function sql(query: string): string {
  const url = process.env.E2E_DATABASE_URL ?? 'postgresql://academy:academy@127.0.0.1:5433/academy';
  const args = ['-X', '-q', '-t', '-A', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', query];
  try {
    return execFileSync('psql', [url, ...args], { encoding: 'utf8' }).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'academy', '-d', 'academy', ...args], { encoding: 'utf8' }).trim();
  }
}

/** Polls Mailpit for an email to `to` whose subject contains `subject`; returns its subject and HTML. */
export async function emailWithSubject(request: APIRequestContext, to: string, subject: string): Promise<{ subject: string; html: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
    const hit = messages?.find((m) => m.Subject.includes(subject));
    if (hit) {
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      return { subject: msg.Subject as string, html: msg.HTML as string };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email "${subject}" for ${to}`);
}
