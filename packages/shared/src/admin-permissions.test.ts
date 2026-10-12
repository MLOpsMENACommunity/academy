import { describe, expect, it } from 'vitest';
import { addAdminSchema, adminNavFor, adminSectionOf, COURSE_TAB_PERMISSIONS, hasAdminPermission, updateAdminSchema } from './admin-permissions';
import { eventInputSchema } from './events';
import { isMediaPath, mediaCourseSchema, mediaEventSchema, optionalImageUrlSchema } from './media';

const admin = (...adminPermissions: Parameters<typeof hasAdminPermission>[1][number][]) => ({ role: 'ADMIN' as const, adminPermissions });

describe('hasAdminPermission', () => {
  it('SUPER can do everything; others need one of the listed presets', () => {
    expect(hasAdminPermission(admin('SUPER'), [])).toBe(true);
    expect(hasAdminPermission(admin('SUPER'), ['FINANCE'])).toBe(true);
    expect(hasAdminPermission(admin('CONTENT'), ['ACADEMIC', 'CONTENT'])).toBe(true);
    expect(hasAdminPermission(admin('CONTENT'), ['ACADEMIC'])).toBe(false);
  });

  it('an empty list means super admins only', () => {
    expect(hasAdminPermission(admin('ACADEMIC', 'CONTENT', 'ADMISSIONS', 'SPEAKERS', 'FINANCE'), [])).toBe(false);
  });

  it('is false for anyone but an admin, whatever presets they carry', () => {
    expect(hasAdminPermission({ role: 'STUDENT', adminPermissions: ['SUPER'] }, ['SUPER'])).toBe(false);
    expect(hasAdminPermission({ role: 'SPEAKER' }, [])).toBe(false);
    expect(hasAdminPermission(null, ['CONTENT'])).toBe(false);
    expect(hasAdminPermission({ role: 'ADMIN' }, ['CONTENT'])).toBe(false);
  });
});

describe('admin nav', () => {
  it('follows the presets', () => {
    expect(adminNavFor(admin('SUPER'))).toEqual(['dashboard', 'payments', 'applications', 'students', 'points', 'courses', 'sessions', 'speakers', 'media', 'team', 'settings', 'audit']);
    expect(adminNavFor(admin('CONTENT'))).toEqual(['media']);
    expect(adminNavFor(admin('FINANCE'))).toEqual(['dashboard', 'payments']);
    expect(adminNavFor(admin('ADMISSIONS'))).toEqual(['dashboard', 'applications', 'students', 'courses']);
    expect(adminNavFor(admin('ACADEMIC'))).toEqual(['dashboard', 'points', 'courses', 'sessions']);
    expect(adminNavFor(admin('SPEAKERS'))).toEqual(['speakers']);
    expect(adminNavFor(admin())).toEqual([]);
    expect(adminNavFor({ role: 'STUDENT' })).toEqual([]);
  });

  it('finds the section of an admin path', () => {
    expect(adminSectionOf('')).toBe('dashboard');
    expect(adminSectionOf('/')).toBe('dashboard');
    expect(adminSectionOf('/courses/abc?tab=x')).toBe('courses');
    expect(adminSectionOf('/speakers/applications/1')).toBe('speakers');
    expect(adminSectionOf('/team')).toBe('team');
    expect(adminSectionOf('/nope')).toBeNull();
  });

  it('course tabs: admissions and academic each see their own', () => {
    const tabs = (u: ReturnType<typeof admin>) => Object.entries(COURSE_TAB_PERMISSIONS).filter(([, p]) => hasAdminPermission(u, p)).map(([k]) => k);
    expect(tabs(admin('ADMISSIONS'))).toEqual(['applications', 'enrolled', 'invites', 'waitlist']);
    expect(tabs(admin('ACADEMIC'))).not.toContain('applications');
    expect(tabs(admin('CONTENT'))).toEqual([]);
  });
});

describe('team inputs', () => {
  it('needs one or more known presets, each once, in order', () => {
    expect(updateAdminSchema.safeParse({ permissions: [] }).success).toBe(false);
    expect(updateAdminSchema.safeParse({ permissions: ['ROOT'] }).success).toBe(false);
    expect(updateAdminSchema.parse({ permissions: ['FINANCE', 'SUPER', 'FINANCE'] }).permissions).toEqual(['SUPER', 'FINANCE']);
    expect(addAdminSchema.parse({ email: ' Social@Example.COM ', permissions: ['CONTENT'] })).toEqual({ email: 'social@example.com', permissions: ['CONTENT'], locale: 'en', fullNameEn: null });
  });
});

describe('image fields', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('accept an https URL or an uploaded image, nothing else', () => {
    expect(optionalImageUrlSchema.parse(`/api/media/${id}.webp`)).toBe(`/api/media/${id}.webp`);
    expect(optionalImageUrlSchema.parse('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(optionalImageUrlSchema.parse('')).toBeNull();
    for (const bad of ['javascript:alert(1)', '/api/media/x.png', `/api/media/${id}.svg`, `/api/media/../${id}.png`, '//evil.com/a.png', 'data:image/png;base64,AA', '/speakers/a.webp']) {
      expect(optionalImageUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(isMediaPath(`/api/media/${id}.jpg`)).toBe(true);
  });

  it('the live session editor accepts uploaded images', () => {
    const ev = eventInputSchema.safeParse({
      slug: 'x-session',
      status: 'DRAFT',
      titleEn: 'A session',
      startsAt: new Date().toISOString(),
      durationMin: 60,
      language: 'EN',
      platform: 'GOOGLE_MEET',
      coverImageUrl: `/api/media/${id}.png`,
      speakerPhotoUrl: `/api/media/${id}.jpg`,
    });
    expect(ev.success).toBe(true);
  });

  it('media updates change only media fields', () => {
    expect(mediaCourseSchema.safeParse({ titleEn: 'x' }).success).toBe(false);
    expect(mediaCourseSchema.safeParse({}).success).toBe(false);
    expect(mediaCourseSchema.parse({ coverImageUrl: '' })).toEqual({ coverImageUrl: null });
    expect(mediaEventSchema.safeParse({ recordingUrl: 'ftp://x' }).success).toBe(false);
  });
});
