import { describe, expect, it } from 'vitest';
import { categoryCounts, matchesRecording, recordingsQuerySchema } from './archive';
import { eventInputSchema } from './events';

describe('recordings library categories', () => {
  const handsOn = { topics: ['docker'], category: 'HANDS_ON' as const };
  const industry = { topics: ['mlops'], category: 'INDUSTRY' as const };
  const lesson = { topics: ['docker'], category: 'COURSE_RECORDING' as const };
  const none = { topics: ['docker'], category: null };

  it('filters by category, by topic, or both', () => {
    expect(matchesRecording(handsOn, {})).toBe(true);
    expect(matchesRecording(handsOn, { category: 'HANDS_ON' })).toBe(true);
    expect(matchesRecording(industry, { category: 'HANDS_ON' })).toBe(false);
    expect(matchesRecording(none, { category: 'HANDS_ON' })).toBe(false);
    expect(matchesRecording(lesson, { category: 'COURSE_RECORDING', topic: 'docker' })).toBe(true);
    expect(matchesRecording(lesson, { category: 'COURSE_RECORDING', topic: 'mlops' })).toBe(false);
  });

  it('counts each category in a fixed order and leaves empty ones out', () => {
    expect(categoryCounts([lesson, industry, handsOn, handsOn, none])).toEqual([
      { category: 'HANDS_ON', count: 2 },
      { category: 'INDUSTRY', count: 1 },
      { category: 'COURSE_RECORDING', count: 1 },
    ]);
  });

  it('reads ?category= from the address, ignoring an empty one and rejecting unknown values', () => {
    expect(recordingsQuerySchema.parse({ category: 'INDUSTRY' }).category).toBe('INDUSTRY');
    expect(recordingsQuerySchema.parse({ category: '' }).category).toBeUndefined();
    expect(recordingsQuerySchema.safeParse({ category: 'cooking' }).success).toBe(false);
  });

  it('is set in the session form; left out it is kept, empty clears it', () => {
    const base = { slug: 'talk', status: 'DRAFT', titleEn: 'A talk', startsAt: '2026-11-01T16:00:00Z', durationMin: 60, language: 'AR', platform: 'GOOGLE_MEET' };
    expect(eventInputSchema.parse({ ...base, category: 'INDUSTRY' }).category).toBe('INDUSTRY');
    expect(eventInputSchema.parse(base).category).toBeUndefined();
    expect(eventInputSchema.parse({ ...base, category: '' }).category).toBeNull();
    expect(eventInputSchema.parse({ ...base, category: null }).category).toBeNull();
    expect(eventInputSchema.safeParse({ ...base, category: 'NOPE' }).success).toBe(false);
  });
});
