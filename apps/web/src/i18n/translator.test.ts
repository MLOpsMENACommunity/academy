import { describe, expect, it } from 'vitest';
import { createTranslator, format } from './translator';

describe('ICU plurals (QA L1)', () => {
  const en = createTranslator('en');
  const ar = createTranslator('ar');

  it('English: one and other', () => {
    expect(en('catalog.results', { count: 1 })).toBe('1 course');
    expect(en('catalog.results', { count: 2 })).toBe('2 courses');
    expect(en('catalog.results', { count: 0 })).toBe('0 courses');
    expect(en('sessions.recordingsCount', { count: 1 })).toBe('1 recording');
    expect(en('course.sessionsCount', { count: 1 })).toBe('1 session');
    expect(en('learn.progress', { completed: 1, total: 1 })).toBe('1 of 1 session attended');
  });

  it('Arabic: one, two, 3–10, 11–99 and 100+ use their own forms', () => {
    expect(ar('catalog.results', { count: 1 })).toBe('دورة واحدة');
    expect(ar('catalog.results', { count: 2 })).toBe('دورتان');
    expect(ar('catalog.results', { count: 3 })).toBe('3 دورات');
    expect(ar('catalog.results', { count: 10 })).toBe('10 دورات');
    expect(ar('catalog.results', { count: 11 })).toBe('11 دورة');
    expect(ar('catalog.results', { count: 100 })).toBe('100 دورة');
    expect(ar('catalog.results', { count: 0 })).toBe('لا توجد دورات');
    expect(ar('sessions.recordingsCount', { count: 2 })).toBe('تسجيلان');
    expect(ar('sessions.minutes', { count: 45 })).toBe('45 دقيقة');
    expect(ar('catalog.weeks', { count: 7 })).toBe('7 أسابيع');
    expect(ar('learn.progress', { completed: 1, total: 3 })).toBe('حضرت 1 من 3 جلسات');
  });

  it('every {count} message with a counted noun uses a plural', () => {
    for (const t of [en, ar]) {
      for (const key of [
        'catalog.results',
        'catalog.weeks',
        'catalog.seatsLeft',
        'course.sessionsCount',
        'sessions.recordingsCount',
        'course.facts.perWeek',
      ]) {
        // "1 courses" / "1 دورات": the singular must differ from the plural with the number swapped in.
        expect(t(key, { count: 1 })).not.toBe(t(key, { count: 5 }).replace('5', '1'));
      }
    }
  });

  it('keeps plain {name} interpolation, exact matches and nested placeholders', () => {
    expect(format('Hello {name}', { name: 'Aya' }, 'en')).toBe('Hello Aya');
    expect(format('{missing} stays', {}, 'en')).toBe('{missing} stays');
    expect(format('{n, plural, =0 {none} one {# item} other {# items}}', { n: 0 }, 'en')).toBe(
      'none',
    );
    expect(
      format('{n, plural, one {# of {total}} other {# of {total}}}', { n: 2, total: 5 }, 'en'),
    ).toBe('2 of 5');
    expect(format('a\u0000b', { x: 1 }, 'en')).toBe('a\u0000b');
  });
});
