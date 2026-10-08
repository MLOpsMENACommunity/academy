import type { Locale } from '@academy/shared';
import type { IcsEvent } from '../learn/ics';

/** The only live-session fields a calendar entry may use: never liveUrl. */
export interface LiveEventForCalendar {
  id: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  titleEn: string;
  titleAr: string;
  startsAt: Date;
  durationMin: number;
  updatedAt: Date;
}

/**
 * A live session as a calendar event, shared by the per-session .ics download and
 * the personal subscription feed, so both use the same UID (`event-<id>`) and a
 * calendar that has the import and the subscription can tell they're the same.
 * The join link is never included: the event points at the public session page.
 */
export function liveEventIcsEvent(e: LiveEventForCalendar, locale: Locale, webUrl: string): IcsEvent {
  const ar = locale === 'ar';
  const title = ar ? e.titleAr || e.titleEn : e.titleEn;
  const url = `${webUrl}/${locale}/sessions/${e.slug}`;
  return {
    uid: `event-${e.id}`,
    title,
    description: ar
      ? `جلسة مباشرة من أكاديمية MLOps MENA. يظهر رابط الانضمام في ${url} قبل البدء بوقت قصير.`
      : `Live session by MLOps MENA Academy. The join link appears on ${url} shortly before the start.`,
    url,
    start: e.startsAt,
    durationMin: e.durationMin,
    updatedAt: e.updatedAt,
    cancelled: e.status === 'CANCELLED',
  };
}
