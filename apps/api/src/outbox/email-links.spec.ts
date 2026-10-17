import type { Env } from '../config/env';
import { EmailPreferenceLinks } from './email-links';

const env = { WEB_URL: 'https://academy.example', JWT_ACCESS_SECRET: 'x'.repeat(40) } as unknown as Env;

describe('EmailPreferenceLinks (one-click unsubscribe)', () => {
  const links = new EmailPreferenceLinks(env);

  it('signs and verifies a kind, user and course', () => {
    const t = links.token('feedback', 'user1abcdefghij', 'course1abcdefgh');
    expect(t).toMatch(/^f\.user1abcdefghij\.course1abcdefgh\.[\w-]{43}$/);
    expect(links.verify(t)).toEqual({ kind: 'feedback', userId: 'user1abcdefghij', courseId: 'course1abcdefgh' });
    expect(links.verify(links.token('reminders', 'u', 'c'))).toEqual({ kind: 'reminders', userId: 'u', courseId: 'c' });
  });

  it('rejects tampering: another kind, user or course, a bad signature or shape', () => {
    const t = links.token('feedback', 'user1', 'course1');
    const [, , , sig] = t.split('.');
    expect(links.verify(`r.user1.course1.${sig}`)).toBeNull();
    expect(links.verify(`f.user2.course1.${sig}`)).toBeNull();
    expect(links.verify(`f.user1.course2.${sig}`)).toBeNull();
    expect(links.verify(`${t}x`)).toBeNull();
    expect(links.verify(`x.user1.course1.${sig}`)).toBeNull();
    expect(links.verify('f.user1.course1')).toBeNull();
    expect(new EmailPreferenceLinks({ ...env, JWT_ACCESS_SECRET: 'y'.repeat(40) } as Env).verify(t)).toBeNull();
  });

  it('builds the page link and RFC 8058 headers', () => {
    expect(links.pageUrl('ar', 'feedback', 'u', 'c')).toBe(`https://academy.example/ar/unsubscribe?token=${encodeURIComponent(links.token('feedback', 'u', 'c'))}`);
    expect(links.headers('reminders', 'u', 'c')).toEqual({
      'List-Unsubscribe': `<https://academy.example/api/email/unsubscribe?token=${encodeURIComponent(links.token('reminders', 'u', 'c'))}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
