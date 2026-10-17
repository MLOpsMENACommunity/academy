import { classifySendError, EmailSendError, EmailTransport, GuardedTransport, ResendTransport, type EmailMessage } from './email.transport';

class FakeTransport extends EmailTransport {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<void> {
    this.sent.push(m);
  }
}

const message = (to: string): EmailMessage => ({ to, subject: 'Welcome', html: '<p>hi</p>', text: 'hi' });

describe('GuardedTransport (staging email guard)', () => {
  it('is only installed when an allowlist or redirect is configured', () => {
    expect(GuardedTransport.enabled({ allowlist: '' })).toBe(false);
    expect(GuardedTransport.enabled({ allowlist: ' ', redirectTo: '' })).toBe(false);
    expect(GuardedTransport.enabled({ allowlist: '', redirectTo: 'admin@mlopsmena.com' })).toBe(true);
    expect(GuardedTransport.enabled({ allowlist: '@mlopsmena.com' })).toBe(true);
  });

  it('delivers allowlisted addresses and domains unchanged, case-insensitively', async () => {
    const inner = new FakeTransport();
    const guard = new GuardedTransport(inner, { allowlist: 'Tester@Example.com, @mlopsmena.com', redirectTo: 'admin@mlopsmena.com' });
    await guard.send(message('tester@example.com'));
    await guard.send(message('someone@MLOPSMENA.com'));
    expect(inner.sent.map((m) => [m.to, m.subject])).toEqual([
      ['tester@example.com', 'Welcome'],
      ['someone@MLOPSMENA.com', 'Welcome'],
    ]);
  });

  it('redirects everyone else to the redirect address, naming the original recipient in the subject', async () => {
    const inner = new FakeTransport();
    const guard = new GuardedTransport(inner, { allowlist: '', redirectTo: 'admin@mlopsmena.com' });
    await guard.send(message('student@gmail.com'));
    expect(inner.sent).toEqual([
      { to: 'admin@mlopsmena.com', subject: '[to student@gmail.com] Welcome', html: '<p>hi</p>', text: 'hi' },
    ]);
  });

  it('does not treat a lookalike domain as allowlisted', async () => {
    const inner = new FakeTransport();
    const guard = new GuardedTransport(inner, { allowlist: '@mlopsmena.com', redirectTo: 'admin@mlopsmena.com' });
    await guard.send(message('x@evil-mlopsmena.com'));
    await guard.send(message('x@mlopsmena.com.evil.io'));
    expect(inner.sent.map((m) => m.to)).toEqual(['admin@mlopsmena.com', 'admin@mlopsmena.com']);
  });

  it('always lets the redirect address itself through', async () => {
    const inner = new FakeTransport();
    const guard = new GuardedTransport(inner, { allowlist: '', redirectTo: 'admin@mlopsmena.com' });
    await guard.send(message('Admin@mlopsmena.com'));
    expect(inner.sent.map((m) => [m.to, m.subject])).toEqual([['Admin@mlopsmena.com', 'Welcome']]);
  });

  it('drops mail outside the allowlist when there is no redirect address', async () => {
    const inner = new FakeTransport();
    const guard = new GuardedTransport(inner, { allowlist: 'tester@example.com' });
    await guard.send(message('student@gmail.com'));
    expect(inner.sent).toEqual([]);
  });
});

describe('send error classes (what the outbox does next)', () => {
  it.each([
    [new EmailSendError('daily_quota_exceeded', 429), 'quota'],
    [new EmailSendError('monthly_quota_exceeded', 429), 'quota'],
    [new EmailSendError('rate_limit_exceeded', 429), 'retryable'],
    [new EmailSendError('concurrent_idempotent_requests', 409), 'retryable'],
    [new EmailSendError('validation_error', 422), 'permanent'],
    [new EmailSendError('invalid_from_address', 403), 'permanent'],
    [new EmailSendError('internal_server_error', 500), 'retryable'],
    [new EmailSendError('application_error'), 'retryable'],
    [Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }), 'permanent'],
    [Object.assign(new Error('try later'), { responseCode: 421 }), 'retryable'],
    [new Error('ECONNRESET'), 'retryable'],
  ])('%s → %s', (err, kind) => {
    expect(classifySendError(err)).toBe(kind);
  });
});

describe('ResendTransport', () => {
  it('passes the idempotency key and headers to Resend', async () => {
    const t = new ResendTransport('re_test_key', 'Academy <a@x.test>');
    const send = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
    (t as unknown as { client: { emails: { send: typeof send } } }).client = { emails: { send } };
    await t.send({ ...message('s@x.test'), headers: { 'List-Unsubscribe': '<https://x/u>' } }, { idempotencyKey: 'outbox/abc' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 's@x.test', headers: { 'List-Unsubscribe': '<https://x/u>' } }), { idempotencyKey: 'outbox/abc' });
    await t.send(message('s@x.test'));
    expect(send).toHaveBeenLastCalledWith(expect.not.objectContaining({ headers: expect.anything() }), undefined);
  });

  it('turns a Resend error into an EmailSendError with its status', async () => {
    const t = new ResendTransport('re_test_key', 'Academy <a@x.test>');
    (t as unknown as { client: unknown }).client = { emails: { send: async () => ({ data: null, error: { name: 'daily_quota_exceeded', statusCode: 429, message: 'x' } }) } };
    await expect(t.send(message('s@x.test'))).rejects.toMatchObject({ code: 'daily_quota_exceeded', statusCode: 429 });
  });
});

describe('GuardedTransport keeps send options', () => {
  it('passes the idempotency key through a redirect', async () => {
    const inner = new FakeTransport();
    const spy = jest.spyOn(inner, 'send');
    const guard = new GuardedTransport(inner, { allowlist: '', redirectTo: 'admin@mlopsmena.com' });
    await guard.send(message('student@gmail.com'), { idempotencyKey: 'outbox/1' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@mlopsmena.com' }), { idempotencyKey: 'outbox/1' });
  });
});
