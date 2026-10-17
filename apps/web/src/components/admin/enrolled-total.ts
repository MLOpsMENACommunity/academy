import type { Locale } from '@academy/shared';
import { createTranslator } from '@/i18n/translator';

/**
 * The admin course header's "12 enrolled · 18 seats left" (or "12 enrolled" without a capacity,
 * "Course full" at none left). Admins always see the number, even when the course hides it
 * publicly; it is the public count (CoursesService.seatCounts), and seats left use the public rule.
 */
export function enrolledTotal(c: { enrolledCount: number; seatsLeft: number | null }, locale: Locale): string {
  const t = createTranslator(locale);
  const seats = c.seatsLeft === null ? null : c.seatsLeft === 0 ? t('catalog.courseFull') : t('catalog.seatsLeft', { count: c.seatsLeft });
  return [t('admin.courses.enrolledTotal', { count: c.enrolledCount }), seats].filter(Boolean).join(' · ');
}

/** The course list's Enrolled cell: "12 / 30" with a capacity, else "12". */
export function enrolledOfCapacity(enrolledCount: number, capacity: number | null): string {
  return capacity ? `${enrolledCount} / ${capacity}` : String(enrolledCount);
}
