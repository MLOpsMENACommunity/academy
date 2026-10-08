'use client';

import { applicationStatusLabels, type AnswerValue, type MyApplicationDetailDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/applications/StatusBadge';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

export function ApplicationDetail() {
  return <RequireAuth>{() => <Inner />}</RequireAuth>;
}

function Inner() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<MyApplicationDetailDto | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);

  const load = useCallback(() => {
    api<MyApplicationDetailDto>(`/me/applications/${id}`)
      .then(setApp)
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id]);
  useEffect(load, [load]);

  if (error) {
    return (
      <Container className="py-12">
        <Alert tone="danger">{error === 'notFound' ? t('errors.notFoundTitle') : t('errors.generic')}</Alert>
      </Container>
    );
  }
  if (!app) return <PageSpinner />;

  const title = locale === 'ar' ? app.course.titleAr : app.course.titleEn;
  const answerText = (v: AnswerValue | undefined, options: { value: string; labelEn: string; labelAr: string }[] | null) => {
    if (v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('apply.yes') : t('apply.no');
    const lbl = (x: string) => {
      const o = options?.find((o) => o.value === x);
      return o ? (locale === 'ar' ? o.labelAr : o.labelEn) : x;
    };
    return Array.isArray(v) ? v.map(lbl).join(locale === 'ar' ? '، ' : ', ') : lbl(String(v));
  };

  return (
    <Container className="max-w-3xl py-10">
      <Link href={`/${locale}/dashboard`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('applications.back')}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{t('applications.title')}</p>
          <h1 className="text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">{t('applications.submitted', { date: formatDate(app.createdAt, locale) })}</p>
        </div>
        <StatusBadge status={app.status} locale={locale} />
      </div>

      <section className="mt-6 rounded-card border border-line bg-card p-5" aria-live="polite">
        <p className="font-semibold text-fg">{t(`applications.next.${app.status}`)}</p>
        {app.rejectionReason && <p className="mt-2 text-sm text-muted">{t('applications.reason', { reason: app.rejectionReason })}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {app.enrolled && (
            <Link href={`/${locale}/courses/${app.course.slug}`} className={buttonClass('accent', 'md')}>
              {t('applications.goToCourse')}
            </Link>
          )}
          <Link href={`/${locale}/courses/${app.course.slug}`} className={buttonClass('secondary', 'md')}>
            {t('applications.viewCourse')}
          </Link>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="timeline">
        <h2 id="timeline" className="text-xl">
          {t('applications.timeline')}
        </h2>
        <ol className="mt-4 space-y-0 border-s-2 border-line ps-5">
          {app.history.map((h, i) => (
            <li key={i} className="relative pb-5 last:pb-0">
              <span aria-hidden className="absolute -start-[1.6rem] top-1.5 size-3 rounded-full border-2 border-white bg-primary" />
              <p className="font-semibold text-fg">{applicationStatusLabels[h.toStatus][locale]}</p>
              <p className="text-xs text-muted">{formatDateTime(h.createdAt, locale)}</p>
              {h.reason && <p className="mt-1 text-sm">{t('applications.reason', { reason: h.reason })}</p>}
            </li>
          ))}
        </ol>
      </section>

      {app.questions.length > 0 && (
        <section className="mt-8" aria-labelledby="answers">
          <h2 id="answers" className="text-xl">
            {t('applications.yourAnswers')}
          </h2>
          <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-card">
            {app.questions.map((q) => (
              <div key={q.id} className="p-4">
                <dt className="text-sm font-semibold text-fg">{locale === 'ar' ? q.labelAr : q.labelEn}</dt>
                <dd className="mt-1 text-sm whitespace-pre-line">{answerText(app.answers[q.id], q.options)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </Container>
  );
}
