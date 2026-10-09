import { describe, expect, it } from 'vitest';
import { computeCompleteness, communitySectionSchema, coreSectionSchema, linksSectionSchema, phoneSchema, type ProfileDto } from './profile';

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

describe('communitySectionSchema', () => {
  it('needs an explicit Yes or No for every question', () => {
    const ok = { referralSource: 'LINKEDIN', communityMember: false, openToOpportunities: true, shareWithPartners: false, marketingEmails: false };
    expect(communitySectionSchema.safeParse(ok).success).toBe(true);
    expect(communitySectionSchema.safeParse({ ...ok, marketingEmails: undefined }).success).toBe(false);
    expect(communitySectionSchema.safeParse({ ...ok, referralSource: undefined }).success).toBe(false);
  });
});

describe('linksSectionSchema', () => {
  it('requires LinkedIn and GitHub profile links and clears empty optional ones', () => {
    const r = linksSectionSchema.parse({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: 'https://github.com/x', websiteUrl: '' });
    expect(r).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: 'https://github.com/x', websiteUrl: null });
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: '' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ githubUrl: 'https://github.com/x' }).success).toBe(false);
  });
  it('only accepts links on the right site', () => {
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://github.com/x', githubUrl: 'https://github.com/x' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://linkedin.com.evil.io/x', githubUrl: 'https://github.com/x' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://eg.linkedin.com/in/x', githubUrl: 'https://github.com/x' }).success).toBe(true);
  });
  it('rejects javascript: and bare words', () => {
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ githubUrl: 'myname' }).success).toBe(false);
  });
});

describe('computeCompleteness', () => {
  it('is 0 for an empty profile and lists every required field as missing', () => {
    const c = computeCompleteness({});
    expect(c.percent).toBe(0);
    expect(c.coreComplete).toBe(false);
    expect(c.missingCore).toHaveLength(21);
  });
  it('needs the professional, education, links and community steps too, not only the basics', () => {
    const basics: Partial<ProfileDto> = {
      fullNameEn: 'A', phone: '+201001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo',
      employmentStatus: 'STUDENT', jobTitle: 'Student', experienceYears: 'Y0_1', primaryArea: 'STUDENT',
      googleEmail: 'a@gmail.com', preferredLanguage: 'en', acceptedTermsAt: '2026-01-01T00:00:00Z',
    };
    const c = computeCompleteness(basics);
    expect(c.coreComplete).toBe(false);
    expect(c.missingCore.sort()).toEqual([
      'communityAnsweredAt', 'educationLevel', 'fieldOfStudy', 'githubUrl', 'linkedinUrl', 'mlExperienceYears',
      'referralSource', 'seniority', 'university',
    ]);
  });
  it('gives 60% for all required steps and 100% when everything is filled', () => {
    const coreOnly: Partial<ProfileDto> = {
      fullNameEn: 'A', phone: '+201001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo',
      employmentStatus: 'STUDENT', jobTitle: 'Student', experienceYears: 'Y0_1', primaryArea: 'STUDENT',
      googleEmail: 'a@gmail.com', preferredLanguage: 'en', acceptedTermsAt: '2026-01-01T00:00:00Z',
      mlExperienceYears: 'Y0_1', seniority: 'INTERN', educationLevel: 'BACHELORS', fieldOfStudy: 'CS', university: 'Cairo University',
      linkedinUrl: 'https://www.linkedin.com/in/a', githubUrl: 'https://github.com/a', referralSource: 'LINKEDIN',
      communityAnsweredAt: '2026-01-01T00:00:00Z',
    };
    expect(computeCompleteness(coreOnly)).toMatchObject({ percent: 60, coreComplete: true, missingCore: [] });
    const full: Partial<ProfileDto> = {
      ...coreOnly, company: 'X', industry: 'FINTECH', mlExperienceYears: 'Y1_3', seniority: 'MID',
      secondaryAreas: ['MLOPS'], graduationYear: 2020, skills: { PYTHON: 4 },
      cloudPlatforms: ['AWS'], productionTools: ['MLflow'], learningGoals: ['MOVE_TO_MLOPS'],
      interestedTopics: ['RAG'], weeklyHours: 'H_2_5', preferredTimes: ['WEEKEND_EVENINGS'],
      preferredFormat: 'LIVE', websiteUrl: 'https://a.dev',
    };
    expect(computeCompleteness(full).percent).toBe(100);
  });
});
