// Rendering is covered by the e2e tests; here only the queue matters.
jest.mock('@react-email/render', () => ({ render: async () => 'rendered' }));
jest.mock('./templates/catalog', () => ({ buildEmail: () => ({ subject: 'Subject', element: null }) }));

import type { Env } from '../config/env';
import { EmailService } from './email.service';
import { EmailSendError, EmailTransport, type EmailMessage } from './email.transport';

class FakeTransport extends EmailTransport {
  sent: string[] = [];
  failures: Error[] = [];
  gate: Promise<void> = Promise.resolve();
  async send(m: EmailMessage): Promise<void> {
    await this.gate;
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(m.to);
  }
}

const env = { WEB_URL: 'http://localhost:3000', EMAIL_PROVIDER: 'log', EMAIL_MIN_INTERVAL_MS: 0 } as unknown as Env;
const tpl = { name: 'verifyEmail', url: 'http://x' } as const;

describe('EmailService queue', () => {
  it('sends transactional mail before queued bulk mail', async () => {
    const t = new FakeTransport();
    let release!: () => void;
    t.gate = new Promise((r) => (release = r));
    const email = new EmailService(t, env);
    const all = [
      email.send('bulk-1@x', 'en', tpl, { bulk: true }),
      email.send('bulk-2@x', 'en', tpl, { bulk: true }),
      email.send('bulk-3@x', 'en', tpl, { bulk: true }),
    ];
    await new Promise((r) => setTimeout(r, 50)); // bulk-1 is now in flight
    all.push(email.send('verify@x', 'en', tpl));
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect(await Promise.all(all)).toEqual([true, true, true, true]);
    expect(t.sent).toEqual(['bulk-1@x', 'verify@x', 'bulk-2@x', 'bulk-3@x']);
  });

  it('retries a rate-limited send, but not an exhausted daily quota', async () => {
    const t = new FakeTransport();
    const email = new EmailService(t, env);
    t.failures = [new EmailSendError('rate_limit_exceeded', 429)];
    expect(await email.send('a@x', 'en', tpl)).toBe(true);
    expect(t.sent).toEqual(['a@x']);
    t.failures = [new EmailSendError('daily_quota_exceeded', 429)];
    expect(await email.send('b@x', 'en', tpl)).toBe(false);
  }, 10_000);
});
