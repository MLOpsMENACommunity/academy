import { describe, expect, it } from 'vitest';
import { courseInputSchema } from './admin';
import { catalogQuerySchema, courseLevelsText, legacyCourseLevel, levelsFromLegacy, levelsOf, matchesCatalog, type CatalogFacets } from './course';
import { COURSE_LEVELS } from './enums';

describe('course levels (Junior, Mid, Senior, Lead; one or more)', () => {
  it('reads as a list, or as steps up for a course that moves people up a level', () => {
    expect(courseLevelsText({ levels: ['MID', 'JUNIOR'] }, 'en')).toBe('Junior · Mid');
    expect(courseLevelsText({ levels: ['MID', 'SENIOR'], levelProgression: true }, 'en')).toBe('Mid to Senior · Senior to Lead');
    expect(courseLevelsText({ levels: ['MID', 'SENIOR'], levelProgression: true }, 'ar')).toBe('من متوسط الخبرة إلى خبير · من خبير إلى قائد فريق');
    expect(courseLevelsText({ levels: ['JUNIOR', 'MID'] }, 'ar')).toBe('مبتدئ · متوسط الخبرة');
    expect(courseLevelsText({ levels: [] }, 'en')).toBe('All levels');
    expect(courseLevelsText({ levels: ['LEAD'], levelProgression: true }, 'en')).toBe('Lead');
  });

  it('maps the old single level both ways, so old values survive a round trip', () => {
    for (const level of COURSE_LEVELS) expect(legacyCourseLevel(levelsFromLegacy(level))).toBe(level);
    expect(legacyCourseLevel(['JUNIOR', 'MID'])).toBe('INTERMEDIATE');
    expect(legacyCourseLevel(['SENIOR', 'LEAD'])).toBe('ADVANCED');
    expect(legacyCourseLevel(['JUNIOR', 'MID', 'SENIOR', 'LEAD'])).toBe('ALL_LEVELS');
    // An API from before levels sends only `level`.
    expect(levelsOf({ level: 'ADVANCED' })).toEqual(['SENIOR']);
    expect(levelsOf({ levels: ['MID', 'JUNIOR'], level: 'ADVANCED' })).toEqual(['JUNIOR', 'MID']);
  });

  it('admin saves: levels in order, the old level derived; older clients sending only `level` still work', () => {
    const base = {
      slug: 'x', titleEn: 'Course', titleAr: '', shortDescriptionEn: 'A short description', shortDescriptionAr: '',
      longDescriptionEn: '', longDescriptionAr: '', type: 'FREE', price: 0, requiresApproval: true, status: 'DRAFT', language: 'AR',
      targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' }, learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] },
      outline: [], faq: [], included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
      deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'YOUTUBE',
    };
    const multi = courseInputSchema.parse({ ...base, levels: ['MID', 'JUNIOR', 'MID'] });
    expect(multi.levels).toEqual(['JUNIOR', 'MID']);
    expect(multi.level).toBe('INTERMEDIATE');
    expect(multi.levelProgression).toBe(false);
    const old = courseInputSchema.parse({ ...base, level: 'ADVANCED' });
    expect(old.levels).toEqual(['SENIOR']);
    expect(old.level).toBe('ADVANCED');
    expect(courseInputSchema.parse(base).levels).toEqual([]);
    expect(courseInputSchema.safeParse({ ...base, levels: ['EXPERT'] }).success).toBe(false);
  });

  it('the catalog filter matches when any of the course levels does, and old ?level= links still filter', () => {
    const c: CatalogFacets = { levels: ['JUNIOR', 'MID'], type: 'FREE', price: 0, language: 'AR', availability: 'OPEN' };
    expect(matchesCatalog(c, catalogQuerySchema.parse({ level: 'MID' }))).toBe(true);
    expect(matchesCatalog(c, catalogQuerySchema.parse({ level: 'LEAD' }))).toBe(false);
    expect(catalogQuerySchema.parse({ level: 'BEGINNER' }).level).toBe('JUNIOR');
    expect(catalogQuerySchema.parse({ level: 'ALL_LEVELS' }).level).toBeUndefined();
    expect(catalogQuerySchema.safeParse({ level: 'NOPE' }).success).toBe(false);
    expect(matchesCatalog({ ...c, levels: [] }, { level: 'LEAD' })).toBe(true);
  });
});
