'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Deletes a course nobody applied to. When it has applicants or students the API
 * refuses (their records must stay), and we offer to archive it instead.
 */
export function DeleteCourse({
  courseId,
  title,
  onDone,
  className = '',
}: {
  courseId: string;
  title: string;
  onDone: (result: 'deleted' | 'archived') => void;
  className?: string;
}) {
  const { t } = useI18n();
  const d = (k: string, v?: Record<string, string>) => t(`admin.courses.delete.${k}`, v);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!window.confirm(d('confirm', { title }))) return;
    setBusy(true);
    try {
      await api(`/admin/courses/${courseId}`, { method: 'DELETE' });
      onDone('deleted');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COURSE_HAS_APPLICANTS') {
        if (window.confirm(d('hasApplicants', { title }))) {
          try {
            await api(`/admin/courses/${courseId}/archive`, { method: 'POST' });
            onDone('archived');
          } catch (e) {
            window.alert(errorMessage(e, t));
          }
        }
      } else {
        window.alert(errorMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={`rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50 ${className}`}
    >
      {busy ? t('admin.common.loading') : t('admin.common.delete')}
    </button>
  );
}
