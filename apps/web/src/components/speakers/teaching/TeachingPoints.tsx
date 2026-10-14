'use client';

import { MANUAL_POINTS_REASONS, teachingPointsSchema, type CourseStudentPointsDto, type ManualPointsReason, type TeachingPointsDto } from '@academy/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SelectField, TextField } from '@/components/forms/fields';
import { entryText, signed } from '@/components/points/entry';
import { PointsLedger } from '@/components/points/PointsLedger';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const EMPTY = { userId: '', points: '', reason: 'MANUAL_OTHER' as ManualPointsReason, note: '' };

/** My courses → {course} → Points: add or take away course points (with a reason) for an enrolled student. */
export function TeachingPoints({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const p = (k: string, v?: Record<string, string | number>) => t(`speakerTeaching.points.${k}`, v);
  const [data, setData] = useState<TeachingPointsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [student, setStudent] = useState<CourseStudentPointsDto | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(() => {
    api<TeachingPointsDto>(`/speaker/courses/${courseId}/points`)
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [courseId, t]);
  useEffect(load, [load]);
  const loadStudent = useCallback(() => {
    if (!selected) return setStudent(null);
    api<CourseStudentPointsDto>(`/speaker/courses/${courseId}/students/${selected}/points`)
      .then(setStudent)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [courseId, selected, t]);
  useEffect(loadStudent, [loadStudent]);
  const refreshAll = () => {
    load();
    loadStudent();
  };
  const focusForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    formRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    setError(null);
    const parsed = teachingPointsSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(`/speaker/courses/${courseId}/points`, { method: 'POST', json: parsed.data });
      const who = data?.students.find((s) => s.userId === parsed.data.userId);
      setDone(p('saved', { points: signed(parsed.data.points, locale), name: who?.name || who?.email || '' }));
      setForm({ ...EMPTY, reason: form.reason });
      refreshAll();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card>
        <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="teach-points-h" className="flex flex-col gap-3">
          <h2 id="teach-points-h" className="text-lg">
            {p('title')}
          </h2>
          <p className="text-sm text-muted">{p('intro')}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          {done && (
            <p role="status" className="text-sm font-medium text-success">
              {done}
            </p>
          )}
          {data.students.length === 0 ? (
            <p className="text-sm text-muted">{p('noStudents')}</p>
          ) : (
            <>
              <SelectField
                label={p('student')}
                required
                value={form.userId}
                error={errors.userId}
                onChange={(v) => setForm({ ...form, userId: v ?? '' })}
                placeholder={p('pickStudent')}
                options={data.students.map((s) => ({ value: s.userId, label: s.name ? `${s.name} (${s.email})` : s.email }))}
              />
              <TextField label={t('admin.points.points')} hint={`${t('admin.points.pointsHint')} ${p('cap', { cap: data.cap })}`} inputMode="numeric" required dir="ltr" value={form.points} error={errors.points} onChange={(v) => setForm({ ...form, points: v })} />
              <SelectField
                label={t('admin.points.reasonType')}
                required
                value={form.reason}
                error={errors.reason}
                onChange={(v) => setForm({ ...form, reason: (v as ManualPointsReason) ?? 'MANUAL_OTHER' })}
                options={MANUAL_POINTS_REASONS.map((r) => ({ value: r, label: t(`points.reasons.${r}`) }))}
              />
              <TextField label={t('admin.points.note')} hint={t('admin.points.noteHint')} required maxLength={500} value={form.note} error={errors.note} onChange={(v) => setForm({ ...form, note: v })} />
              <Button type="submit" className="self-start" loading={busy}>
                {t('admin.points.save')}
              </Button>
            </>
          )}
        </form>
      </Card>

      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <h2 className="text-lg">{p('standings')}</h2>
          {data.students.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{p('noStudents')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {[...data.students]
                .sort((a, b) => b.points - a.points)
                .map((s) => (
                  <li key={s.userId}>
                    <button
                      type="button"
                      aria-expanded={selected === s.userId}
                      onClick={() => setSelected(selected === s.userId ? null : s.userId)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-start hover:bg-hover-bg ${selected === s.userId ? 'bg-primary-soft' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{s.name ?? '—'}</span>
                        <span className="block truncate text-xs text-muted" dir="ltr">
                          {s.email}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{t('points.total', { count: s.points })}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        {selected && student && student.student.userId === selected && (
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-lg break-words">{p('studentTitle', { name: student.student.name ?? student.student.email })}</h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="ms-auto"
                onClick={() => {
                  setForm({ ...EMPTY, userId: student.student.userId });
                  focusForm();
                }}
              >
                + {t('pointsLedger.add')}
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted">{p('studentHint', { total: student.total, cap: student.cap })}</p>
            <div className="mt-2">
              <PointsLedger
                entries={student.entries}
                cap={student.cap}
                showCourse={false}
                url={(id) => `/speaker/courses/${courseId}/points/${id}`}
                onChanged={refreshAll}
                onOverride={(e) => {
                  setForm({ userId: student.student.userId, points: '', reason: 'ADJUSTMENT', note: t('pointsLedger.overrideNote', { text: entryText(e, locale, t) }).slice(0, 500) });
                  setDone(null);
                  focusForm();
                }}
              />
            </div>
          </Card>
        )}
        <Card>
          <h2 className="text-lg">{p('history')}</h2>
          {data.entries.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{p('noHistory')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block break-words text-fg">
                      {e.student}
                      {e.note && <span className="text-muted"> · {e.note}</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      {[formatDate(e.createdAt, locale), t(`points.reasons.${e.reason}`), e.awardedBy && p('by', { name: e.awardedBy })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${e.points < 0 ? 'text-danger' : 'text-success'}`} dir="ltr">
                    {signed(e.points, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
