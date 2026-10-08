import { describe, expect, it } from 'vitest';
import { applicationFilterSchema, courseInputSchema, csvCell, questionInputSchema, sessionInputSchema, toCsv } from './admin';
import { courseAvailability } from './course';

describe('applicationFilterSchema', () => {
  it('parses lists, skills and booleans from a query string', () => {
    const f = applicationFilterSchema.parse({
      country: 'EG,SA',
      seniority: ['SENIOR', 'LEAD_STAFF'],
      skills: 'KUBERNETES:3,PYTHON:4',
      openToOpportunities: 'true',
      experienceMin: 'Y5_10',
    });
    expect(f).toMatchObject({
      country: ['EG', 'SA'],
      seniority: ['SENIOR', 'LEAD_STAFF'],
      skills: [{ skill: 'KUBERNETES', min: 3 }, { skill: 'PYTHON', min: 4 }],
      openToOpportunities: true,
      sort: 'newest',
      page: 1,
    });
  });
  it('rejects unknown values', () => {
    expect(applicationFilterSchema.safeParse({ country: 'XX' }).success).toBe(false);
    expect(applicationFilterSchema.safeParse({ skills: 'KUBERNETES:9' }).success).toBe(false);
    expect(applicationFilterSchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});

describe('csv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(['a', 'b'])).toBe('"a; b"');
    expect(toCsv(['h'], [['v']])).toBe('﻿"h"\r\n"v"\r\n');
  });
});

describe('course and question inputs', () => {
  const base = {
    slug: 'my-course', titleEn: 'Course', titleAr: 'دورة', shortDescriptionEn: 'A short description', shortDescriptionAr: 'وصف قصير للدورة',
    longDescriptionEn: '', longDescriptionAr: '', type: 'PAID', price: 0, requiresApproval: true, status: 'DRAFT', level: 'ALL_LEVELS', language: 'AR',
    targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' }, learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] },
    outline: [], faq: [], included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
    deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'GOOGLE_DRIVE', driveFolderUrl: 'https://evil.example/folder',
  };
  it('requires a price for paid courses and a Drive link for the Drive folder', () => {
    const r = courseInputSchema.safeParse({ ...base, status: 'OPEN' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['driveFolderUrl', 'price']);
  });
  it('lets drafts wait for Arabic and a price, but not public courses', () => {
    const englishOnly = { ...base, titleAr: '', shortDescriptionAr: '', driveFolderUrl: null };
    expect(courseInputSchema.safeParse(englishOnly).success).toBe(true);
    const open = courseInputSchema.safeParse({ ...englishOnly, status: 'OPEN', price: 500 });
    expect(open.error!.issues.map((i) => i.path[0]).sort()).toEqual(['shortDescriptionAr', 'titleAr']);
    // "Coming soon" is public (needs Arabic) but may not have a price yet.
    expect(courseInputSchema.safeParse({ ...base, status: 'COMING_SOON', driveFolderUrl: null }).success).toBe(true);
  });
  it('needs two unique options for select questions', () => {
    expect(questionInputSchema.safeParse({ type: 'SINGLE_SELECT', labelEn: 'Q?', labelAr: 'س؟', required: true, options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }] }).success).toBe(false);
  });
});

describe('admin URL fields', () => {
  it('only accept http(s) links', () => {
    const base = { titleEn: 'Kickoff', titleAr: 'البداية', startsAt: '2026-11-01T17:00:00Z', durationMin: 90 };
    expect(sessionInputSchema.safeParse({ ...base, liveUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...base, liveUrl: 'data:text/html,hi' }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...base, liveUrl: 'https://meet.google.com/abc' }).success).toBe(true);
    expect(sessionInputSchema.safeParse({ ...base, materials: [{ labelEn: 'a', labelAr: 'b', url: 'javascript:x' }] }).success).toBe(false);
  });
});

describe('courseAvailability', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('shows coming-soon courses as upcoming, with or without dates', () => {
    expect(courseAvailability({ status: 'COMING_SOON', applicationsOpenAt: null, applicationDeadline: null }, now)).toBe('UPCOMING');
  });
  it('closes an open course after its deadline', () => {
    const c = { status: 'OPEN' as const, applicationsOpenAt: null, applicationDeadline: '2026-10-17T20:59:00Z' };
    expect(courseAvailability(c, now)).toBe('OPEN');
    expect(courseAvailability(c, new Date('2026-10-17T21:00:00Z'))).toBe('CLOSED');
  });
});
