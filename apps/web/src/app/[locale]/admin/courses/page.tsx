'use client';

import { courseStatusLabels, courseTypeLabels, hasAdminPermission, type ApplicationStatus, type CourseStatus, type CourseType } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DeleteCourse } from '@/components/admin/DeleteCourse';
import { enrolledOfCapacity } from '@/components/admin/enrolled-total';
import { useAuth } from '@/components/auth/AuthProvider';
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
  source: string | null;
  startDate: string | null;
  capacity: number | null;
  /** Active enrolments of accounts that aren't deleted: the public count, shown here even when the course hides it. */
  enrolledCount: number;
  sessions: number;
  applications: Record<ApplicationStatus, number>;
}

export default function AdminCourses() {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  // Creating and deleting courses is for the academic preset; admissions opens them for their tabs.
  const academic = hasAdminPermission(useAuth().user, ['ACADEMIC']);

  const load = useCallback(() => {
    api<Row[]>('/admin/courses')
      .then(setRows)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.courses.title')}</h1>
        {academic && (
          <Link href={`/${locale}/admin/courses/new`} className={buttonClass('primary', 'sm')}>
            + {t('admin.courses.new')}
          </Link>
        )}
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
              <th className="p-3 text-end">{t('admin.common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
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
                      {(locale === 'ar' && c.titleAr) || c.titleEn}
                    </Link>
                    <p className="text-xs text-muted" dir="ltr">
                      /{c.slug} · {courseTypeLabels[c.type][locale]}
                    </p>
                  </td>
                  <td className="p-3">
                    <Badge tone={c.status === 'OPEN' ? 'success' : c.status === 'DRAFT' ? 'warning' : c.status === 'COMING_SOON' ? 'info' : 'neutral'}>
                      {courseStatusLabels[c.status][locale]}
                    </Badge>
                    {c.source === 'import' && (
                      <span className="ms-1.5">
                        <Badge tone="info">{t('admin.common.imported')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">{c.startDate ? formatDate(c.startDate, locale) : '—'}</td>
                  <td className="p-3">
                    <Link href={`/${locale}/admin/applications?courseId=${c.id}`} className="text-primary hover:underline">
                      {apps}
                    </Link>
                    {c.applications.SUBMITTED > 0 && <span className="ms-2 text-xs text-warning">(+{c.applications.SUBMITTED})</span>}
                  </td>
                  <td className="p-3 whitespace-nowrap tabular-nums">
                    <Link href={`/${locale}/admin/courses/${c.id}?tab=enrolled`} className="text-primary hover:underline" dir="ltr">
                      {enrolledOfCapacity(c.enrolledCount, c.capacity)}
                    </Link>
                  </td>
                  <td className="p-3">{c.sessions}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <Link href={`/${locale}/admin/courses/${c.id}`} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold">
                        {t('admin.common.edit')}
                      </Link>
                      {academic && <DeleteCourse courseId={c.id} title={c.titleEn} titleAr={c.titleAr} slug={c.slug} onDone={load} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
