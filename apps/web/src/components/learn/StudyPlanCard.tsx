'use client';

import { localIsoDate, STUDY_PLAN_MINUTE_OPTIONS, studyPlanSchema, type StudyPlanDto, type StudyPlanInput, type StudyPlanItemDto } from '@academy/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChipGroup, SelectField, TextField } from '@/components/forms/fields';
import { CalendarMenu } from '@/components/learn/CalendarMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { intlLocale } from '@/i18n/config';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DEFAULT_PLAN = { weekdays: [0, 2, 4], minutesPerDay: 45, reminderHour: 20 as number | null };

/** "Tue 18 Nov" for a 'YYYY-MM-DD' date (a calendar date: no time zone shift). */
function formatDay(date: string, locale: 'en' | 'ar'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "20:00" / "8:00 PM" for an hour of the day. */
function formatHour(hour: number, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

/**
 * The learn page's study plan (self-paced courses, enrolled students): a short pitch and a form
 * when there is none; otherwise the next study day and what to do then, the target finish date,
 * on track or behind, the calendar link, and Edit / Delete. Hidden if the API says no (an admin
 * previewing, a course that isn't self-paced).
 */
export function StudyPlanCard({ slug, version }: { slug: string; /** Bumped by the page when progress changes, to refresh the summary. */ version: number }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<StudyPlanDto | null>(null);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<StudyPlanInput | null>(null);
  const section = useRef<HTMLElement>(null);
  const scrolled = useRef(false);

  const load = useCallback(() => {
    api<StudyPlanDto>(`/learn/${slug}/study-plan`)
      .then(setData)
      .catch(() => setHidden(true));
  }, [slug]);
  useEffect(load, [load, version]);

  // #study-plan (the reminder email and notification): scroll here once the card has loaded.
  useEffect(() => {
    if (!data || scrolled.current || window.location.hash !== '#study-plan') return;
    scrolled.current = true;
    requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'start' }));
  }, [data]);

  if (hidden || !data) return null;
  const today = localIsoDate(new Date(), data.timezone);

  const openForm = () => {
    setForm(data.plan ? { weekdays: data.plan.weekdays, minutesPerDay: data.plan.minutesPerDay, startDate: data.plan.startDate, reminderHour: data.plan.reminderHour } : { ...DEFAULT_PLAN, startDate: today });
    setError(null);
    setStatus('');
    setEditing(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const parsed = studyPlanSchema.safeParse(form);
    if (!parsed.success) {
      setError(form.weekdays.length ? t('learn.studyPlan.errorDate') : t('learn.studyPlan.errorDays'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setData(await api<StudyPlanDto>(`/learn/${slug}/study-plan`, { method: 'PUT', json: parsed.data }));
      setEditing(false);
      setStatus(t('learn.studyPlan.saved'));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/learn/${slug}/study-plan`, { method: 'DELETE' });
      setData({ ...data, plan: null, summary: null });
      setEditing(false);
      setStatus(t('learn.studyPlan.deleted'));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const itemLabel = (i: StudyPlanItemDto) => {
    const title = locale === 'ar' ? i.titleAr || i.titleEn : i.titleEn;
    const name = i.kind === 'quiz' ? t('learn.studyPlan.quiz', { title }) : title;
    return i.parts > 1 ? t('learn.studyPlan.part', { title: name, part: i.part, parts: i.parts }) : name;
  };
  const dayNames = (days: number[]) => days.map((d) => t(`learn.studyPlan.days.${d}`)).join(locale === 'ar' ? '، ' : ', ');
  const zone = data.timezone;
  const { plan, summary } = data;

  return (
    <section ref={section} id="study-plan" aria-labelledby="study-plan-title" className="flex scroll-mt-6 flex-col gap-3 rounded-xl border border-line bg-card p-4">
      <h2 id="study-plan-title" className="text-base">
        {t('learn.studyPlan.title')}
      </h2>

      {editing && form ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <ChipGroup
            legend={t('learn.studyPlan.weekdays')}
            hint={t('learn.studyPlan.weekdaysHint')}
            required
            options={WEEKDAYS.map((d) => ({ value: String(d), label: t(`learn.studyPlan.days.${d}`) }))}
            value={form.weekdays.map(String)}
            onChange={(v) => setForm({ ...form, weekdays: v.map(Number).sort((a, b) => a - b) })}
          />
          <SelectField
            label={t('learn.studyPlan.minutes')}
            required
            value={String(form.minutesPerDay)}
            onChange={(v) => v && setForm({ ...form, minutesPerDay: Number(v) })}
            options={STUDY_PLAN_MINUTE_OPTIONS.map((m) => ({ value: String(m), label: t('course.minutes', { count: m }) }))}
          />
          <TextField label={t('learn.studyPlan.startDate')} type="date" required value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
          <SelectField
            label={t('learn.studyPlan.reminder')}
            hint={t('learn.studyPlan.reminderHint', { zone })}
            value={form.reminderHour === null ? '' : String(form.reminderHour)}
            onChange={(v) => setForm({ ...form, reminderHour: v === null ? null : Number(v) })}
            placeholder={t('learn.studyPlan.noReminder')}
            options={HOURS.map((h) => ({ value: String(h), label: formatHour(h, locale) }))}
          />
          {data.timezoneIsDefault && <p className="text-xs text-muted">{t('learn.studyPlan.zoneDefault', { zone })}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={busy}>
              {t('learn.studyPlan.save')}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              {t('learn.studyPlan.cancel')}
            </Button>
          </div>
        </form>
      ) : plan && summary ? (
        <div className="flex flex-col gap-3 text-[0.9375rem]">
          {summary.nextDay ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={summary.onTrack ? 'success' : 'warning'}>{summary.onTrack ? t('learn.studyPlan.onTrack') : t('learn.studyPlan.behind', { count: summary.behindBy })}</Badge>
                {summary.targetDate && <span className="text-body">{t('learn.studyPlan.finishBy', { date: formatDay(summary.targetDate, locale) })}</span>}
              </div>
              <div>
                <p className="font-semibold text-fg">
                  {t('learn.studyPlan.nextDay', { date: summary.nextDay.date === today ? t('learn.studyPlan.today') : formatDay(summary.nextDay.date, locale) })}
                </p>
                <ul className="mt-1 list-disc ps-5 text-body">
                  {summary.nextDay.items.map((i) => (
                    <li key={`${i.id}-${i.part}`}>
                      {itemLabel(i)} <span className="text-muted">· {t('course.minutes', { count: i.minutes })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-body">{t('learn.studyPlan.allDone')}</p>
          )}
          <p className="text-[0.8125rem] text-muted">
            {t('learn.studyPlan.summary', { days: dayNames(plan.weekdays), minutes: t('course.minutes', { count: plan.minutesPerDay }) })}
            {' · '}
            {plan.reminderHour === null ? t('learn.studyPlan.noReminder') : t('learn.studyPlan.reminderAt', { time: `${formatHour(plan.reminderHour, locale)} (${zone})` })}
          </p>
          {summary.nextDay && (
            <div className="text-[0.8125rem] text-muted">
              {t('learn.studyPlan.calendarNote')} <CalendarMenu align="start" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={openForm}>
              {t('learn.studyPlan.edit')}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={remove}>
              {t('learn.studyPlan.delete')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[0.9375rem] text-body">{t('learn.studyPlan.pitch')}</p>
          <Button type="button" size="sm" onClick={openForm}>
            {t('learn.studyPlan.start')}
          </Button>
        </div>
      )}

      <p role="status" className="text-xs text-success">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
