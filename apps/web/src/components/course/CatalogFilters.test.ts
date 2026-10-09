import { describe, expect, it } from 'vitest';
import { matches, type CourseFacets } from './CatalogFilters';

const course: CourseFacets = {
  id: 'c1',
  level: 'BEGINNER',
  type: 'FREE',
  price: 0,
  language: 'AR',
  availability: 'OPEN',
};

describe('catalog filters (in the browser, as the API filters)', () => {
  it('matches with no filters', () => expect(matches(course, {})).toBe(true));
  it('needs every given facet to match', () => {
    expect(matches(course, { type: 'FREE', availability: 'OPEN' })).toBe(true);
    expect(matches(course, { type: 'FREE', level: 'ADVANCED' })).toBe(false);
    expect(matches(course, { language: 'EN' })).toBe(false);
    expect(matches(course, { availability: 'CLOSED' })).toBe(false);
  });

  // QA M1: every course is bilingual, so "English" or "Arabic" used to find nothing.
  it('English or Arabic also finds bilingual courses; "Arabic & English" only bilingual ones', () => {
    const bilingual: CourseFacets = { ...course, language: 'BILINGUAL' };
    expect(matches(bilingual, { language: 'EN' })).toBe(true);
    expect(matches(bilingual, { language: 'AR' })).toBe(true);
    expect(matches(bilingual, { language: 'BILINGUAL' })).toBe(true);
    expect(matches({ ...course, language: 'EN' }, { language: 'BILINGUAL' })).toBe(false);
    expect(matches({ ...course, language: 'EN' }, { language: 'AR' })).toBe(false);
  });

  // QA L17: a paid course whose price isn't announced is not "Paid".
  it('"Paid" needs a price; a price to be announced is its own value', () => {
    const tba: CourseFacets = { ...course, type: 'PAID', price: 0 };
    const paid: CourseFacets = { ...course, type: 'PAID', price: 1500 };
    expect(matches(tba, { type: 'PAID' })).toBe(false);
    expect(matches(tba, { type: 'TBA' })).toBe(true);
    expect(matches(tba, { type: 'FREE' })).toBe(false);
    expect(matches(paid, { type: 'PAID' })).toBe(true);
    expect(matches(paid, { type: 'TBA' })).toBe(false);
    expect(matches(course, { type: 'TBA' })).toBe(false);
  });
});
