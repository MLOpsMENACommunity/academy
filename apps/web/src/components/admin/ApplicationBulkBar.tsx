'use client';

import type { AdminApplicationEvent } from '@academy/shared';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Bulk status changes for the selected applications (Admin → Applications and a
 * course's Applications tab). `names` labels failures; `onDone` reloads the list
 * and clears the selection.
 */
export function ApplicationBulkBar({
  selected,
  names,
  onDone,
  bulkUrl = '/admin/applications/bulk',
}: {
  /** Course staff: /teach/courses/{id}/applications/bulk. */
  bulkUrl?: string;
  selected: Set<string>;
  names: Map<string, string>;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [event, setEvent] = useState<AdminApplicationEvent>('SHORTLIST');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setMsg(null);
    setErrors([]);
    try {
      const r = await api<{ succeeded: number; results: { id: string; ok: boolean; error?: string }[] }>(bulkUrl, {
        method: 'POST',
        json: { ids: [...selected], event, reason: reason || undefined },
      });
      setMsg(t('admin.apps.bulkDone', { ok: r.succeeded, total: r.results.length }));
      setErrors(r.results.filter((x) => !x.ok).map((x) => `${names.get(x.id) ?? x.id}: ${x.error ?? ''}`));
      setReason('');
      await onDone();
    } catch (err) {
      setMsg(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mt-4 flex flex-wrap items-end gap-3 rounded-card border border-primary/40 bg-primary-soft p-3" role="region" aria-label={t('admin.apps.bulk')}>
          <span className="text-sm font-semibold">{t('admin.common.selected', { count: selected.size })}</span>
          <label className="block">
            <span className="sr-only">{t('admin.apps.bulk')}</span>
            <select value={event} onChange={(e) => setEvent(e.target.value as AdminApplicationEvent)} className="min-h-10 rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm">
              {(['SHORTLIST', 'ACCEPT', 'REJECT', 'WAITLIST'] as const).map((ev) => (
                <option key={ev} value={ev}>
                  {t(`admin.apps.events.${ev}`)}
                </option>
              ))}
            </select>
          </label>
          {event === 'REJECT' && (
            <input
              aria-label={t('admin.apps.reason')}
              placeholder={t('admin.apps.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              className="min-h-10 min-w-64 rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm"
            />
          )}
          <Button size="sm" loading={busy} onClick={run}>
            {t('admin.apps.run')}
          </Button>
        </div>
      )}
      {msg && (
        <p role="status" className="mt-3 text-sm text-success">
          {msg}
        </p>
      )}
      {errors.length > 0 && (
        <Alert tone="warning" className="mt-2">
          <ul className="list-disc ps-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
