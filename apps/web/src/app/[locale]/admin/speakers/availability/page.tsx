'use client';

import {
  DEFAULT_TIMEZONE,
  eventStatusLabels,
  generateSlotTimes,
  slotGeneratorSchema,
  zonedTimeToUtc,
  type AdminSlotDto,
} from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { SpeakersTabs } from '@/components/admin/SpeakersTabs';
import { ChipGroup, TextField } from '@/components/forms/fields';
import { byMonth, monthLabel, speakerError, upcomingMonths } from '@/components/speakers/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { intlLocale } from '@/i18n/config';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const STATUS_TONE = { OPEN: 'success', BOOKED: 'info', CANCELLED: 'neutral' } as const;

export default function AdminAvailability() {
  const { locale, t } = useI18n();
  const [slots, setSlots] = useState<AdminSlotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminSlotDto[]>('/admin/speaking-slots')
      .then(setSlots)
      .catch((err) => setError(speakerError(err, t)));
  }, [t]);
  useEffect(load, [load]);

  async function act(slot: AdminSlotDto, action: 'withdraw' | 'delete' | 'release') {
    if (action === 'delete' && !window.confirm(t('admin.slots.deleteConfirm'))) return;
    if (action === 'release' && !window.confirm(t('admin.slots.releaseConfirm'))) return;
    setError(null);
    try {
      const path = { delete: `/admin/speaking-slots/${slot.id}`, withdraw: `/admin/speaking-slots/${slot.id}/cancel`, release: `/admin/speaking-slots/${slot.id}/release` }[action];
      await api(path, { method: action === 'delete' ? 'DELETE' : 'POST' });
      load();
    } catch (err) {
      setError(speakerError(err, t));
    }
  }

  const upcoming = (slots ?? []).filter((s) => new Date(s.startsAt).getTime() > Date.now() - 86_400_000);

  return (
    <div className="space-y-5">
      <SpeakersTabs />
      <div>
        <h1 className="text-3xl">{t('admin.slots.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.slots.intro')}</p>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <Generator
          onDone={(r) => {
            setNotice(t('admin.slots.generated', { created: r.created, skipped: r.skipped }));
            load();
          }}
        />
        <SingleSlot
          onDone={() => {
            setNotice(t('admin.slots.added'));
            load();
          }}
        />
      </div>

      <section aria-labelledby="slot-list" className="space-y-3">
        <h2 id="slot-list" className="text-2xl">
          {t('admin.slots.list')}
        </h2>
        {!slots && <p className="text-muted">{t('admin.common.loading')}</p>}
        {slots && upcoming.length === 0 && <p className="rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.slots.none')}</p>}
        {byMonth(upcoming).map(([month, list]) => (
          <Card key={month} className="!p-0">
            <h3 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3 text-lg">
              {monthLabel(month, locale)}
              <span className="text-sm font-normal text-muted">
                {t('admin.slots.counts', { open: list.filter((s) => s.status === 'OPEN').length, booked: list.filter((s) => s.status === 'BOOKED').length })}
              </span>
            </h3>
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {formatDateTime(s.startsAt, locale, DEFAULT_TIMEZONE)} · {t('speakers.portal.slots.minutes', { n: s.durationMin })}
                    </p>
                    {s.bookedBy && (
                      <p className="mt-0.5 text-sm break-words text-muted">
                        {s.bookedBy.name} · <span className="ltr-embed">{s.bookedBy.email}</span>
                        {s.title ? ` · ${s.title}` : ''}
                      </p>
                    )}
                    {s.event && (
                      <Link href={`/${locale}/admin/sessions/${s.event.id}`} className="text-sm text-primary underline">
                        {t('admin.slots.openSession')} ({eventStatusLabels[s.event.status][locale]})
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[s.status]}>{t(`admin.slots.status.${s.status}`)}</Badge>
                    {s.status === 'OPEN' && (
                      <Button variant="ghost" size="sm" onClick={() => act(s, 'withdraw')}>
                        {t('admin.slots.withdraw')}
                      </Button>
                    )}
                    {s.status === 'BOOKED' && (
                      <Button variant="ghost" size="sm" onClick={() => act(s, 'release')}>
                        {t('admin.slots.release')}
                      </Button>
                    )}
                    {s.status !== 'BOOKED' && (
                      <Button variant="ghost" size="sm" onClick={() => act(s, 'delete')}>
                        {t('admin.common.delete')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </div>
  );
}

/** "Saturdays at 19:00 Cairo, 60 minutes, in November and December". */
function Generator({ onDone }: { onDone: (r: { created: number; skipped: number }) => void }) {
  const { locale, t } = useI18n();
  const [weekdays, setWeekdays] = useState<string[]>(['6']);
  const [time, setTime] = useState('19:00');
  const [duration, setDuration] = useState('60');
  const [months, setMonths] = useState<string[]>(() => upcomingMonths(2).slice(1));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' });
    // 4 Jan 2026 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: fmt.format(new Date(Date.UTC(2026, 0, 4 + i))) }));
  }, [locale]);
  const monthOptions = useMemo(() => upcomingMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) })), [locale]);
  const parsed = slotGeneratorSchema.safeParse({ weekdays, time, durationMin: duration, months });
  const preview = parsed.success ? generateSlotTimes(parsed.data) : [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onDone(await api<{ created: number; skipped: number }>('/admin/speaking-slots/generate', { method: 'POST', json: parsed.data }));
    } catch (err) {
      setError(speakerError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <h2 className="text-lg">{t('admin.slots.generator')}</h2>
        {error && <Alert tone="danger">{error}</Alert>}
        <ChipGroup legend={t('admin.slots.weekdays')} required options={dayNames} value={weekdays} onChange={setWeekdays} error={errors.weekdays} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('admin.slots.timeCairo')} required type="time" dir="ltr" value={time} onChange={setTime} error={errors.time} />
          <TextField label={t('admin.slots.duration')} required type="number" min={30} max={240} step={15} dir="ltr" value={duration} onChange={setDuration} error={errors.durationMin} />
        </div>
        <ChipGroup legend={t('admin.slots.months')} required options={monthOptions} value={months} onChange={setMonths} error={errors.months} />
        <p className="text-sm text-muted" aria-live="polite">
          {preview.length
            ? t('admin.slots.preview', { n: preview.length, first: formatDateTime(preview[0]!, locale, DEFAULT_TIMEZONE), last: formatDateTime(preview[preview.length - 1]!, locale, DEFAULT_TIMEZONE) })
            : t('admin.slots.previewNone')}
        </p>
        <Button type="submit" loading={busy} disabled={!preview.length}>
          {t('admin.slots.create', { n: preview.length })}
        </Button>
      </form>
    </Card>
  );
}

function SingleSlot({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [duration, setDuration] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const tm = /^(\d{2}):(\d{2})$/.exec(time);
    if (!d || !tm) {
      setError(t('admin.slots.pickDate'));
      return;
    }
    const startsAt = zonedTimeToUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(tm[1]), Number(tm[2]));
    setBusy(true);
    try {
      await api('/admin/speaking-slots', { method: 'POST', json: { startsAt: startsAt.toISOString(), durationMin: Number(duration) } });
      setDate('');
      onDone();
    } catch (err) {
      setError(speakerError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <h2 className="text-lg">{t('admin.slots.single')}</h2>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label={t('admin.slots.date')} required type="date" dir="ltr" value={date} onChange={setDate} />
        <TextField label={t('admin.slots.timeCairo')} required type="time" dir="ltr" value={time} onChange={setTime} />
        <TextField label={t('admin.slots.duration')} required type="number" min={30} max={240} step={15} dir="ltr" value={duration} onChange={setDuration} />
        <Button type="submit" variant="secondary" loading={busy}>
          {t('admin.slots.add')}
        </Button>
      </form>
    </Card>
  );
}
