'use client';

import { waitlistNotifySchema, type CourseStatus, type WaitlistDto } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';

const newKey = () => crypto.randomUUID();

/** The course admin's "Waiting list" tab: who's waiting, export, and "the course is open" email. */
export function Waitlist({ courseId, status, titleEn, titleAr }: { courseId: string; status: CourseStatus; titleEn: string; titleAr: string }) {
  const { locale, t } = useI18n();
  const w = (k: string, v?: Record<string, string | number>) => t(`admin.courses.wl.${k}`, v);
  const [data, setData] = useState<WaitlistDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newKey);
  /** '' = everyone; 'guests' = entries without an account (from before joining needed one). */
  const [show, setShow] = useState<'' | 'students' | 'guests'>('');
  const [msg, setMsg] = useState(() => ({
    subjectEn: 'Applications are open',
    subjectAr: 'التسجيل مفتوح الآن',
    bodyEn: `Good news: ${titleEn} is now open for applications.\n\nYou asked us to tell you when it opens. Seats are limited, so apply soon.`,
    bodyAr: `خبر سار: باب التقديم على ${titleAr || titleEn} مفتوح الآن.\n\nطلبت منا إبلاغك عند فتح التسجيل. المقاعد محدودة، فقدّم قريبًا.`,
  }));

  const load = useCallback(() => {
    api<WaitlistDto>(`/admin/courses/${courseId}/waitlist`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, t)));
  }, [courseId, t]);
  useEffect(load, [load]);

  // While emails are going out, refresh the counts.
  useEffect(() => {
    if (!data?.sending) return;
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [data?.sending, load]);

  const set = (k: keyof typeof msg) => (v: string) => {
    setMsg((p) => ({ ...p, [k]: v }));
    setKey(newKey());
  };

  async function notify() {
    setError(null);
    setDone(null);
    const parsed = waitlistNotifySchema.safeParse({ ...msg, idempotencyKey: key });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    if (!data?.waiting || !window.confirm(w('confirm', { count: data.waiting }))) return;
    setBusy(true);
    try {
      const r = await api<{ recipients: number }>(`/admin/courses/${courseId}/waitlist/notify`, { method: 'POST', json: parsed.data });
      setDone(w('sent', { count: r.recipients }));
      setKey(newKey());
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, email: string) {
    if (!window.confirm(w('removeConfirm', { email }))) return;
    setError(null);
    try {
      await api(`/admin/courses/${courseId}/waitlist/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  async function exportCsv() {
    setError(null);
    try {
      await downloadViaApi(`/admin/courses/${courseId}/waitlist/export.csv`, 'waiting-list.csv');
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  const guests = data.entries.filter((e) => !e.student).length;
  const entries = show ? data.entries.filter((e) => (show === 'guests' ? !e.student : e.student)) : data.entries;

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">{w('title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{w('help')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!data.count}>
            ⬇ {t('admin.common.export')}
          </Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ['total', data.count],
              ['waiting', data.waiting],
              ['notified', data.notified],
              ['sending', data.sending],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="rounded-xl bg-muted-bg p-3">
              <dt className="text-muted">{w(k)}</dt>
              <dd className="mt-1 text-2xl font-semibold text-fg">{n}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <h2 className="text-lg">{w('notifyTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{w('notifyHelp')}</p>
        {status !== 'OPEN' && <Alert tone="warning" className="mt-3">{w('notOpen')}</Alert>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField label={t('admin.courses.ann.subjectEn')} required value={msg.subjectEn} onChange={set('subjectEn')} error={errors.subjectEn} maxLength={150} />
          <TextField label={t('admin.courses.ann.subjectAr')} hint={t('admin.courses.ann.arHint')} dir="rtl" value={msg.subjectAr} onChange={set('subjectAr')} maxLength={150} />
          <TextAreaField label={t('admin.courses.ann.bodyEn')} required value={msg.bodyEn} onChange={set('bodyEn')} error={errors.bodyEn} rows={6} maxLength={5000} />
          <TextAreaField label={t('admin.courses.ann.bodyAr')} hint={t('admin.courses.ann.arHint')} dir="rtl" value={msg.bodyAr} onChange={set('bodyAr')} rows={6} maxLength={5000} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {w('recipients', { count: data.waiting })}
          </p>
          <Button type="button" className="ms-auto" loading={busy} disabled={!data.waiting || status !== 'OPEN'} onClick={notify}>
            {w('notify')}
          </Button>
        </div>
      </Card>

      {data.entries.length > 0 && (
        <div className="max-w-xs">
          <SelectField
            label={w('filter')}
            value={show}
            onChange={(v) => setShow(v === 'students' || v === 'guests' ? v : '')}
            placeholder={w('filterAll', { count: data.entries.length })}
            options={[
              { value: 'students', label: w('filterStudents', { count: data.entries.length - guests }) },
              { value: 'guests', label: w('filterGuests', { count: guests }) },
            ]}
          />
        </div>
      )}

      {/* relative: keeps the sr-only header inside the scroll box (it would widen the page otherwise). */}
      <div className="relative overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{w('email')}</th>
              <th className="p-3 text-start">{w('language')}</th>
              <th className="p-3 text-start">{w('joined')}</th>
              <th className="p-3 text-start">{w('status')}</th>
              <th className="p-3 text-end">
                <span className="sr-only">{w('remove')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  {data.entries.length === 0 ? w('empty') : w('filterEmpty')}
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="p-3">
                  <p className="font-medium text-fg" dir="ltr">
                    {e.email}
                  </p>
                  <p className="text-xs text-muted">{e.student ? (e.name ?? w('student')) : w('visitor')}</p>
                </td>
                <td className="p-3">{e.locale === 'ar' ? 'العربية' : 'English'}</td>
                <td className="p-3 whitespace-nowrap">{formatDate(e.joinedAt, locale)}</td>
                <td className="p-3">
                  {e.notifiedAt ? (
                    <Badge tone="success">{w('notifiedOn', { date: formatDate(e.notifiedAt, locale) })}</Badge>
                  ) : e.delivery === 'PENDING' ? (
                    <Badge tone="info">{w('sendingOne')}</Badge>
                  ) : e.delivery === 'FAILED' ? (
                    <Badge tone="danger">{w('failed')}</Badge>
                  ) : (
                    <Badge>{w('waitingOne')}</Badge>
                  )}
                </td>
                <td className="p-3 text-end">
                  <button
                    type="button"
                    onClick={() => remove(e.id, e.email)}
                    className="inline-flex min-h-11 items-center rounded px-2 text-xs font-semibold text-danger hover:underline sm:min-h-9"
                  >
                    {w('remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
