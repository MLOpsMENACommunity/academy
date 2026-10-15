import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth';
import { DEFAULT_SETTINGS, sessionTeamEmailsSchema, settingsSchema, settingsUpdateSchema } from './settings';
import {
  cairoMonthKey,
  canCancelBooking,
  generateSlotTimes,
  homePath,
  isStudentOnlyPath,
  slotGeneratorSchema,
  speakerApplicationSchema,
  speakerReviewSchema,
  slotBookingSchema,
  SPEAKER_FORMATS,
  zonedTimeToUtc,
} from './speakers';
import { cleanSpeakerDetails, readEventDetails, speakerDetailsSchema } from './speaker-details';

const application = {
  fullName: 'Mona Speaker',
  phone: '+201001234567',
  linkedinUrl: 'https://www.linkedin.com/in/mona?utm_source=share',
  title: 'Staff ML Engineer',
  company: 'Acme',
  country: 'EG',
  bio: 'Ten years shipping models to production across fintech and telecom.',
  photoUrl: '',
  areas: ['MLOPS', 'KUBERNETES', 'MLOPS'],
  sessionTitle: 'Serving LLMs on Kubernetes',
  abstract: 'A walk through GPU scheduling, autoscaling and observability for LLM inference in production.',
  format: 'HANDS_ON',
  language: 'AR',
  preferredMonths: ['2026-12', '2026-11'],
  referralSource: 'LINKEDIN',
};

describe('signing up as a student or a speaker', () => {
  it('defaults to student and accepts speaker', () => {
    expect(registerSchema.parse({ email: 'a@b.co', password: 'x'.repeat(10) }).role).toBe('STUDENT');
    expect(registerSchema.parse({ email: 'a@b.co', password: 'x'.repeat(10), role: 'SPEAKER' }).role).toBe('SPEAKER');
  });

  it('never lets anyone sign up as an admin', () => {
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(10), role: 'ADMIN' }).success).toBe(false);
  });
});

describe('role routing', () => {
  it('sends each role to its own home', () => {
    expect(homePath('SPEAKER', 'ar')).toBe('/ar/speaker');
    expect(homePath('STUDENT', 'en')).toBe('/en/dashboard');
    expect(homePath('ADMIN', 'en')).toBe('/en/admin');
  });

  it('knows which pages are for students only', () => {
    expect(isStudentOnlyPath('/en/dashboard', 'en')).toBe(true);
    expect(isStudentOnlyPath('/en/onboarding?returnTo=%2Fen%2Fdashboard', 'en')).toBe(true);
    expect(isStudentOnlyPath('/ar/courses/mlops/apply', 'ar')).toBe(true);
    expect(isStudentOnlyPath('/en/learn/mlops', 'en')).toBe(true);
    expect(isStudentOnlyPath('/en/speaker', 'en')).toBe(false);
    expect(isStudentOnlyPath('/en/sessions/ama', 'en')).toBe(false);
    expect(isStudentOnlyPath('/en/profile?tab=account', 'en')).toBe(false);
  });
});

describe('session team emails setting', () => {
  it('defaults to the four team inboxes', () => {
    expect(DEFAULT_SETTINGS.sessionTeamEmails).toEqual([
      'aya@mlopsmena.com',
      'mariam@mlopsmena.com',
      'omarkhalil@mlopsmena.com',
      'mahmoud@mlopsmena.com',
    ]);
    expect(DEFAULT_SETTINGS.speakerMaxOpenBookings).toBe(2);
    expect(DEFAULT_SETTINGS.speakerCancelDays).toBe(3);
  });

  it('lowercases, and rejects invalid addresses, duplicates and long lists', () => {
    expect(sessionTeamEmailsSchema.parse([' Team@Example.com '])).toEqual(['team@example.com']);
    expect(sessionTeamEmailsSchema.parse([])).toEqual([]);
    const bad = sessionTeamEmailsSchema.safeParse(['ok@example.com', 'nope']);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual([1]);
    expect(sessionTeamEmailsSchema.safeParse(['a@example.com', 'A@example.com']).success).toBe(false);
    expect(sessionTeamEmailsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `p${i}@example.com`)).success).toBe(false);
  });

  it('is part of the settings update', () => {
    expect(settingsUpdateSchema.parse({ sessionTeamEmails: ['x@example.com'] })).toEqual({ sessionTeamEmails: ['x@example.com'] });
    expect(settingsSchema.shape.speakerCancelDays.safeParse(-1).success).toBe(false);
  });
});

describe('speaker application', () => {
  it('normalises LinkedIn, removes duplicate areas and sorts months', () => {
    const a = speakerApplicationSchema.parse(application);
    expect(a.linkedinUrl).toBe('https://www.linkedin.com/in/mona');
    expect(a.areas).toEqual(['MLOPS', 'KUBERNETES']);
    expect(a.preferredMonths).toEqual(['2026-11', '2026-12']);
    expect(a.photoUrl).toBeNull();
  });

  it('takes a photo only as a real https link (SPK-06)', () => {
    const photo = (photoUrl: string) => speakerApplicationSchema.safeParse({ ...application, photoUrl });
    expect(photo('https://media.licdn.com/dms/image/abc.jpg').data?.photoUrl).toBe('https://media.licdn.com/dms/image/abc.jpg');
    expect(photo('').data?.photoUrl).toBeNull();
    for (const bad of ['https://x', 'http://example.test/a.png', 'https://user:pass@example.test/a.png', 'javascript:alert(1)']) {
      expect(photo(bad).success).toBe(false);
    }
  });

  it('requires LinkedIn, an area and a real abstract', () => {
    const issues = (over: Record<string, unknown>) =>
      [...new Set(speakerApplicationSchema.safeParse({ ...application, ...over }).error?.issues.map((i) => i.path.join('.')) ?? [])];
    expect(issues({ linkedinUrl: '' })).toEqual(['linkedinUrl']);
    expect(issues({ linkedinUrl: 'https://twitter.com/mona' })).toEqual(['linkedinUrl']);
    expect(issues({ areas: [] })).toEqual(['areas']);
    expect(issues({ areas: ['BLOCKCHAIN'] })).toEqual(['areas.0']);
    expect(issues({ abstract: 'Too short.' })).toEqual(['abstract']);
    expect(issues({ abstract: 'x'.repeat(2001) })).toEqual(['abstract']);
    expect(issues({ photoUrl: 'javascript:alert(1)' })).toEqual(['photoUrl']);
    expect(issues({ preferredMonths: ['2026-13'] })).toEqual(['preferredMonths.0']);
  });

  it('asks how they heard about us, and the member\'s name for "An MLOps MENA member"', () => {
    const issues = (over: Record<string, unknown>) =>
      [...new Set(speakerApplicationSchema.safeParse({ ...application, ...over }).error?.issues.map((i) => i.path.join('.')) ?? [])];
    expect(issues({ referralSource: undefined })).toEqual(['referralSource']);
    expect(issues({ referralSource: 'MLOPS_MENA_MEMBER' })).toEqual(['referralMemberName']);
    expect(issues({ referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: ' ' })).toEqual(['referralMemberName']);
    // Reported with the other errors on the first submit.
    expect(issues({ referralSource: 'MLOPS_MENA_MEMBER', abstract: 'short' })).toEqual(['abstract', 'referralMemberName']);
    const ok = speakerApplicationSchema.parse({ ...application, referralSource: 'MLOPS_MENA_MEMBER', referralMemberName: '  Layla Member ' });
    expect(ok.referralMemberName).toBe('Layla Member');
    // Another source: a typed name is dropped, never stored.
    expect(speakerApplicationSchema.parse({ ...application, referralMemberName: 'Someone' }).referralMemberName).toBeNull();
  });

  it('has an optional GitHub link, the course and podcast formats, and a kind (session by default)', () => {
    const a = speakerApplicationSchema.parse(application);
    expect(a.githubUrl).toBeNull();
    expect(a.kind).toBe('SESSION');
    expect(a.details).toEqual({});
    expect(speakerApplicationSchema.parse({ ...application, githubUrl: 'https://github.com/mona' }).githubUrl).toBe('https://github.com/mona');
    expect(speakerApplicationSchema.safeParse({ ...application, githubUrl: 'https://gitlab.com/mona' }).success).toBe(false);
    expect(speakerApplicationSchema.safeParse({ ...application, githubUrl: 'https://github.com/' }).success).toBe(false);
    expect(SPEAKER_FORMATS).toEqual(expect.arrayContaining(['COURSE', 'PODCAST', 'TALK', 'HANDS_ON', 'WORKSHOP', 'QA']));
    for (const kind of ['SESSION', 'COURSE', 'PODCAST']) expect(speakerApplicationSchema.parse({ ...application, kind }).kind).toBe(kind);
    expect(speakerApplicationSchema.safeParse({ ...application, kind: 'WEBINAR' }).success).toBe(false);
  });

  it('needs a reason to reject', () => {
    expect(speakerReviewSchema.safeParse({ decision: 'REJECT', note: '' }).success).toBe(false);
    expect(speakerReviewSchema.safeParse({ decision: 'REJECT', note: 'Topic already covered this term.' }).success).toBe(true);
    expect(speakerReviewSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });
});

describe('Cairo time', () => {
  it('maps a Cairo wall-clock time to UTC in summer and winter time', () => {
    // Summer time (UTC+3) until 29 Oct 2026, then UTC+2.
    expect(zonedTimeToUtc(2026, 10, 24, 19, 0).toISOString()).toBe('2026-10-24T16:00:00.000Z');
    expect(zonedTimeToUtc(2026, 10, 31, 19, 0).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(cairoMonthKey('2026-10-31T22:30:00Z')).toBe('2026-11');
  });
});

describe('slot generator', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  it('keeps 19:00 Cairo on every Saturday across the clock change', () => {
    const input = slotGeneratorSchema.parse({ weekdays: [6], time: '19:00', durationMin: 60, months: ['2026-10', '2026-11'] });
    const times = generateSlotTimes(input, now).map((d) => d.toISOString());
    expect(times).toEqual([
      '2026-10-03T16:00:00.000Z',
      '2026-10-10T16:00:00.000Z',
      '2026-10-17T16:00:00.000Z',
      '2026-10-24T16:00:00.000Z',
      '2026-10-31T17:00:00.000Z',
      '2026-11-07T17:00:00.000Z',
      '2026-11-14T17:00:00.000Z',
      '2026-11-21T17:00:00.000Z',
      '2026-11-28T17:00:00.000Z',
    ]);
    const cairo = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date(d));
    expect(new Set(times.map(cairo))).toEqual(new Set(['Sat 19:00']));
  });

  it('skips times already past and handles several weekdays', () => {
    const input = slotGeneratorSchema.parse({ weekdays: [2, 6, 2], time: '20:30', durationMin: 90, months: ['2026-10'] });
    expect(input.weekdays).toEqual([2, 6]);
    const times = generateSlotTimes(input, new Date('2026-10-20T00:00:00Z'));
    expect(times.map((d) => d.toISOString())).toEqual(['2026-10-20T17:30:00.000Z', '2026-10-24T17:30:00.000Z', '2026-10-27T17:30:00.000Z', '2026-10-31T18:30:00.000Z']);
  });

  it('rejects a bad time or no days', () => {
    expect(slotGeneratorSchema.safeParse({ weekdays: [], time: '19:00', durationMin: 60, months: ['2026-11'] }).success).toBe(false);
    expect(slotGeneratorSchema.safeParse({ weekdays: [1], time: '7pm', durationMin: 60, months: ['2026-11'] }).success).toBe(false);
  });
});

describe('booking rules', () => {
  it('allows cancelling until N days before', () => {
    const startsAt = new Date('2026-11-10T17:00:00Z');
    expect(canCancelBooking(startsAt, 3, new Date('2026-11-07T16:59:00Z'))).toBe(true);
    expect(canCancelBooking(startsAt, 3, new Date('2026-11-07T17:00:00Z'))).toBe(false);
    expect(canCancelBooking(startsAt, 0, new Date('2026-11-10T16:00:00Z'))).toBe(true);
  });
});

describe('booking details', () => {
  const booking = { title: 'Serving LLMs on Kubernetes', abstract: 'A walk through GPU scheduling, autoscaling and observability for LLM inference.' };

  it('needs only the title and abstract; every detail is optional', () => {
    expect(slotBookingSchema.parse(booking)).toEqual({ ...booking, kind: 'SESSION', details: {} });
    expect(slotBookingSchema.safeParse({ ...booking, title: '' }).success).toBe(false);
    expect(slotBookingSchema.safeParse({ ...booking, abstract: 'short' }).success).toBe(false);
  });

  it('keeps what is filled, drops empty fields and the blocks of other kinds', () => {
    const details = {
      audience: '  ML engineers  ',
      prerequisites: '',
      outcomes: ['Deploy a model', '', 'Deploy a model', 'Monitor it'],
      level: 'INTERMEDIATE',
      language: '',
      tags: [],
      course: { modulesCount: '6', modules: [{ title: 'Intro', description: '' }, { title: '', description: '' }], weeklyHours: '3', durationWeeks: '', materialsUrl: 'https://github.com/x/y' },
      podcast: { guests: [{ name: 'Sara', linkedinUrl: 'https://www.linkedin.com/in/sara?utm_source=x' }], discussion: ['Careers'], episodeFormat: 'PANEL', host: '' },
    };
    expect(slotBookingSchema.parse({ ...booking, kind: 'COURSE', details }).details).toEqual({
      audience: 'ML engineers',
      outcomes: ['Deploy a model', 'Monitor it'],
      level: 'INTERMEDIATE',
      course: { modulesCount: 6, modules: [{ title: 'Intro', description: '' }], weeklyHours: 3, materialsUrl: 'https://github.com/x/y' },
    });
    expect(slotBookingSchema.parse({ ...booking, kind: 'PODCAST', details }).details).toEqual({
      audience: 'ML engineers',
      outcomes: ['Deploy a model', 'Monitor it'],
      level: 'INTERMEDIATE',
      podcast: { guests: [{ name: 'Sara', linkedinUrl: 'https://www.linkedin.com/in/sara' }], discussion: ['Careers'], episodeFormat: 'PANEL' },
    });
    expect(slotBookingSchema.parse({ ...booking, kind: 'SESSION', details }).details).not.toHaveProperty('course');
  });

  it('checks lengths, links and limits', () => {
    const bad = (d: Record<string, unknown>) => speakerDetailsSchema.safeParse(d).success;
    expect(bad({ audience: 'x'.repeat(501) })).toBe(false);
    expect(bad({ outcomes: Array.from({ length: 11 }, (_, i) => `o${i}`) })).toBe(false);
    expect(bad({ level: 'EXPERT' })).toBe(false);
    expect(bad({ course: { materialsUrl: 'http://example.com' } })).toBe(false);
    expect(bad({ course: { materialsUrl: 'javascript:alert(1)' } })).toBe(false);
    expect(bad({ course: { modulesCount: 0 } })).toBe(false);
    expect(bad({ course: { weeklyHours: 80 } })).toBe(false);
    expect(bad({ podcast: { guests: [{ name: 'A', linkedinUrl: 'https://twitter.com/a' }] } })).toBe(false);
    expect(bad({ podcast: { episodeFormat: 'SOLO' } })).toBe(false);
    expect(bad({})).toBe(true);
  });

  it('reads stored JSON defensively', () => {
    expect(readEventDetails({})).toEqual({ kind: 'SESSION', details: {} });
    expect(readEventDetails(null)).toEqual({ kind: 'SESSION', details: {} });
    expect(readEventDetails({ kind: 'PODCAST', details: { podcast: { host: 'Host Person' }, course: { modulesCount: 3 } } })).toEqual({ kind: 'PODCAST', details: { podcast: { host: 'Host Person' } } });
    expect(readEventDetails({ kind: 'HACK', details: { level: 'NOPE' } })).toEqual({ kind: 'SESSION', details: {} });
    expect(cleanSpeakerDetails('SESSION', null)).toEqual({});
  });
});
