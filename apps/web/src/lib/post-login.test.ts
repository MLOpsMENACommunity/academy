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
  learning: role === 'STUDENT',
  profile: { completeness: 0, coreComplete, needsCommunityHandles: false, updatedAt: null },
});

describe('where people land after signing in', () => {
  it('lands speakers on their portal when they asked for nothing, and keeps the page they asked for', () => {
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/dashboard')).toBe('/en/speaker');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/dashboard', true)).toBe('/en/speaker');
    // Speakers study too: applying is honoured, through onboarding while the profile is incomplete.
    expect(postLoginPath(me('SPEAKER'), 'ar', '/ar/courses/mlops/apply', true)).toBe('/ar/onboarding?returnTo=%2Far%2Fcourses%2Fmlops%2Fapply');
    expect(postLoginPath(me('SPEAKER', true), 'ar', '/ar/courses/mlops/apply')).toBe('/ar/courses/mlops/apply');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/learn/mlops')).toBe('/en/learn/mlops');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/dashboard/applications/x')).toBe('/en/dashboard/applications/x');
    expect(postLoginPath(me('SPEAKER'), 'en', '/en/onboarding')).toBe('/en/onboarding');
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
