'use client';

import { RATING_MIN_TO_SHOW, type AdminReviewDto, type TestimonialStatus } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { REVIEW_TONE, ReviewContent } from '@/components/admin/TestimonialsPanel';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';

const STATUSES: TestimonialStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
/** The API's limit (testimonials.service.ts ADMIN_REVIEWS_MAX). */
const LIMIT = 200;

/**
 * Admin → Reviews: every course's star ratings and testimonials in one queue. Approving or
 * rejecting uses the course's review route, so it's audit-logged and refreshes the public pages.
 */
export default function AdminReviews() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<TestimonialStatus>('PENDING');
  const [rows, setRows] = useState<AdminReviewDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    let current = true; // ignore responses for a tab the admin already left
    setError(null);
    api<AdminReviewDto[]>(`/admin/reviews?status=${status}`)
      .then((r) => current && setRows(r))
      .catch((err: unknown) => current && setError(errorMessage(err, t)));
    return () => {
      current = false;
    };
  }, [status, t]);
  useEffect(() => {
    setRows(null);
    return load();
  }, [load]);

  const review = async (r: AdminReviewDto, next: 'APPROVED' | 'REJECTED') => {
    setBusy(r.id);
    setError(null);
    try {
      await api(`/admin/courses/${r.courseId}/testimonials/${r.id}/review`, { method: 'PUT', json: { status: next } });
      load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const i = STATUSES.indexOf(status);
    const fwd = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const back = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key !== fwd && e.key !== back) return;
    e.preventDefault();
    const next = STATUSES[(i + (e.key === fwd ? 1 : STATUSES.length - 1)) % STATUSES.length]!;
    setStatus(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <h1 className="text-3xl">{t('admin.reviews.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('admin.reviews.intro', { min: RATING_MIN_TO_SHOW })}</p>
      <div role="tablist" aria-label={t('admin.reviews.filter')} className="mt-6 flex gap-1 border-b border-line" onKeyDown={onKey}>
        {STATUSES.map((s) => (
          <button
            key={s}
            ref={(el) => {
              tabs.current[s] = el;
            }}
            type="button"
            role="tab"
            id={`reviews-tab-${s}`}
            aria-selected={status === s}
            aria-controls="reviews-panel"
            tabIndex={status === s ? 0 : -1}
            onClick={() => setStatus(s)}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${status === s ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
          >
            {t(`admin.courses.testimonialStatus.${s}`)}
          </button>
        ))}
      </div>
      <div id="reviews-panel" role="tabpanel" aria-labelledby={`reviews-tab-${status}`} aria-busy={rows === null && !error}>
        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}
        {rows === null && !error && <p className="mt-6 text-muted">{t('common.loading')}</p>}
        {rows?.length === 0 && <p className="mt-6 text-muted">{t('admin.reviews.empty')}</p>}
        {rows && rows.length >= LIMIT && <p className="mt-3 text-xs text-muted">{t('admin.reviews.limit', { count: LIMIT })}</p>}
        <ul className="mt-4 space-y-3">
          {rows?.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {r.name ?? r.email} <span dir="ltr" className="text-sm font-normal text-muted">{r.email}</span>
                  </p>
                  <p className="text-sm text-muted">
                    <Link href={`/${locale}/admin/courses/${r.courseId}?tab=testimonials`} className="underline underline-offset-4 hover:text-primary">
                      {locale === 'ar' ? r.courseTitleAr : r.courseTitleEn}
                    </Link>{' '}
                    · {formatDateTime(r.updatedAt, locale)}
                  </p>
                </div>
                <Badge tone={REVIEW_TONE[r.status]}>{t(`admin.courses.testimonialStatus.${r.status}`)}</Badge>
              </div>
              <ReviewContent review={r} />
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status !== 'APPROVED' && (
                  <Button type="button" size="sm" loading={busy === r.id} onClick={() => void review(r, 'APPROVED')}>
                    {t('admin.courses.testimonialApprove')}
                  </Button>
                )}
                {r.status !== 'REJECTED' && (
                  <Button type="button" size="sm" variant="secondary" loading={busy === r.id} onClick={() => void review(r, 'REJECTED')}>
                    {t('admin.courses.testimonialReject')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
