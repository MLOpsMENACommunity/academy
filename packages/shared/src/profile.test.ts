import { describe, expect, it } from 'vitest';
import {
  computeCompleteness,
  adminSectionSchemaFor,
  communitySectionSchema,
  missingCommunityHandles,
  normalizeDiscordUsername,
  normalizeTelegramUsername,
  coreSectionSchema,
  educationSectionSchema,
  linksSectionSchema,
  ML_EXPERIENCE_MESSAGE,
  mlExperienceExceedsTotal,
  normalizePhone,
  phoneSchema,
  sectionSchemaFor,
  type ProfileDto,
} from './profile';

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

describe('normalizePhone (QA L11)', () => {
  it.each([
    ['01001234567', 'EG', '+201001234567'],
    ['0100 123 4567', 'EG', '+201001234567'],
    ['0112-345-6789', 'EG', '+201123456789'],
    ['+20 0100 123 4567', 'EG', '+201001234567'],
    ['00201001234567', 'EG', '+201001234567'],
    ['٠١٠٠١٢٣٤٥٦٧', 'EG', '+201001234567'],
    ['0501234567', 'SA', '+966501234567'],
    ['050 123 4567', 'AE', '+971501234567'],
    ['+201001234567', 'EG', '+201001234567'],
  ])('%s in %s → %s', (raw, country, expected) => {
    expect(normalizePhone(raw, country)).toBe(expected);
  });

  it('leaves local numbers alone when the country has no rule or is unknown', () => {
    expect(normalizePhone('01001234567', 'JO')).toBe('01001234567');
    expect(normalizePhone('01001234567')).toBe('01001234567');
    // Not an Egyptian mobile prefix (013): no guessing.
    expect(normalizePhone('01301234567', 'EG')).toBe('01301234567');
  });
});

describe('coreSectionSchema phone (QA L11)', () => {
  it('accepts an Egyptian local number when the country is EG and stores it internationally', () => {
    expect(coreSectionSchema.parse({ ...core, phone: '01001234567' }).phone).toBe('+201001234567');
  });
  it('still needs a country code elsewhere', () => {
    const r = coreSectionSchema.safeParse({ ...core, country: 'JO', phone: '0791234567' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(['phone']);
  });
});

describe('experience consistency (QA L12)', () => {
  it('compares the ranges', () => {
    expect(mlExperienceExceedsTotal('Y1_3', 'Y5_10')).toBe(true);
    expect(mlExperienceExceedsTotal('Y5_10', 'Y5_10')).toBe(false);
    expect(mlExperienceExceedsTotal('Y10_PLUS', 'Y0_1')).toBe(false);
    expect(mlExperienceExceedsTotal(null, 'Y10_PLUS')).toBe(false);
  });

  const professional = { mlExperienceYears: 'Y5_10', seniority: 'MID', secondaryAreas: [] };
  it('rejects more ML/AI experience than total experience, on the ML field', () => {
    const r = sectionSchemaFor('professional', { experienceYears: 'Y1_3' }).safeParse(professional);
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([expect.objectContaining({ path: ['mlExperienceYears'], message: ML_EXPERIENCE_MESSAGE })]);
    expect(sectionSchemaFor('professional', { experienceYears: 'Y10_PLUS' }).safeParse(professional).success).toBe(true);
  });

  it('reports the experience error together with the other errors, on the first submit', () => {
    const r = sectionSchemaFor('professional', { experienceYears: 'Y1_3' }).safeParse({ mlExperienceYears: 'Y5_10' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.')).sort()).toEqual(['mlExperienceYears', 'seniority']);
  });

  it('rejects lowering total experience below the saved ML/AI experience', () => {
    const r = sectionSchemaFor('core', { mlExperienceYears: 'Y5_10' }).safeParse({ ...core, experienceYears: 'Y1_3' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['experienceYears'], message: ML_EXPERIENCE_MESSAGE });
  });

  it('drops the primary area from the secondary areas', () => {
    const r = sectionSchemaFor('professional', { experienceYears: 'Y10_PLUS', primaryArea: 'MLOPS' }).parse({
      ...professional,
      secondaryAreas: ['MLOPS', 'DATA_ENGINEERING'],
    });
    expect(r.secondaryAreas).toEqual(['DATA_ENGINEERING']);
  });
});

describe('educationSectionSchema', () => {
  it('only asks for the highest degree', () => {
    expect(educationSectionSchema.safeParse({ educationLevel: 'BACHELORS' }).success).toBe(true);
    expect(educationSectionSchema.safeParse({}).success).toBe(false);
  });
  it('drops fields no longer asked, so saving never overwrites their stored values', () => {
    const r = educationSectionSchema.parse({ educationLevel: 'MASTERS', fieldOfStudy: '', university: '', graduationYear: 2020, currentlyStudying: true });
    expect(r).toEqual({ educationLevel: 'MASTERS' });
  });
});

describe('Telegram and Discord usernames', () => {
  it('store a Telegram username without its @, 5–32 letters, digits or _', () => {
    expect(normalizeTelegramUsername('@Layla_ML')).toBe('Layla_ML');
    expect(normalizeTelegramUsername(' layla_ml ')).toBe('layla_ml');
    for (const bad of ['abcd', '@abc', 'a'.repeat(33), 'layla.ml', 'layla ml', 'لیلی_ml', '', '@']) expect(normalizeTelegramUsername(bad)).toBeNull();
    expect(normalizeTelegramUsername('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('accept a new-style Discord username (lowered) or a legacy name#1234', () => {
    expect(normalizeDiscordUsername('layla.ml')).toBe('layla.ml');
    expect(normalizeDiscordUsername('Layla_ML')).toBe('layla_ml');
    expect(normalizeDiscordUsername('@layla.ml')).toBe('layla.ml');
    expect(normalizeDiscordUsername('Layla ML#0420')).toBe('Layla ML#0420');
    for (const bad of ['l', 'a'.repeat(33), 'layla..ml', 'layla ml', 'layla#12', 'layla#12345', '#1234', 'x#1234', '']) expect(normalizeDiscordUsername(bad)).toBeNull();
  });

  it('are required in the student\'s community step, and normalised', () => {
    const base = { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false };
    const r = communitySectionSchema.safeParse({ ...base });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['discordUsername', 'telegramUsername']);
    expect(communitySectionSchema.safeParse({ ...base, telegramUsername: '  ', discordUsername: 'x.y' }).success).toBe(false);
    expect(communitySectionSchema.parse({ ...base, telegramUsername: '@layla_ml', discordUsername: 'Layla.ML' })).toMatchObject({ telegramUsername: 'layla_ml', discordUsername: 'layla.ml' });
  });

  it('are optional for an admin: empty clears, left out keeps, a bad one is refused', () => {
    const base = { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false };
    const admin = adminSectionSchemaFor('community', null);
    expect(admin.parse({ ...base, telegramUsername: '', discordUsername: null })).toMatchObject({ telegramUsername: null, discordUsername: null });
    const kept = admin.parse(base) as Record<string, unknown>;
    expect(kept.telegramUsername).toBeUndefined();
    expect(admin.safeParse({ ...base, telegramUsername: 'ab' }).success).toBe(false);
  });

  it('tell whether a student still has to add them', () => {
    expect(missingCommunityHandles({ telegramUsername: 'layla_ml', discordUsername: 'layla.ml' })).toBe(false);
    expect(missingCommunityHandles({ telegramUsername: 'layla_ml', discordUsername: null })).toBe(true);
    expect(missingCommunityHandles(null)).toBe(true);
  });
});

describe('communitySectionSchema', () => {
  it('needs an explicit Yes or No for every question', () => {
    const ok = { referralSource: 'LINKEDIN', communityMember: false, marketingEmails: false, telegramUsername: 'layla_ml', discordUsername: 'layla.ml' };
    expect(communitySectionSchema.safeParse(ok).success).toBe(true);
    expect(communitySectionSchema.safeParse({ ...ok, marketingEmails: undefined }).success).toBe(false);
    expect(communitySectionSchema.safeParse({ ...ok, referralSource: undefined }).success).toBe(false);
  });

  it('no longer asks about job opportunities or hiring partners, and never passes them on', () => {
    const ok = { referralSource: 'LINKEDIN', communityMember: true, marketingEmails: false, telegramUsername: 'layla_ml', discordUsername: 'layla.ml' };
    expect(communitySectionSchema.safeParse(ok).success).toBe(true);
    // Sent by an old client: dropped, so a save never overwrites the stored answers.
    expect(communitySectionSchema.parse({ ...ok, openToOpportunities: true, shareWithPartners: true })).toEqual(ok);
  });

  it('lets an admin edit the same fields, without accepting the Terms for the student', () => {
    const core = adminSectionSchemaFor('core', null).safeParse({
      fullNameEn: 'Mona', phone: '01001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo', employmentStatus: 'EMPLOYED_FULL_TIME',
      jobTitle: 'Engineer', experienceYears: 'Y3_5', primaryArea: 'MLOPS', googleEmail: 'm@gmail.com', preferredLanguage: 'en',
    });
    expect(core.success).toBe(true);
    expect(core.data).not.toHaveProperty('acceptTerms');
    expect((core.data as { phone: string }).phone).toBe('+201001234567');
    expect(adminSectionSchemaFor('core', null).safeParse({ fullNameEn: 'M' }).success).toBe(false);
    expect(adminSectionSchemaFor('community', null).parse({ referralSource: 'EVENT', communityMember: false, marketingEmails: false, shareWithPartners: true })).toEqual({
      referralSource: 'EVENT', communityMember: false, marketingEmails: false,
    });
    const other = adminSectionSchemaFor('other', null).parse({ websiteUrl: '', kaggleUrl: null, huggingfaceUrl: 'https://huggingface.co/m', fieldOfStudy: ' ', university: 'Cairo University', graduationYear: '', openToOpportunities: false, shareWithPartners: false });
    expect(other).toEqual({ websiteUrl: null, kaggleUrl: null, huggingfaceUrl: 'https://huggingface.co/m', fieldOfStudy: null, university: 'Cairo University', graduationYear: null, openToOpportunities: false, shareWithPartners: false });
    expect(adminSectionSchemaFor('other', null).safeParse({ ...other, websiteUrl: 'javascript:x' }).success).toBe(false);
  });
});

describe('linksSectionSchema', () => {
  it('requires LinkedIn and GitHub profile links and nothing else', () => {
    const r = linksSectionSchema.parse({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: 'https://github.com/x', websiteUrl: '', kaggleUrl: '' });
    // Website, Kaggle and Hugging Face are no longer asked: dropped, so stored values are left alone.
    expect(r).toEqual({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: 'https://github.com/x' });
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://www.linkedin.com/in/x', githubUrl: '' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ githubUrl: 'https://github.com/x' }).success).toBe(false);
  });
  it('only accepts links on the right site', () => {
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://github.com/x', githubUrl: 'https://github.com/x' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://linkedin.com.evil.io/x', githubUrl: 'https://github.com/x' }).success).toBe(false);
    expect(linksSectionSchema.safeParse({ linkedinUrl: 'https://eg.linkedin.com/in/x', githubUrl: 'https://github.com/x' }).success).toBe(true);
    const gh = 'https://github.com/x';
    for (const bad of ['http://www.linkedin.com/in/x', 'https://u:p@www.linkedin.com/in/x', 'https://www.linkedin.com', 'https://www.linkedin.com/']) {
      expect(linksSectionSchema.safeParse({ linkedinUrl: bad, githubUrl: gh }).success, bad).toBe(false);
    }
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
    expect(c.missingCore).toHaveLength(19);
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
      'communityAnsweredAt', 'educationLevel', 'githubUrl', 'linkedinUrl', 'mlExperienceYears',
      'referralSource', 'seniority',
    ]);
  });
  it('gives 60% for all required steps and 100% when everything is filled', () => {
    const coreOnly: Partial<ProfileDto> = {
      fullNameEn: 'A', phone: '+201001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo',
      employmentStatus: 'STUDENT', jobTitle: 'Student', experienceYears: 'Y0_1', primaryArea: 'STUDENT',
      googleEmail: 'a@gmail.com', preferredLanguage: 'en', acceptedTermsAt: '2026-01-01T00:00:00Z',
      mlExperienceYears: 'Y0_1', seniority: 'INTERN', educationLevel: 'BACHELORS',
      linkedinUrl: 'https://www.linkedin.com/in/a', githubUrl: 'https://github.com/a', referralSource: 'LINKEDIN',
      communityAnsweredAt: '2026-01-01T00:00:00Z',
    };
    expect(computeCompleteness(coreOnly)).toMatchObject({ percent: 60, coreComplete: true, missingCore: [] });
    const full: Partial<ProfileDto> = {
      ...coreOnly, company: 'X', industry: 'FINTECH', mlExperienceYears: 'Y1_3', seniority: 'MID',
      secondaryAreas: ['MLOPS'], skills: { PYTHON: 4 },
      cloudPlatforms: ['AWS'], productionTools: ['MLflow'], learningGoals: ['MOVE_TO_MLOPS'],
      interestedTopics: ['RAG'], weeklyHours: 'H_2_5', preferredTimes: ['WEEKEND_EVENINGS'],
      preferredFormat: 'LIVE',
    };
    expect(computeCompleteness(full).percent).toBe(100);
  });
  it('ignores fields the form no longer asks for', () => {
    const base = { fullNameEn: 'A', company: 'X' } as Partial<ProfileDto>;
    const legacy = { ...base, fieldOfStudy: 'CS', university: 'Cairo University', graduationYear: 2020, websiteUrl: 'https://a.dev', kaggleUrl: 'https://kaggle.com/a', huggingfaceUrl: 'https://huggingface.co/a', hasCv: true };
    expect(computeCompleteness(legacy)).toEqual(computeCompleteness(base));
    expect(computeCompleteness({}).incompleteSections).not.toContain('links');
    expect(computeCompleteness({}).incompleteSections).not.toContain('education');
  });
  it('keeps a profile complete without field of study or university', () => {
    const p: Partial<ProfileDto> = {
      fullNameEn: 'A', phone: '+201001234567', country: 'EG', city: 'Cairo', timezone: 'Africa/Cairo',
      employmentStatus: 'STUDENT', jobTitle: 'Student', experienceYears: 'Y0_1', primaryArea: 'STUDENT',
      googleEmail: 'a@gmail.com', preferredLanguage: 'en', acceptedTermsAt: '2026-01-01T00:00:00Z',
      mlExperienceYears: 'Y0_1', seniority: 'INTERN', educationLevel: 'BACHELORS',
      linkedinUrl: 'https://www.linkedin.com/in/a', githubUrl: 'https://github.com/a', referralSource: 'LINKEDIN',
      communityAnsweredAt: '2026-01-01T00:00:00Z', fieldOfStudy: null, university: null,
    };
    expect(computeCompleteness(p).coreComplete).toBe(true);
  });
});
