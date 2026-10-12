import { DEFAULT_TIMEZONE, isValidTimezone } from '@academy/shared';

/** "Tuesday 4 November, 18:00 EET" in the student's language and time zone (Cairo when unknown). */
export function formatDueAt(at: Date, locale: 'en' | 'ar', timezone: string | null | undefined): string {
  const tz = timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short',
  }).format(at);
}
