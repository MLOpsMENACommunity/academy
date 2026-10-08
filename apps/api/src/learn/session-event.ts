import type { Locale } from '@academy/shared';
import type { IcsEvent } from './ics';

/** The only session fields a calendar entry may use: no live, recording or material links. */
export interface SessionForCalendar {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
  startsAt: Date;
  durationMin: number;
  updatedAt: Date;
}

export interface CourseForCalendar {
  slug: string;
  titleEn: string;
  titleAr: string;
}

/**
 * A course session as a calendar event. The live link is deliberately left out
 * (invites get forwarded and feed URLs end up in calendar apps): the event
 * points at the course page, which reveals the link to enrolled students.
 * The UID is the session id, so downloads and the subscription feed agree.
 */
export function courseSessionEvent(s: SessionForCalendar, course: CourseForCalendar, locale: Locale, webUrl: string): IcsEvent {
  const courseTitle = locale === 'ar' ? course.titleAr : course.titleEn;
  const url = `${webUrl}/${locale}/learn/${course.slug}#session-${s.order}`;
  return {
    uid: s.id,
    title: `${courseTitle}: ${locale === 'ar' ? s.titleAr : s.titleEn}`,
    description: locale === 'ar' ? `رابط الجلسة في صفحة الدورة: ${url}` : `Join from your course page: ${url}`,
    url,
    start: s.startsAt,
    durationMin: s.durationMin,
    updatedAt: s.updatedAt,
  };
}
