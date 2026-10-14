'use client';

import { MANUAL_POINTS_REASONS, pointsEditSchema, pointsVoidSchema, type LedgerEntryDto, type ManualPointsReason } from '@academy/shared';
import { useState, type FormEvent } from 'react';
import { SelectField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { entryText, signed } from './entry';

type Mode = { kind: 'edit'; id: string } | { kind: 'remove'; id: string } | null;

/**
 * A student's points entries as a table, for admins and teaching speakers: edit or remove a
 * manual entry (with a reason; the old one stays, struck through), or "override" an automatic
 * one, which adds a correction instead. `cap` is the largest entry this user may change.
 */
export function PointsLedger({
  entries,
  cap,
  url,
  showCourse = true,
  onChanged,
  onOverride,
}: {
  entries: LedgerEntryDto[];
  cap: number;
  /** The API path of an entry: /admin/points/{id} or /speaker/courses/{course}/points/{id}. */
  url: (id: string) => string;
  showCourse?: boolean;
  onChanged: () => void;
  onOverride: (e: LedgerEntryDto) => void;
}) {
  const { locale, t } = useI18n();
  const p = (k: string, v?: Record<string, string | number>) => t(`pointsLedger.${k}`, v);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ points: '', reason: 'MANUAL_OTHER' as ManualPointsReason, note: '', why: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function open(next: Mode, e?: LedgerEntryDto) {
    setErrors({});
    setMode(next);
    if (e) setForm({ points: String(e.points), reason: (MANUAL_POINTS_REASONS as readonly string[]).includes(e.reason) ? (e.reason as ManualPointsReason) : 'MANUAL_OTHER', note: e.note ?? '', why: '' });
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!mode) return;
    const parsed = mode.kind === 'edit' ? pointsEditSchema.safeParse(form) : pointsVoidSchema.safeParse({ why: form.why });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    if (mode.kind === 'edit' && Math.abs(Number(form.points)) > cap) {
      setErrors({ points: p('overCap', { cap }) });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (mode.kind === 'edit') await api(url(mode.id), { method: 'PATCH', json: parsed.data });
      else await api(`${url(mode.id)}/void`, { method: 'POST', json: parsed.data });
      setMode(null);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      else setErrors({ form: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  if (!entries.length) return <p className="mt-1 text-sm text-muted">{t('admin.common.none')}</p>;

  return (
    <ul className="flex flex-col divide-y divide-line-soft text-sm" aria-label={p('title')}>
      {entries.map((e) => {
        const voided = Boolean(e.voided);
        const course = e.course ? (locale === 'ar' ? e.course.titleAr : e.course.titleEn) : t('points.noCourse');
        const canChange = !voided && !e.automatic && Math.abs(e.points) <= cap;
        const editing = mode?.id === e.id;
        return (
          <li key={e.id} className="flex flex-col gap-2 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className={`block break-words ${voided ? 'text-muted line-through' : 'text-fg'}`}>{entryText(e, locale, t)}</span>
                <span className="block text-xs text-muted">
                  {[formatDate(e.createdAt, locale), t(`points.reasons.${e.reason}`), showCourse ? course : null, e.awardedBy ? p('by', { name: e.awardedBy }) : e.automatic ? p('automatic') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {e.replaces && <Badge tone="info">{p('edited')}</Badge>}
                  {voided && <Badge>{p('removed')}</Badge>}
                </span>
                {e.voided && (
                  <span className="mt-1 block text-xs text-muted">
                    {p('removedBy', { name: e.voided.by ?? '—', date: formatDate(e.voided.at, locale) })}
                    {e.voided.why && <>: <bdi>{e.voided.why}</bdi></>}
                  </span>
                )}
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${voided ? 'text-muted line-through' : e.points < 0 ? 'text-danger' : 'text-success'}`} dir="ltr">
                {signed(e.points, locale)}
              </span>
            </div>
            {!voided && !editing && (
              <div className="flex flex-wrap gap-1">
                {canChange && (
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => open({ kind: 'edit', id: e.id }, e)} aria-label={p('editLabel', { text: entryText(e, locale, t) })}>
                      {p('edit')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => open({ kind: 'remove', id: e.id }, e)} aria-label={p('removeLabel', { text: entryText(e, locale, t) })}>
                      {p('remove')}
                    </Button>
                  </>
                )}
                {e.automatic && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOverride(e)}>
                    {p('override')}
                  </Button>
                )}
                {!e.automatic && !canChange && <span className="text-xs text-muted">{p('overCapNote', { cap })}</span>}
              </div>
            )}
            {editing && mode && (
              <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-xl bg-muted-bg p-3">
                {errors.form && <Alert tone="danger">{errors.form}</Alert>}
                {mode.kind === 'edit' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField label={t('admin.points.points')} hint={p('capHint', { cap })} inputMode="numeric" dir="ltr" required value={form.points} error={errors.points} onChange={(v) => setForm({ ...form, points: v })} />
                    <SelectField
                      label={t('admin.points.reasonType')}
                      required
                      value={form.reason}
                      error={errors.reason}
                      onChange={(v) => setForm({ ...form, reason: (v as ManualPointsReason) ?? 'MANUAL_OTHER' })}
                      options={MANUAL_POINTS_REASONS.map((r) => ({ value: r, label: t(`points.reasons.${r}`) }))}
                    />
                    <TextField className="sm:col-span-2" label={t('admin.points.note')} required maxLength={500} value={form.note} error={errors.note} onChange={(v) => setForm({ ...form, note: v })} />
                  </div>
                )}
                {mode.kind === 'remove' && <p className="text-sm">{p('removeIntro')}</p>}
                <TextField label={p('why')} hint={p('whyHint')} required maxLength={300} value={form.why} error={errors.why} onChange={(v) => setForm({ ...form, why: v })} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant={mode.kind === 'remove' ? 'danger' : 'primary'} loading={busy}>
                    {mode.kind === 'edit' ? p('saveEdit') : p('confirmRemove')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
                    {t('admin.common.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
