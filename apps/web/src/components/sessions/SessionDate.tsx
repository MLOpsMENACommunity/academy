'use client';

import { DEFAULT_TIMEZONE } from '@academy/shared';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { dateParts } from '@/lib/sessions';

/** Cairo time on the server (the default audience), the visitor's own zone after hydration. */
function useViewerTz(): string {
  const [tz, setTz] = useState(DEFAULT_TIMEZONE);
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE), []);
  return tz;
}

/** The big date of the featured session: weekday, day, month and time. */
export function DateBlock({ iso, className = '' }: { iso: string; className?: string }) {
  const { locale } = useI18n();
  const p = dateParts(iso, locale, useViewerTz());
  return (
    <time dateTime={iso} suppressHydrationWarning className={`flex flex-col ${className}`}>
      <span className="text-[0.9375rem] font-medium text-primary">{p.weekday}</span>
      <span className="text-[3.5rem] leading-[1.1] font-semibold text-fg">{p.day}</span>
      <span className="text-[0.9375rem] text-muted">
        {p.month} · {p.time}
      </span>
    </time>
  );
}

/** Compact month-over-day tile for lists. */
export function DateTile({ iso }: { iso: string }) {
  const { locale } = useI18n();
  const p = dateParts(iso, locale, useViewerTz());
  return (
    <time dateTime={iso} suppressHydrationWarning className="flex w-14 shrink-0 flex-col items-center text-center">
      <span className="text-xs text-muted">{p.month}</span>
      <span className="text-2xl leading-tight font-semibold text-fg">{p.day}</span>
    </time>
  );
}

/** Weekday and time, for the line under a list item's title. */
export function DayTime({ iso }: { iso: string }) {
  const { locale } = useI18n();
  const p = dateParts(iso, locale, useViewerTz());
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {p.weekday} · {p.time}
    </time>
  );
}
