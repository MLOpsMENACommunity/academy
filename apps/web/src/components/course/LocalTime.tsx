'use client';

import { DEFAULT_TIMEZONE } from '@academy/shared';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { intlLocale } from '@/i18n/config';

type Style = 'date' | 'datetime' | 'time' | 'weekday-datetime';

function fmt(iso: string, locale: 'en' | 'ar', style: Style, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { dateStyle: 'medium' }
      : style === 'time'
        ? { timeStyle: 'short' }
        : style === 'weekday-datetime'
          ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
          : // dateStyle/timeStyle can't be combined with timeZoneName.
            { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone }).format(new Date(iso));
}

/**
 * Server renders Cairo time (the default audience); after hydration the time
 * switches to the visitor's own timezone. Dates are stored in UTC.
 */
export function LocalTime({ iso, style = 'datetime' }: { iso: string; style?: Style }) {
  const { locale } = useI18n();
  const [tz, setTz] = useState(DEFAULT_TIMEZONE);
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE);
  }, []);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {fmt(iso, locale, style, tz)}
    </time>
  );
}

export function ViewerTimezone() {
  const [tz, setTz] = useState(DEFAULT_TIMEZONE);
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE), []);
  return <span className="ltr-embed">{tz.replace(/_/g, ' ')}</span>;
}
