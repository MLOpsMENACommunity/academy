import { describe, expect, it } from 'vitest';
import { durationLabel, isoDuration } from './archive';

describe('archive helpers', () => {
  it('formats durations in both languages', () => {
    expect(durationLabel(45, 'en')).toBe('45 min');
    expect(durationLabel(120, 'en')).toBe('2 h');
    expect(durationLabel(185, 'en')).toBe('3 h 5 min');
    expect(durationLabel(185, 'ar')).toBe('3 س و5 د');
  });

  it('writes schema.org durations', () => {
    expect(isoDuration(45)).toBe('PT45M');
    expect(isoDuration(120)).toBe('PT2H');
    expect(isoDuration(185)).toBe('PT3H5M');
  });
});
