import { describe, expect, it } from 'vitest';
import { pickSourceParams, safeReturnTo } from './urls';

describe('safeReturnTo', () => {
  it('keeps same-origin paths', () => {
    expect(safeReturnTo('/en/courses/kubernetes?ref=main-site')).toBe('/en/courses/kubernetes?ref=main-site');
  });
  it.each(['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '', 42, '/a\\b'])(
    'falls back for %s',
    (v) => {
      expect(safeReturnTo(v)).toBe('/dashboard');
    },
  );
});

describe('pickSourceParams', () => {
  it('keeps only known tracking params', () => {
    expect(pickSourceParams({ ref: 'main-site', utm_source: 'li', x: 'y' })).toEqual({
      ref: 'main-site',
      utm_source: 'li',
    });
  });
});
