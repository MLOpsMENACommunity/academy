import { describe, expect, it } from 'vitest';
import { courseVisibleEmailsSchema, MAX_COURSE_VISIBLE_EMAILS } from './admin';
import { courseVisibleTo, isPrivateCourse } from './course';

describe('courseVisibleEmailsSchema', () => {
  it('trims, lower-cases, drops blanks and de-duplicates', () => {
    expect(courseVisibleEmailsSchema.parse([' Sara@Example.com ', '', 'sara@example.com', 'omar@example.org'])).toEqual([
      'sara@example.com',
      'omar@example.org',
    ]);
  });
  it('accepts the form text, one address per line', () => {
    expect(courseVisibleEmailsSchema.parse('A@x.io\n\n b@y.io \r\na@x.io')).toEqual(['a@x.io', 'b@y.io']);
  });
  it('empty means a public course', () => {
    expect(courseVisibleEmailsSchema.parse([])).toEqual([]);
    expect(courseVisibleEmailsSchema.parse('   \n ')).toEqual([]);
  });
  it('rejects anything that is not an email address', () => {
    expect(courseVisibleEmailsSchema.safeParse(['sara@example.com', 'not-an-email']).success).toBe(false);
  });
  it(`allows at most ${MAX_COURSE_VISIBLE_EMAILS} addresses (after de-duplication)`, () => {
    const many = Array.from({ length: MAX_COURSE_VISIBLE_EMAILS }, (_, i) => `u${i}@x.io`);
    expect(courseVisibleEmailsSchema.safeParse([...many, ...many]).success).toBe(true);
    expect(courseVisibleEmailsSchema.safeParse([...many, 'one-more@x.io']).success).toBe(false);
  });
});

describe('courseVisibleTo', () => {
  it('shows a public course to everyone and a private one only to listed accounts', () => {
    expect(isPrivateCourse({ visibleToEmails: [] })).toBe(false);
    expect(courseVisibleTo({ visibleToEmails: [] }, null)).toBe(true);
    const c = { visibleToEmails: ['sara@example.com'] };
    expect(isPrivateCourse(c)).toBe(true);
    expect(courseVisibleTo(c, null)).toBe(false);
    expect(courseVisibleTo(c, 'omar@example.com')).toBe(false);
    expect(courseVisibleTo(c, ' Sara@Example.com')).toBe(true);
  });
});
