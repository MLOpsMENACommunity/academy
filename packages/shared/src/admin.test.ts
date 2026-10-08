import { describe, expect, it } from 'vitest';
import { applicationFilterSchema, courseInputSchema, csvCell, questionInputSchema, toCsv } from './admin';

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
    const r = courseInputSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['driveFolderUrl', 'price']);
  });
  it('needs two unique options for select questions', () => {
    expect(questionInputSchema.safeParse({ type: 'SINGLE_SELECT', labelEn: 'Q?', labelAr: 'س؟', required: true, options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }] }).success).toBe(false);
  });
});
