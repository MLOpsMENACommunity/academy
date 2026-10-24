'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { viewerTimezone } from '@/lib/format';
import { dateKey, dayLabel, timeLabel } from './shared';

/**
 * An expert's open times for one call length: pick a day, then a time, shown in the visitor's
 * own time zone. `reloadKey` changes to fetch again (after "that time was just taken").
 */
export function SlotPicker({
  slug,
  duration,
  horizonDays,
  value,
  onChange,
  reloadKey = 0,
}: {
  slug: string;
  duration: number;
  horizonDays: number;
  value: string | null;
  onChange: (slot: string | null) => void;
  reloadKey?: number;
}) {
  const { locale, t } = useI18n();
  const [slots, setSlots] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tz, setTz] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => setTz(viewerTimezone()), []);
  useEffect(() => {
    let current = true;
    setSlots(null);
    setFailed(false);
    onChange(null);
    api<string[]>(`/consultations/experts/${slug}/slots?duration=${duration}`)
      .then((s) => current && setSlots(s))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
    // onChange is the parent's setter: leaving it out keeps a new function from refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, duration, reloadKey, retry]);

  const days = useMemo(() => {
    if (!slots || !tz) return [];
    const byDay = new Map<string, string[]>();
    for (const s of slots) {
      const k = dateKey(s, tz);
      byDay.set(k, [...(byDay.get(k) ?? []), s]);
    }
    return [...byDay.entries()].map(([key, times]) => ({ key, times }));
  }, [slots, tz]);
  const shownDay = days.find((d) => d.key === day) ?? days[0];

  if (failed) {
    return (
      <Alert tone="danger">
        {t('consultations.expert.slotsError')}{' '}
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="font-medium underline">
          {t('consultations.retry')}
        </button>
      </Alert>
    );
  }
  if (!slots || !tz) {
    return (
      <p className="text-muted" aria-live="polite">
        {t('consultations.loading')}
      </p>
    );
  }
  if (days.length === 0) return <p className="text-muted">{t('consultations.expert.noSlots', { days: horizonDays })}</p>;

  const chip = (on: boolean) => `min-h-11 rounded-xl border ${on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line text-body hover:bg-muted-bg'}`;
  return (
    <>
      <fieldset>
        <legend className="text-[0.9375rem] font-medium text-fg">{t('consultations.expert.pickDay')}</legend>
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={shownDay?.key === d.key}
              onClick={() => {
                setDay(d.key);
                onChange(null);
              }}
              className={`${chip(shownDay?.key === d.key)} shrink-0 px-3 text-[0.875rem] whitespace-nowrap`}
            >
              {dayLabel(d.times[0]!, locale, tz)}
            </button>
          ))}
        </div>
      </fieldset>
      {shownDay && (
        <fieldset>
          <legend className="text-[0.9375rem] font-medium text-fg">{t('consultations.expert.pickTime')}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shownDay.times.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={value === s}
                onClick={() => onChange(s)}
                className={`min-h-11 rounded-xl border text-[0.9375rem] tabular-nums ${value === s ? 'border-primary bg-primary text-white' : 'border-line text-body hover:bg-muted-bg'}`}
              >
                {timeLabel(s, locale, tz)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.8125rem] text-muted">{t('consultations.expert.timesIn', { tz })}</p>
        </fieldset>
      )}
    </>
  );
}
