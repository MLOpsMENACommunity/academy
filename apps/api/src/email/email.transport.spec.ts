import { EmailTransport, GuardedTransport, type EmailMessage } from './email.transport';

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
