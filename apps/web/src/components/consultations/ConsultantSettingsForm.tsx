'use client';

import { DEFAULT_TIMEZONE, minutesOf, type AvailabilityWindow, type ConsultantSettingsDto } from '@academy/shared';
import { useState } from 'react';
import { CheckboxField, SelectField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Zones the academy's experts are likely in; any other saved zone is kept as an extra option. */
const ZONES = [
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Baghdad',
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Algiers',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];
/** Saturday first, as the week runs in most of the region. */
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const TIMES = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export const EMPTY_SETTINGS: ConsultantSettingsDto = {
  enabled: false,
  price30Egp: null,
  price60Egp: null,
  meetingUrl: '',
  timezone: DEFAULT_TIMEZONE,
  minNoticeHours: 24,
  horizonDays: 30,
  availability: [],
};

const priceText = (n: number | null) => (n === null ? '' : String(n));
const priceValue = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/**
 * An expert's consultation settings: prices, meeting link, time zone, notice, how far ahead,
 * and weekly hours. The speaker portal sends them without `enabled`; Admin → Consultations with it.
 */
export function ConsultantSettingsForm({
  initial,
  withEnabled,
  onSave,
}: {
  initial: ConsultantSettingsDto;
  withEnabled: boolean;
  onSave: (body: Omit<ConsultantSettingsDto, 'enabled'> & { enabled?: boolean }) => Promise<ConsultantSettingsDto>;
}) {
  const { t } = useI18n();
  const [s, setS] = useState(initial);
  const [p30, setP30] = useState(priceText(initial.price30Egp));
  const [p60, setP60] = useState(priceText(initial.price60Egp));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ConsultantSettingsDto>(k: K, v: ConsultantSettingsDto[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  };

  const windows = (day: number) => s.availability.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === day);
  const setWindow = (i: number, patch: Partial<AvailabilityWindow>) =>
    set(
      'availability',
      s.availability.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    );
  const addWindow = (weekday: number) => {
    const last = windows(weekday).at(-1)?.w;
    const start = last ? last.end : '18:00';
    const end = TIMES[Math.min(TIMES.indexOf(start) + 4, TIMES.length - 1)]!;
    if (minutesOf(start) >= minutesOf(end)) return;
    set('availability', [...s.availability, { weekday, start, end }]);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const { enabled, ...rest } = s;
    const body = { ...rest, price30Egp: priceValue(p30), price60Egp: priceValue(p60), ...(withEnabled ? { enabled } : {}) };
    try {
      const next = await onSave(body);
      setS(next);
      setP30(priceText(next.price30Egp));
      setP60(priceText(next.price60Egp));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, t));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  }

  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {withEnabled && (
        <CheckboxField label={t('consultations.settings.enabled')} hint={t('consultations.settings.enabledHint')} checked={s.enabled} onChange={(v) => set('enabled', v)} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('consultations.settings.price30')}
          hint={t('consultations.settings.priceHint')}
          inputMode="numeric"
          value={p30}
          onChange={(v) => {
            setP30(v.replace(/\D/g, ''));
            setSaved(false);
          }}
          error={fieldErrors.price30Egp}
        />
        <TextField
          label={t('consultations.settings.price60')}
          hint={t('consultations.settings.priceHint')}
          inputMode="numeric"
          value={p60}
          onChange={(v) => {
            setP60(v.replace(/\D/g, ''));
            setSaved(false);
          }}
          error={fieldErrors.price60Egp}
        />
      </div>
      <TextField
        label={t('consultations.settings.link')}
        hint={t('consultations.settings.linkHint')}
        type="url"
        value={s.meetingUrl}
        onChange={(v) => set('meetingUrl', v.trim())}
        error={fieldErrors.meetingUrl}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label={t('consultations.settings.timezone')} value={s.timezone} onChange={(v) => v && set('timezone', v)} options={zones.map((z) => ({ value: z, label: z.replace('_', ' ') }))} />
        <TextField
          label={t('consultations.settings.notice')}
          hint={t('consultations.settings.noticeHint')}
          inputMode="numeric"
          value={String(s.minNoticeHours)}
          onChange={(v) => set('minNoticeHours', Number(v.replace(/\D/g, '') || 0))}
          error={fieldErrors.minNoticeHours}
        />
        <TextField
          label={t('consultations.settings.horizon')}
          inputMode="numeric"
          value={String(s.horizonDays)}
          onChange={(v) => set('horizonDays', Number(v.replace(/\D/g, '') || 0))}
          error={fieldErrors.horizonDays}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium text-fg">{t('consultations.settings.hours')}</legend>
        <p className="text-[0.875rem] text-muted">{t('consultations.settings.hoursHint', { tz: s.timezone })}</p>
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {WEEK.map((day) => (
            <li key={day} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <span className="w-28 shrink-0 pt-2.5 text-[0.9375rem] font-medium text-fg">{t(`consultations.settings.day${day}`)}</span>
              <div className="flex flex-1 flex-col gap-2">
                {windows(day).length === 0 && <span className="pt-2.5 text-[0.9375rem] text-muted">{t('consultations.settings.off')}</span>}
                {windows(day).map(({ w, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t('consultations.settings.from')}
                      value={w.start}
                      onChange={(e) => setWindow(i, { start: e.target.value })}
                      className="min-h-11 rounded-lg border border-line-strong bg-card px-2 text-[0.9375rem] tabular-nums"
                    >
                      {TIMES.slice(0, -1).map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <span aria-hidden>–</span>
                    <select
                      aria-label={t('consultations.settings.to')}
                      value={w.end}
                      onChange={(e) => setWindow(i, { end: e.target.value })}
                      className="min-h-11 rounded-lg border border-line-strong bg-card px-2 text-[0.9375rem] tabular-nums"
                    >
                      {TIMES.slice(1).map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        set(
                          'availability',
                          s.availability.filter((_, j) => j !== i),
                        )
                      }
                    >
                      {t('consultations.settings.remove')}
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => addWindow(day)}>
                  {t('consultations.settings.addHours')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {fieldErrors.availability && <p className="text-[0.875rem] text-danger">{fieldErrors.availability}</p>}
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">{t('consultations.settings.saved')}</Alert>}
      <Button type="submit" loading={busy} className="self-start">
        {t('consultations.settings.save')}
      </Button>
    </form>
  );
}
