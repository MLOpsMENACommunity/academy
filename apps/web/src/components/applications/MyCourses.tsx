'use client';

import type { MyApplicationDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Alert } from '../ui/Alert';
import { buttonClass } from '../ui/Button';
import { StatusBadge } from './StatusBadge';

/** Dashboard list: every application with its status and the one next step. */
export function MyCourses() {
  const { locale, t } = useI18n();
  const [apps, setApps] = useState<MyApplicationDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<MyApplicationDto[]>('/me/applications').then(setApps).catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="danger">{t('errors.generic')}</Alert>;
  if (!apps) return <p className="text-muted">{t('common.loading')}</p>;
  if (!apps.length) {
    return (
      <div className="rounded-card border border-dashed border-line-strong p-8 text-center">
        <p className="text-muted">{t('dashboard.noCourses')}</p>
        <Link href={`/${locale}/courses`} className={buttonClass('primary', 'md', 'mt-4')}>
          {t('dashboard.browse')}
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {apps.map((a) => {
        const title = locale === 'ar' ? a.course.titleAr : a.course.titleEn;
        const needsPayment = a.status === 'AWAITING_PAYMENT' || a.status === 'PAYMENT_REJECTED';
        return (
          <li key={a.id} className="flex flex-col rounded-card border border-line bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg">{title}</h3>
              <StatusBadge status={a.status} locale={locale} />
            </div>
            {a.course.startDate && (
              <p className="mt-1 text-xs text-muted">{t('catalog.starts', { date: formatDate(a.course.startDate, locale) })}</p>
            )}
            <p className="mt-3 text-sm text-body">{t(`applications.next.${a.status}`)}</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              {a.enrolled ? (
                <Link href={`/${locale}/courses/${a.course.slug}`} className={buttonClass('accent', 'md')}>
                  {t('applications.goToCourse')}
                </Link>
              ) : needsPayment ? (
                <Link href={`/${locale}/dashboard/applications/${a.id}#payment-title`} className={buttonClass('accent', 'md')}>
                  {t('applications.pay')}
                </Link>
              ) : null}
              <Link href={`/${locale}/dashboard/applications/${a.id}`} className={buttonClass('secondary', 'md')}>
                {t('apply.viewApplication')}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
