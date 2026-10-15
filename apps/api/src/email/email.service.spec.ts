// Rendering is covered by the e2e tests; here only the queue matters.
jest.mock('@react-email/render', () => ({ render: async () => 'rendered' }));
jest.mock('./templates/catalog', () => ({ buildEmail: () => ({ subject: 'Subject', element: null }) }));

import type { Env } from '../config/env';
import { EmailService } from './email.service';
import { EmailSendError, EmailTransport, type EmailMessage, type SendOptions } from './email.transport';

class FakeTransport extends EmailTransport {
  sent: string[] = [];
  calls: { m: EmailMessage; o?: SendOptions }[] = [];
  failures: Error[] = [];
  gate: Promise<void> = Promise.resolve();
  async send(m: EmailMessage, o?: SendOptions): Promise<void> {
    await this.gate;
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(m.to);
    this.calls.push({ m, o });
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

  it('deliver() says why a send failed, and passes the idempotency key and headers', async () => {
    const t = new FakeTransport();
    const email = new EmailService(t, env);
    expect(await email.deliver('a@x', 'en', tpl, { bulk: true, idempotencyKey: 'outbox/1', headers: { 'List-Unsubscribe': '<u>' } })).toEqual({ ok: true });
    expect(t.calls[0]).toEqual({ m: expect.objectContaining({ to: 'a@x', headers: { 'List-Unsubscribe': '<u>' } }), o: { idempotencyKey: 'outbox/1' } });
    t.failures = [new EmailSendError('daily_quota_exceeded', 429)];
    expect(await email.deliver('b@x', 'en', tpl)).toEqual({ ok: false, kind: 'quota', code: 'daily_quota_exceeded' });
    t.failures = [new EmailSendError('validation_error', 422)];
    expect(await email.deliver('c@x', 'en', tpl)).toEqual({ ok: false, kind: 'permanent', code: 'validation_error' });
    t.failures = [new EmailSendError('internal_server_error', 500)];
    expect(await email.deliver('d@x', 'en', tpl)).toEqual({ ok: false, kind: 'retryable', code: 'internal_server_error' });
    // send() keeps its boolean answer for everyone else.
    t.failures = [new EmailSendError('validation_error', 422)];
    expect(await email.send('e@x', 'en', tpl)).toBe(false);
  });
});
