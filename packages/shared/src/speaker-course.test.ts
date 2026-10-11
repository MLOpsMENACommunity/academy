import { describe, expect, it } from 'vitest';
import { courseInputSchema } from './admin';
import { eventPublishMissing } from './events';
import { courseDraftFromBooking, prerequisiteList, shortDescription } from './speaker-course';

describe('courseDraftFromBooking', () => {
  const startsAt = new Date('2026-12-05T17:00:00Z');
  const abstract = 'Feature pipelines, online and offline stores, and the monitoring that keeps them honest in production.';

  it('prefills a free draft course from the booking', () => {
    const d = courseDraftFromBooking({
      title: 'Shipping models',
      abstract,
      language: 'AR',
      startsAt,
      details: {
        audience: 'Data scientists',
        prerequisites: '1. Python\n* Docker',
        outcomes: ['Package a model'],
        level: 'ADVANCED',
        language: 'EN',
        tags: ['Model Serving', 'not a valid tag!'],
        course: { modules: [{ title: '', description: 'Intro' }], weeklyHours: 0.5, durationWeeks: 4, materialsUrl: 'https://example.com/m' },
      },
    });
    expect(d).toMatchObject({
      status: 'DRAFT',
      type: 'FREE',
      price: 0,
      titleEn: 'Shipping models',
      titleAr: '',
      shortDescriptionEn: abstract,
      levels: ['SENIOR'],
      level: 'ADVANCED',
      language: 'EN',
      startDate: startsAt,
      durationWeeks: 4,
      hoursPerWeek: 1,
      prerequisites: { en: ['Python', 'Docker'], ar: [] },
      outline: [{ titleEn: 'Module 1', titleAr: 'Module 1', descriptionEn: 'Intro' }],
      preparation: { en: 'Course materials: https://example.com/m', ar: '' },
      topics: ['model-serving'],
    });
  });

  it('falls back to the application language and all levels, and passes the course editor as a draft', () => {
    const d = courseDraftFromBooking({ title: 'Shipping models', abstract, language: 'AR', startsAt, details: {} });
    expect(d).toMatchObject({ language: 'AR', levels: [], level: 'ALL_LEVELS', durationWeeks: null, hoursPerWeek: null, outline: [], topics: [] });
    const parsed = courseInputSchema.safeParse({ ...d, slug: 'shipping-models', currency: 'EGP', requiresApproval: true, capacity: null, deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'YOUTUBE', instructorIds: [] });
    expect(parsed.success).toBe(true);
    // Publishing still asks for the Arabic texts.
    expect(courseInputSchema.safeParse({ ...d, status: 'OPEN', slug: 'shipping-models', requiresApproval: true, deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'YOUTUBE' }).success).toBe(false);
  });
});

describe('shortDescription and prerequisiteList', () => {
  it('cuts long text at a word, within the limit', () => {
    const long = 'word '.repeat(200);
    const short = shortDescription(long);
    expect(short.length).toBeLessThanOrEqual(400);
    expect(short.endsWith('word…')).toBe(true);
    expect(shortDescription('  a  short\ntext ')).toBe('a short text');
  });

  it('reads one prerequisite per line', () => {
    expect(prerequisiteList(undefined)).toEqual([]);
    expect(prerequisiteList('Python')).toEqual(['Python']);
    expect(prerequisiteList('- Python\n\n• SQL\n2) Git')).toEqual(['Python', 'SQL', 'Git']);
  });
});

describe('eventPublishMissing', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  it('lists the Arabic title and the live link for an upcoming session', () => {
    expect(eventPublishMissing({ titleAr: '', liveUrl: null, startsAt: '2026-11-01T17:00:00Z', durationMin: 60 }, now)).toEqual(['titleAr', 'liveUrl']);
    expect(eventPublishMissing({ titleAr: 'جلسة', liveUrl: 'https://meet.google.com/x', startsAt: '2026-11-01T17:00:00Z', durationMin: 60 }, now)).toEqual([]);
  });
  it("doesn't ask a past session for a live link", () => {
    expect(eventPublishMissing({ titleAr: 'جلسة', liveUrl: null, startsAt: '2026-10-01T17:00:00Z', durationMin: 60 }, now)).toEqual([]);
  });
});
