import { classifySendError, CloudflareTransport, EmailSendError, EmailTransport, GuardedTransport, parseFrom, ResendTransport, type EmailMessage } from './email.transport';

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

describe('CloudflareTransport', () => {
  const ACCOUNT = 'a'.repeat(32);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ok = { success: true, errors: [], result: { delivered: ['x'], permanent_bounces: [], queued: [] } };
  const failure = (status: number, code: number, message = 'nope') => reply(status, { success: false, errors: [{ code, message }], result: null });
  const transport = (res: Response | Error) => {
    const fetchFn = jest.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    return { fetchFn, t: new CloudflareTransport(ACCOUNT, 'token-123', 'MLOps MENA Academy <academy@mlopsmena.com>', fetchFn) };
  };

  it('posts one email to the account send endpoint, sender split into name and address', async () => {
    const { fetchFn, t } = transport(reply(200, ok));
    await t.send({ ...message('student@gmail.com'), headers: { 'List-Unsubscribe': '<https://x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: { address: 'academy@mlopsmena.com', name: 'MLOps MENA Academy' },
      to: ['student@gmail.com'],
      subject: 'Welcome',
      html: '<p>hi</p>',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  });

  it('sorts failures the way the outbox expects', async () => {
    const kind = async (res: Response | Error) => {
      try {
        await transport(res).t.send(message('s@x.com'));
        return 'sent';
      } catch (err) {
        return classifySendError(err);
      }
    };
    expect(await kind(failure(429, 10004, 'Too many requests'))).toBe('retryable');
    expect(await kind(failure(429, 10004, 'Daily sending limit exceeded'))).toBe('quota');
    expect(await kind(failure(403, 10203, 'Sending disabled'))).toBe('retryable');
    expect(await kind(failure(403, 10207, 'Account paused'))).toBe('retryable');
    expect(await kind(failure(400, 10001, 'Invalid recipient'))).toBe('permanent');
    expect(await kind(failure(500, 10000, 'Internal'))).toBe('retryable');
    expect(await kind(new TypeError('fetch failed'))).toBe('retryable');
    expect(await kind(reply(200, { ...ok, result: { delivered: [], permanent_bounces: ['s@x.com'], queued: [] } }))).toBe('permanent');
    expect(await kind(reply(200, { ...ok, result: { delivered: [], permanent_bounces: [], queued: [], suppressed_recipients: ['s@x.com'] } }))).toBe('permanent');
    expect(await kind(reply(200, ok))).toBe('sent');
  });

  it('never puts the recipient or the token in the error message', async () => {
    const err = await transport(failure(400, 10001, 'Invalid recipient s@x.com')).t.send(message('s@x.com')).catch((e: Error) => e);
    expect(String(err)).not.toContain('s@x.com');
    expect(String(err)).not.toContain('token-123');
  });
});

describe('parseFrom', () => {
  it('splits "Name <address>" and keeps a bare address', () => {
    expect(parseFrom('MLOps MENA Academy <academy@mlopsmena.com>')).toEqual({ name: 'MLOps MENA Academy', address: 'academy@mlopsmena.com' });
    expect(parseFrom('"Academy (staging)" <a@b.com>')).toEqual({ name: 'Academy (staging)', address: 'a@b.com' });
    expect(parseFrom('a@b.com')).toEqual({ address: 'a@b.com' });
  });
});
