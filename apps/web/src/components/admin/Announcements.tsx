'use client';

import { announcementSchema, APPLICATION_STATUSES, applicationStatusLabels, type ApplicationStatus } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { issuesToErrors } from '@/lib/zod-errors';
import { MultiSelect } from './MultiSelect';

interface HistoryRow {
  at: string;
  by: string | null;
  subject: string;
  statuses: ApplicationStatus[];
  recipients: number;
  sent: number | null;
  failed: number | null;
}

const EMPTY = { subjectEn: '', subjectAr: '', bodyEn: '', bodyAr: '' };

/** Email + in-app message to a course's students, chosen by application status. */
export function Announcements({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.courses.ann.${k}`, v);
  const [msg, setMsg] = useState(EMPTY);
  const [statuses, setStatuses] = useState<ApplicationStatus[]>(['ENROLLED']);
  const [count, setCount] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => {
    api<HistoryRow[]>(`/admin/courses/${courseId}/announcements`)
      .then(setHistory)
      .catch(() => undefined);
  }, [courseId]);
  useEffect(loadHistory, [loadHistory]);

  useEffect(() => {
    if (!statuses.length) return setCount(0);
    let current = true;
    api<{ count: number }>(`/admin/courses/${courseId}/announcements/audience?statuses=${statuses.join(',')}`)
      .then((r) => current && setCount(r.count))
      .catch(() => current && setCount(null));
    return () => {
      current = false;
    };
  }, [courseId, statuses]);

  async function send() {
    setError(null);
    setDone(null);
    const parsed = announcementSchema.safeParse({ ...msg, statuses });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    if (!count || !window.confirm(a('confirm', { count }))) return;
    setBusy(true);
    try {
      const r = await api<{ recipients: number }>(`/admin/courses/${courseId}/announcements`, { method: 'POST', json: parsed.data });
      setDone(a('sent', { count: r.recipients }));
      setMsg(EMPTY);
      loadHistory();
      // Emails go out in the background; refresh once more so delivery results appear.
      setTimeout(loadHistory, Math.min(60_000, r.recipients * 700 + 2_000));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof EMPTY) => (v: string) => setMsg((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-lg">{a('title')}</h2>
        <p className="mt-1 text-sm text-muted">{a('help')}</p>
        {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
        {done && <Alert tone="success" className="mt-3">{done}</Alert>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField label={a('subjectEn')} required value={msg.subjectEn} onChange={set('subjectEn')} error={errors.subjectEn} maxLength={150} />
          <TextField label={a('subjectAr')} hint={a('arHint')} dir="rtl" value={msg.subjectAr} onChange={set('subjectAr')} maxLength={150} />
          <TextAreaField label={a('bodyEn')} required value={msg.bodyEn} onChange={set('bodyEn')} error={errors.bodyEn} rows={7} maxLength={5000} />
          <TextAreaField label={a('bodyAr')} hint={a('arHint')} dir="rtl" value={msg.bodyAr} onChange={set('bodyAr')} rows={7} maxLength={5000} />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="min-w-64">
            <MultiSelect
              label={a('audience')}
              options={APPLICATION_STATUSES.map((s) => ({ value: s, label: applicationStatusLabels[s][locale] }))}
              value={statuses}
              onChange={(v) => setStatuses(v as ApplicationStatus[])}
            />
          </div>
          <p className="pb-2 text-sm text-muted" aria-live="polite">
            {count === null ? '' : a('recipients', { count })}
          </p>
          <Button type="button" className="ms-auto" loading={busy} disabled={!count} onClick={send}>
            {a('send')}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg">{a('history')}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('admin.common.none')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.at} className="py-3">
                <p className="font-semibold text-fg">{h.subject}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(h.at, locale)} · {h.by ?? '—'} · {h.statuses.map((s) => applicationStatusLabels[s]?.[locale] ?? s).join(', ')}
                </p>
                <p className="text-xs">
                  {h.sent === null ? a('sending', { count: h.recipients }) : a('delivered', { sent: h.sent, count: h.recipients })}
                  {h.failed ? <span className="text-danger"> · {a('failed', { count: h.failed })}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
