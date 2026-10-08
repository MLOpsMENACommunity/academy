'use client';

import {
  APPLICATION_STATUSES,
  applicationStatusLabels,
  courseStatusLabels,
  FUNNEL_EVENTS,
  type ApplicationStatus,
  type CourseStatus,
  type FunnelEvent,
} from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

interface Dashboard {
  courseCount: number;
  pendingPayments: number;
  newApplications7d: number;
  courses: {
    id: string;
    slug: string;
    titleEn: string;
    titleAr: string;
    status: CourseStatus;
    capacity: number | null;
    statusCounts: Record<ApplicationStatus, number>;
    funnel: Record<FunnelEvent, number>;
  }[];
}

export default function AdminHome() {
  const { locale, t } = useI18n();
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Dashboard>('/admin/dashboard')
      .then(setD)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <h1 className="text-3xl">{t('admin.nav.dashboard')}</h1>
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">{t('admin.dashboard.pendingPayments')}</p>
          <p className="mt-1 text-4xl font-bold text-fg">{d?.pendingPayments ?? '–'}</p>
          <Link href={`/${locale}/admin/payments`} className={buttonClass('primary', 'sm', 'mt-4')}>
            {t('admin.nav.payments')}
          </Link>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('admin.dashboard.newApplications')}</p>
          <p className="mt-1 text-4xl font-bold text-fg">{d?.newApplications7d ?? '–'}</p>
          <Link href={`/${locale}/admin/applications?status=SUBMITTED`} className={buttonClass('secondary', 'sm', 'mt-4')}>
            {t('admin.nav.applications')}
          </Link>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('admin.dashboard.courses')}</p>
          <p className="mt-1 text-4xl font-bold text-fg">{d?.courseCount ?? '–'}</p>
          <Link href={`/${locale}/admin/courses`} className={buttonClass('secondary', 'sm', 'mt-4')}>
            {t('admin.nav.courses')}
          </Link>
        </Card>
      </div>

      {d?.courses.map((c) => {
        const top = Math.max(1, ...Object.values(c.funnel));
        return (
          <Card key={c.id} className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl">
                <Link href={`/${locale}/admin/courses/${c.id}`} className="hover:underline">
                  {locale === 'ar' ? c.titleAr : c.titleEn}
                </Link>
              </h2>
              <Badge tone={c.status === 'OPEN' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'neutral'}>{courseStatusLabels[c.status][locale]}</Badge>
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold text-muted">{t('admin.dashboard.statuses')}</h3>
                <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {APPLICATION_STATUSES.map((s) => (
                    <li key={s}>
                      <Link
                        href={`/${locale}/admin/applications?courseId=${c.id}&status=${s}`}
                        className="flex justify-between rounded-lg bg-muted-bg px-3 py-2 hover:bg-line"
                      >
                        <span>{applicationStatusLabels[s][locale]}</span>
                        <span className="font-bold">{c.statusCounts[s]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-muted">{t('admin.dashboard.funnel')}</h3>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {FUNNEL_EVENTS.map((e, i) => {
                    const n = c.funnel[e];
                    const prev = i > 0 ? c.funnel[FUNNEL_EVENTS[i - 1]!] : 0;
                    return (
                      <li key={e} className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-2">
                        <span className="truncate">{t(`admin.dashboard.events.${e}`)}</span>
                        <span className="h-3 rounded-full bg-muted-bg" aria-hidden>
                          <span className="block h-3 rounded-full bg-primary" style={{ width: `${(n / top) * 100}%` }} />
                        </span>
                        <span className="text-end tabular-nums">
                          {n}
                          {i > 0 && prev > 0 && <span className="ms-1 text-xs text-muted">({Math.round((n / prev) * 100)}%)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
