'use client';

import type { ConsultantDetailDto, MyConsultationDto } from '@academy/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { TextAreaField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';
import { dateKey, dayLabel, egp, timeLabel } from './shared';

/**
 * Pick a call length, a day and a time (shown in the visitor's own time zone), add a note,
 * and reserve. The slot is held at once; the booking page then says how to pay.
 */
export function BookingPanel({ expert }: { expert: ConsultantDetailDto }) {
  const { locale, t } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const here = usePathname() ?? `/${locale}/consultations/${expert.slug}`;
  const lengths = ([30, 60] as const).filter((m) => (m === 30 ? expert.price30Egp : expert.price60Egp) !== null);
  const [duration, setDuration] = useState<30 | 60>(lengths[0] ?? 30);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tz, setTz] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTz(viewerTimezone()), []);

  const load = useCallback(() => {
    let current = true;
    setSlots(null);
    setLoadError(false);
    setSlot(null);
    api<string[]>(`/consultations/experts/${expert.slug}/slots?duration=${duration}`)
      .then((s) => current && setSlots(s))
      .catch(() => current && setLoadError(true));
    return () => {
      current = false;
    };
  }, [expert.slug, duration]);
  useEffect(() => load(), [load]);

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
  const price = duration === 30 ? expert.price30Egp : expert.price60Egp;

  async function reserve() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<MyConsultationDto>(`/consultations/experts/${expert.slug}/bookings`, { method: 'POST', json: { durationMin: duration, startsAt: slot, note } });
      router.push(`/${locale}/consultations/bookings/${b.id}`);
    } catch (err) {
      setError(errorMessage(err, t));
      // Someone took it meanwhile, or the expert's hours changed: show what's open now.
      if (err instanceof ApiError && (err.code === 'SLOT_TAKEN' || err.code === 'EXPERT_CHANGED')) load();
      setBusy(false);
    }
  }

  return (
    <Card className="flex h-fit flex-col gap-5 p-5 lg:sticky lg:top-6">
      <h2 className="text-[1.25rem]">{t('consultations.expert.bookTitle')}</h2>

      {lengths.length > 1 && (
        <fieldset>
          <legend className="text-[0.9375rem] font-medium text-fg">{t('consultations.expert.length')}</legend>
          <div className="mt-2 flex gap-2">
            {lengths.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={duration === m}
                onClick={() => setDuration(m)}
                className={`min-h-11 flex-1 rounded-xl border px-3 text-[0.9375rem] ${duration === m ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line text-body hover:bg-muted-bg'}`}
              >
                {t('consultations.minutes', { min: m })}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {price !== null && <p className="text-[0.9375rem] text-body">{t('consultations.expert.price', { price: egp(price, locale), min: duration })}</p>}

      {loadError ? (
        <Alert tone="danger">
          {t('consultations.expert.slotsError')}{' '}
          <button type="button" onClick={load} className="font-medium underline">
            {t('consultations.retry')}
          </button>
        </Alert>
      ) : !slots || !tz ? (
        <p className="text-muted" aria-live="polite">
          {t('consultations.loading')}
        </p>
      ) : days.length === 0 ? (
        <p className="text-muted">{t('consultations.expert.noSlots', { days: expert.horizonDays })}</p>
      ) : (
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
                    setSlot(null);
                  }}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 text-[0.875rem] whitespace-nowrap ${shownDay?.key === d.key ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line text-body hover:bg-muted-bg'}`}
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
                    aria-pressed={slot === s}
                    onClick={() => setSlot(s)}
                    className={`min-h-11 rounded-xl border text-[0.9375rem] tabular-nums ${slot === s ? 'border-primary bg-primary text-white' : 'border-line text-body hover:bg-muted-bg'}`}
                  >
                    {timeLabel(s, locale, tz)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted">{t('consultations.expert.timesIn', { tz })}</p>
            </fieldset>
          )}
        </>
      )}

      {authLoading ? null : user ? (
        <>
          <TextAreaField label={t('consultations.expert.note')} hint={t('consultations.expert.noteHint')} value={note} onChange={setNote} maxLength={1000} rows={3} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="button" variant="accent" size="lg" onClick={() => void reserve()} disabled={!slot} loading={busy}>
            {t('consultations.expert.reserve')}
          </Button>
          <p className="text-[0.8125rem] leading-relaxed text-muted">{t('consultations.expert.reserveHint')}</p>
        </>
      ) : (
        <Link href={`/${locale}/login?returnTo=${encodeURIComponent(here)}`} className={buttonClass('accent', 'lg', 'w-full')}>
          {t('consultations.expert.signIn')}
        </Link>
      )}
    </Card>
  );
}
