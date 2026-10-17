import { describe, expect, it } from 'vitest';
import { enrolledOfCapacity, enrolledTotal } from './enrolled-total';

describe('enrolledTotal (admin course header)', () => {
  it('gives the count and seats left, with plurals in both languages', () => {
    expect(enrolledTotal({ enrolledCount: 12, seatsLeft: 18 }, 'en')).toBe('12 enrolled · 18 seats left');
    expect(enrolledTotal({ enrolledCount: 1, seatsLeft: 1 }, 'en')).toBe('1 enrolled · 1 seat left');
    expect(enrolledTotal({ enrolledCount: 12, seatsLeft: 18 }, 'ar')).toBe('12 طالبًا مسجّلًا · متبقٍ 18 مقعدًا');
    expect(enrolledTotal({ enrolledCount: 2, seatsLeft: 3 }, 'ar')).toBe('طالبان مسجّلان · متبقٍ 3 مقاعد');
  });

  it('gives only the count without a capacity, and "Course full" at none left', () => {
    expect(enrolledTotal({ enrolledCount: 12, seatsLeft: null }, 'en')).toBe('12 enrolled');
    expect(enrolledTotal({ enrolledCount: 0, seatsLeft: null }, 'en')).toBe('0 enrolled');
    expect(enrolledTotal({ enrolledCount: 0, seatsLeft: null }, 'ar')).toBe('لا طلاب مسجلون');
    expect(enrolledTotal({ enrolledCount: 30, seatsLeft: 0 }, 'en')).toBe('30 enrolled · Course full');
    expect(enrolledTotal({ enrolledCount: 30, seatsLeft: 0 }, 'ar')).toBe('30 طالبًا مسجّلًا · الدورة مكتملة');
  });
});

describe('enrolledOfCapacity (admin course list)', () => {
  it('adds the capacity when one is set', () => {
    expect(enrolledOfCapacity(12, 30)).toBe('12 / 30');
    expect(enrolledOfCapacity(12, null)).toBe('12');
    expect(enrolledOfCapacity(0, null)).toBe('0');
  });
});
