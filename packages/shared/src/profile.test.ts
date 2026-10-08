import { describe, expect, it } from 'vitest';
import { computeCompleteness, coreSectionSchema, linksSectionSchema, phoneSchema, type ProfileDto } from './profile';

const core = {
  fullNameEn: 'Aya Example',
  phone: '+20 100 123 4567',
  country: 'EG',
  city: 'Cairo',
  timezone: 'Africa/Cairo',
  employmentStatus: 'EMPLOYED_FULL_TIME',
  jobTitle: 'ML Engineer',
  experienceYears: 'Y3_5',
  primaryArea: 'MLOPS',
  googleEmail: 'Aya@Gmail.com',
  preferredLanguage: 'ar',
  acceptTerms: true,
};

describe('coreSectionSchema', () => {
  it('accepts a complete core and normalises phone and email', () => {
    const r = coreSectionSchema.parse(core);
    expect(r.phone).toBe('+201001234567');
    expect(r.googleEmail).toBe('aya@gmail.com');
  });
  it('requires accepting the terms', () => {
    expect(coreSectionSchema.safeParse({ ...core, acceptTerms: false }).success).toBe(false);
  });
  it('rejects unknown countries and timezones', () => {
    expect(coreSectionSchema.safeParse({ ...core, country: 'XX' }).success).toBe(false);
    expect(coreSectionSchema.safeParse({ ...core, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it.each(['01001234567', '+0123', 'abc'])('rejects %s', (v) => {
    expect(phoneSchema.safeParse(v).success).toBe(false);
  });
});

describe('linksSectionSchema', () => {
  it('accepts https URLs and clears empty strings', () => {
    const r = linksSectionSchema.parse({ linkedinUrl: 'https://linkedin.com/in/x', githubUrl: '' });
    expect(r).toMatchObject({ linkedinUrl: 'https://linkedin.com/in/x', githubUrl: null });
  });
  it('rejects javascript: and bare words', () => {
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ githubUrl: 'myname' }).success).toBe(false);
  });
});

describe('computeCompleteness', () => {
  it('is 0 for an empty profile and lists every core field as missing', () => {
    const c = computeCompleteness({});
    expect(c.percent).toBe(0);
    expect(c.coreComplete).toBe(false);
    expect(c.missingCore).toHaveLength(12);
  });
  it('gives 60% for a complete core and 100% when everything is filled', () => {
    const coreOnly: Partial<ProfileDto> = {
      fullNameEn: 'A', phone: '+201001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo',
      employmentStatus: 'STUDENT', jobTitle: 'Student', experienceYears: 'Y0_1', primaryArea: 'STUDENT',
      googleEmail: 'a@gmail.com', preferredLanguage: 'en', acceptedTermsAt: '2026-01-01T00:00:00Z',
    };
    expect(computeCompleteness(coreOnly)).toMatchObject({ percent: 60, coreComplete: true, missingCore: [] });
    const full: Partial<ProfileDto> = {
      ...coreOnly, company: 'X', industry: 'FINTECH', mlExperienceYears: 'Y1_3', seniority: 'MID',
      secondaryAreas: ['MLOPS'], educationLevel: 'BACHELORS', fieldOfStudy: 'CS', skills: { PYTHON: 4 },
      cloudPlatforms: ['AWS'], productionTools: ['MLflow'], learningGoals: ['MOVE_TO_MLOPS'],
      interestedTopics: ['RAG'], weeklyHours: 'H_2_5', preferredTimes: ['WEEKEND_EVENINGS'],
      preferredFormat: 'LIVE', linkedinUrl: 'https://l.in', githubUrl: 'https://g.h', referralSource: 'LINKEDIN',
    };
    expect(computeCompleteness(full).percent).toBe(100);
  });
});
