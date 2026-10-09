'use client';

import {
  APPLICATION_STATUSES,
  applicationStatusLabels,
  countryName,
  experienceRangeLabels,
  seniorityLabels,
  type ApplicationStatus,
  type ExperienceRange,
  type Seniority,
} from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApplicationBulkBar } from '@/components/admin/ApplicationBulkBar';
import { CvMark } from '@/components/admin/CvCard';
import { Pager } from '@/components/admin/Pager';
import { StatusBadge } from '@/components/applications/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

interface Row {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  student: {
    id: string;
    email: string;
    name: string | null;
    country: string | null;
    seniority: Seniority | null;
    mlExperienceYears: ExperienceRange | null;
    hasCv: boolean;
  };
}
interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: Row[];
}

const PAGE_SIZE = 50;

/**
 * Admin → Courses → {course} → Applications: this course's applications, on the
 * same API, bulk actions and CSV export as Admin → Applications (filtered by course).
 */
export function CourseApplications({ courseId, slug, onChange }: { courseId: string; slug: string; onChange?: () => void }) {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  const query = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ courseId, ...extra });
    if (status) p.set('status', status);
    if (search) p.set('q', search);
    return p.toString();
  };
  const listQuery = query({ page: String(page), pageSize: String(PAGE_SIZE) });

  useEffect(() => {
    let current = true;
    setError(false);
    api<Page>(`/admin/applications?${listQuery}`)
      .then((d) => current && (setData(d), setSelected(new Set())))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
    // `version` reloads the same page after a bulk action.
  }, [listQuery, version]);

  const pick = (s: ApplicationStatus | null) => {
    setStatus(s);
    setPage(1);
  };
  const allChecked = !!data?.items.length && data.items.every((r) => selected.has(r.id));
  const mainHref = `/${locale}/admin/applications?${new URLSearchParams({ courseId, ...(status ? { status } : {}), ...(search ? { q: search } : {}) }).toString()}`;

  const chip = (value: ApplicationStatus | null, label: string) => (
    <button
      key={value ?? 'all'}
      type="button"
      aria-pressed={status === value}
      onClick={() => pick(value)}
      className={`min-h-9 rounded-full border px-3 text-sm whitespace-nowrap ${status === value ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line bg-card text-body hover:border-line-strong'}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex min-w-0 flex-1 basis-full items-end gap-2 sm:basis-auto"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(1);
          }}
        >
          <label className="block min-w-0 flex-1 sm:max-w-sm">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.courses.apps.searchLabel')}</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('admin.courses.apps.searchPlaceholder')}
              className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t('admin.courses.apps.search')}
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={mainHref} className="text-sm text-primary underline" title={t('admin.courses.apps.openInMainHint')}>
            {t('admin.courses.apps.openInMain')}
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setExportError(null);
              downloadViaApi(`/admin/applications.csv?${query()}`, `applications-${slug}.csv`).catch((err: unknown) => setExportError(errorMessage(err, t)));
            }}
          >
            ⬇ {t('admin.common.export')}
          </Button>
        </div>
      </div>
      {exportError && <Alert tone="danger" className="mt-4">{exportError}</Alert>}

      {/* Scrolls sideways on narrow screens instead of wrapping into many rows. */}
      <div role="group" aria-label={t('admin.courses.apps.statusFilter')} className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {chip(null, t('admin.courses.apps.all'))}
        {APPLICATION_STATUSES.map((s) => chip(s, applicationStatusLabels[s][locale]))}
      </div>

      <ApplicationBulkBar
        selected={selected}
        names={new Map(data?.items.map((i) => [i.id, i.student.name ?? i.student.email]))}
        onDone={async () => {
          setVersion((v) => v + 1);
          onChange?.();
        }}
      />
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}

      {data && (
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          {t('admin.courses.apps.count', { count: data.total })}
        </p>
      )}
      <div className="mt-2 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label={t('admin.common.selectAll')}
                  checked={allChecked}
                  onChange={(e) => setSelected(e.target.checked ? new Set(data?.items.map((r) => r.id)) : new Set())}
                  className="size-4"
                />
              </th>
              <th className="p-3 text-start">{t('admin.courses.apps.applicant')}</th>
              <th className="p-3 text-start">{t('admin.apps.status')}</th>
              <th className="p-3 text-start">{t('admin.apps.applied')}</th>
              <th className="p-3 text-start">{t('admin.courses.apps.seniority')}</th>
              <th className="p-3 text-start">{t('admin.courses.apps.mlExperience')}</th>
              <th className="p-3 text-start">{t('admin.courses.apps.country')}</th>
              <th className="p-3 text-start">{t('admin.apps.cv')}</th>
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted">
                  {t('admin.common.loading')}
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted">
                  {t('admin.common.none')}
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} className="border-t border-line align-top hover:bg-muted-bg/50">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={r.student.name ?? r.student.email}
                    checked={selected.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setSelected(next);
                    }}
                    className="size-4"
                  />
                </td>
                <td className="p-3">
                  <Link href={`/${locale}/admin/applications/${r.id}`} className="font-semibold text-primary hover:underline">
                    {r.student.name ?? r.student.email}
                  </Link>
                  {r.student.name && <p className="ltr-embed text-xs text-muted">{r.student.email}</p>}
                </td>
                <td className="p-3">
                  <StatusBadge status={r.status} locale={locale} />
                </td>
                <td className="p-3 whitespace-nowrap">{formatDate(r.createdAt, locale)}</td>
                <td className="p-3">{r.student.seniority ? seniorityLabels[r.student.seniority][locale] : '—'}</td>
                <td className="p-3">{r.student.mlExperienceYears ? experienceRangeLabels[r.student.mlExperienceYears][locale] : '—'}</td>
                <td className="p-3">{r.student.country ? countryName(r.student.country, locale) : '—'}</td>
                <td className="p-3">
                  <CvMark hasCv={r.student.hasCv} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
