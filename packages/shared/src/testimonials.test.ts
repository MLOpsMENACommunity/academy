import { describe, expect, it } from 'vitest';
import { adminReviewsQuerySchema, canReviewCourse, courseRating, RATING_MIN_TO_SHOW, testimonialSchema } from './testimonials';

const words = 'This course changed how I ship models to production.';

describe('testimonialSchema', () => {
  it('takes stars, words, or both', () => {
    expect(testimonialSchema.parse({ rating: 4, consent: true })).toEqual({ body: '', rating: 4, consent: true });
    expect(testimonialSchema.parse({ body: words, consent: true })).toEqual({ body: words, rating: null, consent: true });
    expect(testimonialSchema.parse({ body: `  ${words}  `, rating: 5, consent: true })).toEqual({ body: words, rating: 5, consent: true });
    expect(testimonialSchema.parse({ body: '   ', rating: 3, consent: true }).body).toBe('');
  });

  it('needs a rating when there are no words', () => {
    expect(testimonialSchema.safeParse({ consent: true }).success).toBe(false);
    expect(testimonialSchema.safeParse({ body: '', rating: null, consent: true }).success).toBe(false);
  });

  it('keeps the word limits when words are written', () => {
    expect(testimonialSchema.safeParse({ body: 'too short', rating: 5, consent: true }).success).toBe(false);
    expect(testimonialSchema.safeParse({ body: 'x'.repeat(601), rating: 5, consent: true }).success).toBe(false);
  });

  it('only takes whole stars from 1 to 5', () => {
    for (const rating of [0, 6, 4.5, -1, '5']) expect(testimonialSchema.safeParse({ rating, consent: true }).success).toBe(false);
    for (const rating of [1, 2, 3, 4, 5]) expect(testimonialSchema.safeParse({ rating, consent: true }).success).toBe(true);
  });

  it('still needs consent', () => {
    expect(testimonialSchema.safeParse({ rating: 5, consent: false }).success).toBe(false);
    expect(testimonialSchema.safeParse({ rating: 5 }).success).toBe(false);
  });
});

describe('canReviewCourse', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const base = { enrolled: true, selfPaced: false, hasCertificate: false, status: 'OPEN' as const, endDate: null };

  it('never lets someone who is not enrolled review', () => {
    expect(canReviewCourse({ ...base, enrolled: false, selfPaced: true, hasCertificate: true, status: 'COMPLETED' }, now)).toBe(false);
  });
  it('keeps self-paced courses open to any enrolled student', () => {
    expect(canReviewCourse({ ...base, selfPaced: true }, now)).toBe(true);
  });
  it('lets a student with a certificate review', () => {
    expect(canReviewCourse({ ...base, hasCertificate: true }, now)).toBe(true);
  });
  it('lets enrolled students review once the course is over', () => {
    expect(canReviewCourse({ ...base, status: 'COMPLETED' }, now)).toBe(true);
    expect(canReviewCourse({ ...base, endDate: '2026-11-15T00:00:00Z' }, now)).toBe(true);
    expect(canReviewCourse({ ...base, endDate: new Date('2026-11-10') }, now)).toBe(true);
  });
  it('waits while the course is still running', () => {
    expect(canReviewCourse(base, now)).toBe(false);
    expect(canReviewCourse({ ...base, endDate: '2026-11-20T00:00:00Z' }, now)).toBe(false);
    expect(canReviewCourse({ ...base, status: 'CLOSED', endDate: null }, now)).toBe(false);
  });
});

describe('courseRating', () => {
  it('is hidden below the threshold', () => {
    expect(RATING_MIN_TO_SHOW).toBe(5);
    expect(courseRating(0, 0)).toBeNull();
    expect(courseRating(4, 20)).toBeNull();
  });
  it('rounds the average to one decimal', () => {
    expect(courseRating(5, 25)).toEqual({ average: 5, count: 5 });
    expect(courseRating(5, 22)).toEqual({ average: 4.4, count: 5 });
    expect(courseRating(6, 28)).toEqual({ average: 4.7, count: 6 }); // 4.666…
    expect(courseRating(8, 33)).toEqual({ average: 4.1, count: 8 }); // 4.125
    expect(courseRating(38, 179)).toEqual({ average: 4.7, count: 38 }); // 4.71
  });
});

describe('adminReviewsQuerySchema', () => {
  it('defaults to the ones to review', () => {
    expect(adminReviewsQuerySchema.parse({})).toEqual({ status: 'PENDING' });
    expect(adminReviewsQuerySchema.safeParse({ status: 'ALL' }).success).toBe(false);
  });
});
