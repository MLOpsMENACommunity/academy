import { describe, expect, it } from 'vitest';
import { matches, type CourseFacets } from './CatalogFilters';

const course: CourseFacets = { id: 'c1', level: 'BEGINNER', type: 'FREE', language: 'AR', availability: 'OPEN' };

describe('catalog filters (in the browser, as the API filtered before)', () => {
  it('matches with no filters', () => expect(matches(course, {})).toBe(true));
  it('needs every given facet to match', () => {
    expect(matches(course, { type: 'FREE', availability: 'OPEN' })).toBe(true);
    expect(matches(course, { type: 'FREE', level: 'ADVANCED' })).toBe(false);
    expect(matches(course, { language: 'EN' })).toBe(false);
    expect(matches(course, { availability: 'CLOSED' })).toBe(false);
  });
});
