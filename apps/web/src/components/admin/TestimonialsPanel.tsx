'use client';

import type { AdminTestimonialDto } from '@academy/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral' } as const;

/** Review students' testimonials: only approved ones show on the public course page. */
export function TestimonialsPanel({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminTestimonialDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/admin/courses/${courseId}/testimonials`;

  const load = useCallback(() => {
    api<AdminTestimonialDto[]>(base)
      .then(setRows)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [base, t]);
  useEffect(load, [load]);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusy(id);
    setError(null);
    try {
      await api(`${base}/${id}/review`, { method: 'PUT', json: { status } });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('admin.courses.testimonialsHint')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {rows?.length === 0 && <p className="text-muted">{t('admin.courses.testimonialsEmpty')}</p>}
      <ul className="space-y-3">
        {rows?.map((r) => (
          <li key={r.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-fg">
                {r.name ?? r.email} <span dir="ltr" className="text-sm font-normal text-muted">{r.email}</span>
              </p>
              <Badge tone={TONE[r.status]}>{t(`admin.courses.testimonialStatus.${r.status}`)}</Badge>
            </div>
            <p dir="auto" className="mt-2 whitespace-pre-line text-body">
              {r.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status !== 'APPROVED' && (
                <Button type="button" size="sm" loading={busy === r.id} onClick={() => void review(r.id, 'APPROVED')}>
                  {t('admin.courses.testimonialApprove')}
                </Button>
              )}
              {r.status !== 'REJECTED' && (
                <Button type="button" size="sm" variant="secondary" loading={busy === r.id} onClick={() => void review(r.id, 'REJECTED')}>
                  {t('admin.courses.testimonialReject')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
