import { describe, expect, it } from 'vitest';
import { parseTopics, recordingsQuerySchema, slugify, topicLabel, topicsSchema } from './archive';
import { eventInputSchema } from './events';
import { courseInputSchema, instructorInputSchema } from './admin';

describe('archive topics', () => {
  it('normalises tags and drops duplicates', () => {
    expect(topicsSchema.parse(['Model Serving', 'docker', 'DOCKER', 'ci_cd'])).toEqual(['model-serving', 'docker', 'ci-cd']);
    expect(topicsSchema.safeParse(['no!']).success).toBe(false);
  });

  it('parses a comma-separated admin field, Arabic commas included', () => {
    expect(parseTopics('docker, CI/CD ، model serving,, !!')).toEqual(['docker', 'ci-cd', 'model-serving']);
  });

  it('labels known tags in both languages and shows others as typed', () => {
    expect(topicLabel('model-serving', 'ar')).toBe('خدمة النماذج');
    expect(topicLabel('ci-cd', 'en')).toBe('CI/CD');
    expect(topicLabel('rust', 'ar')).toBe('rust');
  });

  it('accepts an empty topic in the recordings query', () => {
    expect(recordingsQuerySchema.parse({ topic: '', q: ' mlflow ' })).toEqual({ topic: undefined, q: 'mlflow' });
  });
});

describe('speakers', () => {
  it('makes slugs from names', () => {
    expect(slugify('Eng. Sameh Amin')).toBe('eng-sameh-amin');
    expect(slugify('Layla Member Salama')).toBe('aya-nasser-salama');
    expect(slugify('محمد')).toBe('');
  });

  it('allows a site photo path but not other schemes', () => {
    const base = { name: 'Layla Member', titleEn: 'Engineer', linkedinUrl: 'https://www.linkedin.com/in/ayanasser' };
    expect(instructorInputSchema.parse({ ...base, photoUrl: '/speakers/aya.webp' }).photoUrl).toBe('/speakers/aya.webp');
    expect(instructorInputSchema.safeParse({ ...base, photoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(instructorInputSchema.safeParse({ ...base, photoUrl: '//evil.example/x.png' }).success).toBe(false);
    expect(instructorInputSchema.parse(base).bioEn).toBe('');
  });
});

describe('past sessions', () => {
  const base = {
    slug: 'old-talk',
    status: 'PUBLISHED',
    titleEn: 'Old talk',
    titleAr: 'محاضرة قديمة',
    durationMin: 60,
    language: 'AR',
    platform: 'YOUTUBE_LIVE',
  };

  it('publishes a session that already happened without a join link', () => {
    expect(eventInputSchema.safeParse({ ...base, startsAt: '2026-01-01T18:00:00Z' }).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...base, startsAt: new Date(Date.now() + 86_400_000).toISOString() }).success).toBe(false);
  });

  it('keeps /sessions/recordings free', () => {
    expect(eventInputSchema.safeParse({ ...base, slug: 'recordings', startsAt: '2026-01-01T18:00:00Z' }).success).toBe(false);
  });
});

describe('public course recordings', () => {
  const course = {
    slug: 'c', titleEn: 'Course', titleAr: 'دورة', shortDescriptionEn: 'A course for testing.', shortDescriptionAr: 'دورة للاختبار فقط.',
    longDescriptionEn: '', longDescriptionAr: '', type: 'FREE', price: 0, requiresApproval: true, status: 'COMPLETED', level: 'ALL_LEVELS',
    language: 'EN', targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' }, learningOutcomes: { en: [], ar: [] },
    prerequisites: { en: [], ar: [] }, outline: [], faq: [],
    included: { liveSessions: true, recordings: true, assignments: false, finalProject: false, certificate: false },
    deliveryPlatform: 'YOUTUBE_LIVE', recordingsPlatform: 'YOUTUBE', publicRecordings: true,
  };

  it('are allowed for a free course on YouTube only', () => {
    expect(courseInputSchema.safeParse(course).success).toBe(true);
    expect(courseInputSchema.safeParse({ ...course, type: 'PAID', price: 100 }).success).toBe(false);
    expect(courseInputSchema.safeParse({ ...course, recordingsPlatform: 'GOOGLE_DRIVE' }).success).toBe(false);
  });
});
