import type { MeResponse } from '@academy/shared';
import { describe, expect, it } from 'vitest';
import { postLoginPath } from './post-login';

const me = (role: MeResponse['role'], coreComplete = false): MeResponse => ({
  id: 'u',
  email: 'a@b.co',
  role,
  adminPermissions: role === 'ADMIN' ? ['SUPER'] : [],
  locale: 'en',
  emailVerified: true,
  hasPassword: true,
  hasGoogle: false,
  name: null,
  profile: { completeness: 0, coreComplete, updatedAt: null },
});

describe('where people land after signing in', () => {
  it('sends speakers to the speaker portal instead of student pages, skipping onboarding', () => {
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/dashboard')).toBe('/en/speaker');
    expect(postLoginPath(me('SPEAKER'), 'ar', '/ar/courses/mlops/apply', true)).toBe('/ar/speaker');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/onboarding')).toBe('/en/speaker');
    // Anywhere else they were going is kept.
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/sessions/ama')).toBe('/en/sessions/ama');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/speaker/apply')).toBe('/en/speaker/apply');
  });

  it('still sends students with an incomplete profile to onboarding', () => {
    expect(postLoginPath(me('STUDENT'), 'en', '/en/dashboard')).toBe('/en/onboarding?returnTo=%2Fen%2Fdashboard');
    expect(postLoginPath(me('STUDENT', true), 'en', '/en/dashboard')).toBe('/en/dashboard');
    expect(postLoginPath(me('ADMIN'), 'en', '/en/admin')).toBe('/en/admin');
  });
});
