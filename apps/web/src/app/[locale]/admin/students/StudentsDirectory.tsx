'use client';

import { countryName, experienceRangeLabels, seniorityLabels } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AddStudent } from '@/components/admin/AddStudent';
import { Pager } from '@/components/admin/Pager';
import { ProfileFilters } from '@/components/admin/ProfileFilters';
import { useQueryState } from '@/components/admin/query';
import { SavedViews } from '@/components/admin/SavedViews';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSearchParam } from '@/lib/use-search-param';

interface Row {
  id: string;
  email: string;
  name: string | null;
  country: string | null;
  jobTitle: string | null;
  experienceYears: string | null;
  seniority: string | null;
  completeness: number;
  openToOpportunities: boolean;
  applications: number;
  createdAt: string;
}

export function StudentsDirectory() {
  const { locale, t } = useI18n();
  const { params, query, set, replaceAll } = useQueryState();
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; items: Row[] } | null>(null);
  const [error, setError] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const deleted = useSearchParam('deleted');
  const [q, setQ] = useState(params.q ?? '');
  // Keep the search box in step with the URL (Reset, saved views, back button).
  useEffect(() => setQ(params.q ?? ''), [params.q]);

  useEffect(() => {
    let current = true;
    setError(false);
    api<typeof data>(`/admin/students?${query}`)
      .then((d) => current && setData(d))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [query]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">{t('admin.students.title')}</h1>
          <p className="text-sm text-muted">{t('admin.students.subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => {
            setExportError(null);
            downloadViaApi(`/admin/students.csv?${query}`, 'students.csv').catch((err: unknown) => setExportError(errorMessage(err, t)));
          }}>
          ⬇ {t('admin.common.export')}
        </Button>
      </div>
      {exportError && <Alert tone="danger" className="mt-4">{exportError}</Alert>}
      {deleted && <Alert tone="success" className="mt-4">{t('admin.studentEdit.deleted')}</Alert>}
      <div className="mt-4">
        <AddStudent />
      </div>
      <div className="mt-5 space-y-4 rounded-card border border-line bg-card p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set({ q });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="block min-w-64 flex-1">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.common.search')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.sort')}</span>
            <select className="block min-h-10 rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm" value={params.sort ?? 'newest'} onChange={(e) => set({ sort: e.target.value })}>
              {(['newest', 'oldest', 'name', 'experience'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`admin.apps.sorts.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </form>
        <ProfileFilters params={params} set={set} />
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          <SavedViews scope="STUDENTS" query={query} onApply={replaceAll} />
          {query && (
            <button type="button" className="text-sm text-muted underline" onClick={() => replaceAll('')}>
              {t('admin.common.reset')}
            </button>
          )}
        </div>
      </div>
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{t('admin.apps.student')}</th>
              <th className="p-3 text-start">{t('profile.fields.experienceYears')}</th>
              <th className="p-3 text-start">{t('profile.fields.seniority')}</th>
              <th className="p-3 text-start">{t('admin.students.completeness')}</th>
              <th className="p-3 text-start">{t('admin.students.applications')}</th>
              <th className="p-3 text-start">{t('admin.students.joined')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  {t('admin.common.none')}
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-muted-bg/50">
                <td className="p-3">
                  <Link href={`/${locale}/admin/students/${r.id}`} className="font-semibold text-primary hover:underline">
                    {r.name ?? r.email}
                  </Link>
                  <p className="text-xs text-muted">{[r.jobTitle, r.country ? countryName(r.country, locale) : null].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="p-3">{r.experienceYears ? experienceRangeLabels[r.experienceYears as keyof typeof experienceRangeLabels][locale] : '—'}</td>
                <td className="p-3">{r.seniority ? seniorityLabels[r.seniority as keyof typeof seniorityLabels][locale] : '—'}</td>
                <td className="p-3">{r.completeness}%</td>
                <td className="p-3">{r.applications}</td>
                <td className="p-3 whitespace-nowrap">{formatDate(r.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) }, false)} />}
    </div>
  );
}
