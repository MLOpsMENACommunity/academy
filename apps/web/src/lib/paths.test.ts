import type { CourseSummaryDto, RecordingDto } from '@academy/shared';
import { describe, expect, it } from 'vitest';
import { buildMenuData } from '@/components/layout/menu';
import { courseStatus, findPath, LEARNING_PATHS, resolveSteps } from './paths';

const course = (slug: string, over: Partial<CourseSummaryDto> = {}): CourseSummaryDto =>
  ({
    id: slug,
    slug,
    titleEn: `Course ${slug}`,
    titleAr: `دورة ${slug}`,
    shortDescriptionEn: 'Short',
    shortDescriptionAr: 'قصير',
    type: 'FREE',
    price: 0,
    currency: 'EGP',
    level: 'BEGINNER',
    levels: ['JUNIOR'],
    levelProgression: false,
    language: 'AR',
    startDate: null,
    applicationDeadline: null,
    durationWeeks: null,
    hoursPerWeek: null,
    coverImageUrl: null,
    availability: 'UPCOMING',
    seatsRemaining: null,
    instructorNames: ['Aya'],
    completed: false,
    cohortNumber: null,
    endDate: null,
    topics: [],
    ...over,
  }) as CourseSummaryDto;

const recording = (slug: string): RecordingDto => ({
  id: `event:${slug}`,
  kind: 'event',
  path: `/sessions/${slug}`,
  titleEn: `Talk ${slug}`,
  titleAr: `جلسة ${slug}`,
  course: null,
  startsAt: '2026-05-01T16:00:00.000Z',
  durationMin: 90,
  topics: [],
  category: 'HANDS_ON',
  recordingUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  youtubeId: 'abcdefghijk',
  speakers: [{ slug: 'x', name: 'Speaker', nameAr: 'متحدث', titleEn: null, titleAr: null, photoUrl: null }],
});

describe('learning paths', () => {
  it('have unique slugs and at least two steps each', () => {
    expect(new Set(LEARNING_PATHS.map((p) => p.slug)).size).toBe(LEARNING_PATHS.length);
    for (const p of LEARNING_PATHS) expect(p.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('resolve steps in order and leave out what is not public', () => {
    const path = findPath('mlops-engineer')!;
    const steps = resolveSteps(path, [course('mlops-practitioner', { completed: true }), course('llmops')], [recording('docker-deep-dive')], 'ar');
    expect(steps.map((s) => s.slug)).toEqual(['docker-deep-dive', 'mlops-practitioner', 'llmops']);
    expect(steps[0]).toMatchObject({ kind: 'recording', title: 'جلسة docker-deep-dive', status: 'recording', people: ['متحدث'], path: '/sessions/docker-deep-dive' });
    expect(steps[1]).toMatchObject({ kind: 'course', status: 'completed', path: '/courses/mlops-practitioner' });
    expect(steps[2]!.status).toBe('upcoming');
  });

  it('maps course availability to a step status', () => {
    expect(courseStatus({ completed: false, availability: 'OPEN' })).toBe('open');
    expect(courseStatus({ completed: true, availability: 'CLOSED' })).toBe('completed');
    expect(courseStatus({ completed: false, availability: 'CLOSED' })).toBe('closed');
  });
});

describe('header menu data', () => {
  it('counts courses and features open, then upcoming, then past ones', () => {
    const data = buildMenuData([course('a', { completed: true }), course('b'), course('c', { availability: 'OPEN' }), course('d', { availability: 'CLOSED' })], 'en');
    expect(data.coursesLine).toBe('4 courses · 1 taking applications');
    expect(data.featured.map((f) => f.href)).toEqual(['/en/courses/c', '/en/courses/b', '/en/courses/a']);
    expect(data.featured.map((f) => f.tone)).toEqual(['success', 'accent', 'muted']);
  });

  it('is empty when the course list could not be loaded', () => {
    expect(buildMenuData(null, 'ar')).toEqual({ coursesLine: null, featured: [] });
  });
});
