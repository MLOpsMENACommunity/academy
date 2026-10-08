'use client';

import { courseStatusLabels, courseTypeLabels, type ApplicationStatus, type CourseStatus, type CourseType } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Row {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  type: CourseType;
  status: CourseStatus;
  startDate: string | null;
  capacity: number | null;
  enrollments: number;
  sessions: number;
  applications: Record<ApplicationStatus, number>;
}

export default function AdminCourses() {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<Row[]>('/admin/courses')
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.courses.title')}</h1>
        <Link href={`/${locale}/admin/courses/new`} className={buttonClass('primary', 'sm')}>
          + {t('admin.courses.new')}
        </Link>
      </div>
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      <div className="mt-5 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{t('admin.courses.fields.titleEn')}</th>
              <th className="p-3 text-start">{t('admin.courses.fields.status')}</th>
              <th className="p-3 text-start">{t('admin.courses.fields.startDate')}</th>
              <th className="p-3 text-start">{t('admin.nav.applications')}</th>
              <th className="p-3 text-start">{t('admin.courses.enrolled')}</th>
              <th className="p-3 text-start">{t('admin.courses.sessions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  {t('admin.common.none')}
                </td>
              </tr>
            )}
            {rows?.map((c) => {
              const apps = Object.values(c.applications).reduce((a, n) => a + n, 0);
              return (
                <tr key={c.id} className="border-t border-line hover:bg-muted-bg/50">
                  <td className="p-3">
                    <Link href={`/${locale}/admin/courses/${c.id}`} className="font-semibold text-primary hover:underline">
                      {locale === 'ar' ? c.titleAr : c.titleEn}
                    </Link>
                    <p className="text-xs text-muted" dir="ltr">
                      /{c.slug} · {courseTypeLabels[c.type][locale]}
                    </p>
                  </td>
                  <td className="p-3">
                    <Badge tone={c.status === 'OPEN' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'neutral'}>
                      {courseStatusLabels[c.status][locale]}
                    </Badge>
                  </td>
                  <td className="p-3 whitespace-nowrap">{c.startDate ? formatDate(c.startDate, locale) : '—'}</td>
                  <td className="p-3">
                    <Link href={`/${locale}/admin/applications?courseId=${c.id}`} className="text-primary hover:underline">
                      {apps}
                    </Link>
                    {c.applications.SUBMITTED > 0 && <span className="ms-2 text-xs text-warning">(+{c.applications.SUBMITTED})</span>}
                  </td>
                  <td className="p-3">
                    {c.enrollments}
                    {c.capacity ? ` / ${c.capacity}` : ''}
                  </td>
                  <td className="p-3">{c.sessions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
