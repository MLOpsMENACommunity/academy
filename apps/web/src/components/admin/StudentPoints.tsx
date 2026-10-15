'use client';

import { MANUAL_POINTS_REASONS, manualPointsSchema, type AdminStudentPointsDto, type BadgeDto, type ManualPointsReason } from '@academy/shared';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SelectField, TextField } from '@/components/forms/fields';
import { BadgeIcon, badgeName } from '@/components/points/BadgeIcon';
import { entryText, signed } from '@/components/points/entry';
import { PointsLedger } from '@/components/points/PointsLedger';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const emptyPoints = { points: '', reason: 'MANUAL_COMMUNITY' as ManualPointsReason, courseId: '', note: '' };

/**
 * Admin → Student: points, badges, and the forms to award or adjust them (all audited).
 * `heading`: name the student above the card (Admin → Points & badges → student, where the
 * academic preset lands from a course leaderboard; the admissions student page names them itself).
 */
export function StudentPoints({ studentId, heading = false }: { studentId: string; heading?: boolean }) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.points.${k}`, v);
  const [data, setData] = useState<AdminStudentPointsDto | null>(null);
  const [badges, setBadges] = useState<BadgeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPoints);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [award, setAward] = useState({ badgeId: '', courseId: '', reason: '' });
  const [awardError, setAwardError] = useState<string | null>(null);
  // From a course leaderboard: that course's entries first.
  const [courseFilter, setCourseFilter] = useState(useSearchParams().get('course') ?? '');
  const formRef = useRef<HTMLFormElement>(null);
  const focusForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    formRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  const load = useCallback(() => {
    api<AdminStudentPointsDto>(`/admin/students/${studentId}/points`)
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e, t)));
  }, [studentId, t]);
  useEffect(load, [load]);
  useEffect(() => {
    api<BadgeDto[]>('/admin/badges')
      .then(setBadges)
      .catch(() => setBadges([]));
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return null;
  const courseOptions = data.enrolledCourses.map((c) => ({ value: c.id, label: locale === 'ar' ? c.titleAr : c.titleEn }));
  const manualBadges = badges.filter((b) => b.kind === 'MANUAL' && b.active);
  const week = (n: number) => t('leaderboard.weekN', { n });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const parsed = manualPointsSchema.safeParse({ ...form, courseId: form.courseId || null });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(`/admin/students/${studentId}/points`, { method: 'POST', json: parsed.data });
      setForm(emptyPoints);
      setDone(a('awarded', { points: signed(parsed.data.points, locale) }));
      load();
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      else setErrors({ form: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function giveBadge(e: FormEvent) {
    e.preventDefault();
    setAwardError(null);
    if (!award.badgeId) {
      setAwardError(a('pickBadge'));
      return;
    }
    try {
      await api(`/admin/students/${studentId}/badges`, { method: 'POST', json: { badgeId: award.badgeId, courseId: award.courseId || null, reason: award.reason || null } });
      setAward({ badgeId: '', courseId: '', reason: '' });
      load();
    } catch (err) {
      setAwardError(errorMessage(err, t));
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(a('revokeConfirm', { name }))) return;
    try {
      await api(`/admin/badge-awards/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setAwardError(errorMessage(err, t));
    }
  }

  const card = (
    <Card id="points">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg">{a('title')}</h2>
        <p className="text-2xl font-semibold">{t('points.total', { count: data.total })}</p>
      </div>
      {data.courses.length > 0 && (
        <ul className="mt-2 text-sm text-muted">
          {data.courses.map((c) => (
            <li key={c.id}>
              {locale === 'ar' ? c.titleAr : c.titleEn}: <span className="font-medium text-fg">{c.points}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-base">{t('badges.title')}</h3>
      {data.badges.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t('admin.common.none')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {data.badges.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <BadgeIcon size="sm" icon={b.badge.icon} name={badgeName(b.badge, locale)} />
              <span className="min-w-0 flex-1">
                {badgeName(b.badge, locale, b.period, week)}
                <span className="block text-xs text-muted">
                  {[b.course ? (locale === 'ar' ? b.course.titleAr : b.course.titleEn) : null, formatDate(b.awardedAt, locale), b.awardedBy ?? a('automatic')].filter(Boolean).join(' · ')}
                </span>
              </span>
              {b.badge.kind === 'MANUAL' && (
                <Button variant="ghost" size="sm" onClick={() => void revoke(b.id, badgeName(b.badge, locale))}>
                  {a('revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={giveBadge} className="mt-3 flex flex-col gap-3 rounded-xl bg-muted-bg p-4" noValidate>
        <h4 className="text-sm font-semibold">{a('awardBadge')}</h4>
        {awardError && <Alert tone="danger">{awardError}</Alert>}
        <SelectField
          label={a('badge')}
          required
          value={award.badgeId}
          onChange={(v) => setAward({ ...award, badgeId: v ?? '' })}
          options={manualBadges.map((b) => ({ value: b.id, label: `${b.icon} ${badgeName(b, locale)}` }))}
        />
        <SelectField label={a('course')} value={award.courseId} onChange={(v) => setAward({ ...award, courseId: v ?? '' })} options={courseOptions} placeholder={a('noCourse')} />
        <TextField label={a('reason')} value={award.reason} maxLength={300} onChange={(v) => setAward({ ...award, reason: v })} />
        <Button type="submit" variant="secondary" size="sm" className="self-start">
          {a('awardBadgeButton')}
        </Button>
      </form>

      <form ref={formRef} onSubmit={submit} className="mt-5 flex flex-col gap-3 rounded-xl bg-muted-bg p-4" noValidate aria-labelledby="award-points">
        <h4 id="award-points" className="text-sm font-semibold">
          {a('awardPoints')}
        </h4>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        {done && (
          <p role="status" className="text-sm text-success">
            {done}
          </p>
        )}
        <TextField label={a('points')} hint={a('pointsHint')} inputMode="numeric" required value={form.points} error={errors.points} onChange={(v) => setForm({ ...form, points: v })} />
        <SelectField
          label={a('reasonType')}
          required
          value={form.reason}
          error={errors.reason}
          onChange={(v) => setForm({ ...form, reason: (v as ManualPointsReason) ?? 'MANUAL_COMMUNITY' })}
          options={MANUAL_POINTS_REASONS.map((r) => ({ value: r, label: t(`points.reasons.${r}`) }))}
        />
        <SelectField label={a('course')} value={form.courseId} error={errors.courseId} onChange={(v) => setForm({ ...form, courseId: v ?? '' })} options={courseOptions} placeholder={a('noCourse')} />
        <TextField label={a('note')} hint={a('noteHint')} required maxLength={500} value={form.note} error={errors.note} onChange={(v) => setForm({ ...form, note: v })} />
        <Button type="submit" size="sm" className="self-start" loading={busy}>
          {a('save')}
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <h3 className="text-base">{a('history')}</h3>
        <Button type="button" size="sm" variant="secondary" className="ms-auto" onClick={focusForm}>
          + {t('pointsLedger.add')}
        </Button>
      </div>
      {courseOptions.length > 0 && (
        <div className="mt-2 max-w-sm">
          <SelectField label={t('pointsLedger.filter')} value={courseFilter} onChange={(v) => setCourseFilter(v ?? '')} options={courseOptions} placeholder={t('pointsLedger.allCourses')} />
        </div>
      )}
      <div className="mt-2">
        <PointsLedger
          entries={courseFilter ? data.entries.filter((e) => data.enrolledCourses.find((c) => c.id === courseFilter)?.slug === e.course?.slug) : data.entries}
          cap={data.cap}
          url={(id) => `/admin/points/${id}`}
          onChanged={load}
          onOverride={(e) => {
            const course = data.enrolledCourses.find((c) => c.slug === e.course?.slug);
            setForm({ points: '', reason: 'ADJUSTMENT', courseId: course?.id ?? '', note: t('pointsLedger.overrideNote', { text: entryText(e, locale, t) }).slice(0, 500) });
            setDone(null);
            focusForm();
          }}
        />
      </div>
    </Card>
  );
  if (!heading) return card;
  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-2xl break-words">
          <bdi>{data.student.name ?? data.student.email}</bdi>
        </h1>
        <p className="text-sm break-all text-muted">
          <span className="ltr-embed">{data.student.email}</span>
        </p>
      </div>
      {card}
    </div>
  );
}
