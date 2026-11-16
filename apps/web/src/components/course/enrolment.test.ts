import { describe, expect, it } from 'vitest';
import { enrolmentFacts, ratingFacts } from './CourseCard';

const open = { availability: 'OPEN', completed: false } as const;

describe('enrolmentFacts (course page and cards)', () => {
  it('says how many students are enrolled, with plurals in both languages', () => {
    expect(enrolmentFacts({ ...open, enrolledCount: 1, seatsLeft: null }, 'en').enrolled).toBe('1 student enrolled');
    expect(enrolmentFacts({ ...open, enrolledCount: 12, seatsLeft: null }, 'en').enrolled).toBe('12 students enrolled');
    expect(enrolmentFacts({ ...open, enrolledCount: 0, seatsLeft: null }, 'en').enrolled).toBe('No students enrolled yet');
    expect(enrolmentFacts({ ...open, enrolledCount: 2, seatsLeft: null }, 'ar').enrolled).toBe('طالبان مسجّلان');
    expect(enrolmentFacts({ ...open, enrolledCount: 5, seatsLeft: null }, 'ar').enrolled).toBe('5 طلاب مسجّلون');
    expect(enrolmentFacts({ ...open, enrolledCount: 0, seatsLeft: null }, 'ar').enrolled).toBe('لا يوجد طلاب مسجلون بعد');
  });

  it('seats left while open, "Course full" at 0, nothing when the API sends null', () => {
    expect(enrolmentFacts({ ...open, enrolledCount: 3, seatsLeft: 7 }, 'en')).toEqual({ enrolled: '3 students enrolled', seats: '7 seats left' });
    expect(enrolmentFacts({ ...open, enrolledCount: 10, seatsLeft: 0 }, 'en').seats).toBe('Course full');
    expect(enrolmentFacts({ ...open, enrolledCount: 10, seatsLeft: 0 }, 'ar').seats).toBe('الدورة مكتملة');
    expect(enrolmentFacts({ ...open, enrolledCount: 3, seatsLeft: null }, 'en').seats).toBeNull();
  });

  it('hides the count when the course hides it, and "none yet" unless the course is open', () => {
    expect(enrolmentFacts({ ...open, enrolledCount: null, seatsLeft: 4 }, 'en')).toEqual({ enrolled: null, seats: '4 seats left' });
    expect(enrolmentFacts({ availability: 'CLOSED', completed: true, enrolledCount: 0, seatsLeft: null }, 'en').enrolled).toBeNull();
    expect(enrolmentFacts({ availability: 'CLOSED', completed: true, enrolledCount: 25, seatsLeft: null }, 'en').enrolled).toBe('25 students enrolled');
  });
});

describe('ratingFacts (course page and cards)', () => {
  it('shows nothing until there is a public rating', () => {
    expect(ratingFacts(null, 'en')).toBeNull();
    expect(ratingFacts(undefined, 'ar')).toBeNull();
  });
  it('says the average with one decimal and the count, in both languages', () => {
    expect(ratingFacts({ average: 4.7, count: 38 }, 'en')).toEqual({ text: '4.7 ★ (38 ratings)', label: 'Rated 4.7 out of 5 from 38 ratings' });
    expect(ratingFacts({ average: 5, count: 5 }, 'en')?.text).toBe('5.0 ★ (5 ratings)');
    expect(ratingFacts({ average: 4.4, count: 5 }, 'ar')?.text).toMatch(/^4[.٫]4 ★ \(5 تقييمات\)$/);
    expect(ratingFacts({ average: 4.4, count: 11 }, 'ar')?.text).toMatch(/11 تقييمًا/);
  });
});
