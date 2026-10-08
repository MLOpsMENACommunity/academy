'use client';

import {
  APPLICATION_STATUSES,
  applicationStatusLabels,
  areaLabels,
  countryName,
  experienceRangeLabels,
  type AdminApplicationEvent,
  type ApplicationStatus,
} from '@academy/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MultiSelect } from '@/components/admin/MultiSelect';
import { Pager } from '@/components/admin/Pager';
import { ProfileFilters } from '@/components/admin/ProfileFilters';
import { listParam, useQueryState } from '@/components/admin/query';
import { SavedViews } from '@/components/admin/SavedViews';
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
  ref: string | null;
  course: { id: string; titleEn: string; titleAr: string };
  student: { id: string; email: string; name: string | null; country: string | null; jobTitle: string | null; experienceYears: string | null; primaryArea: string | null };
  availableEvents: AdminApplicationEvent[];
}
interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: Row[];
}

export function ApplicationsTable() {
  const { locale, t } = useI18n();
  const { params, query, set, replaceAll } = useQueryState();
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const [courses, setCourses] = useState<{ id: string; titleEn: string; titleAr: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [event, setEvent] = useState<AdminApplicationEvent>('SHORTLIST');
  const [reason, setReason] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState(params.q ?? '');
  const [ref, setRef] = useState(params.ref ?? '');
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  // Keep the text inputs in step with the URL (Reset, saved views, back button).
  useEffect(() => setQ(params.q ?? ''), [params.q]);
  useEffect(() => setRef(params.ref ?? ''), [params.ref]);
  // Date inputs hold calendar days in the admin's timezone; the API wants instants.
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    const from = p.get('from');
    const to = p.get('to');
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set('to', new Date(`${to}T23:59:59.999`).toISOString());
    return p.toString();
  }, [query]);

  useEffect(() => {
    api<{ id: string; titleEn: string; titleAr: string }[]>('/admin/courses').then(setCourses).catch(() => undefined);
  }, []);
  useEffect(() => {
    let current = true;
    setError(false);
    api<Page>(`/admin/applications?${apiQuery}`)
      .then((d) => current && (setData(d), setSelected(new Set())))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [apiQuery]);

  async function runBulk() {
    setBusy(true);
    setBulkMsg(null);
    setBulkErrors([]);
    try {
      const r = await api<{ succeeded: number; results: { id: string; ok: boolean; error?: string }[] }>('/admin/applications/bulk', {
        method: 'POST',
        json: { ids: [...selected], event, reason: reason || undefined },
      });
      setBulkMsg(t('admin.apps.bulkDone', { ok: r.succeeded, total: r.results.length }));
      const names = new Map(data?.items.map((i) => [i.id, i.student.name ?? i.student.email]));
      setBulkErrors(r.results.filter((x) => !x.ok).map((x) => `${names.get(x.id) ?? x.id}: ${x.error ?? ''}`));
      setReason('');
      const d = await api<Page>(`/admin/applications?${apiQuery}`);
      setData(d);
      setSelected(new Set());
    } catch (err) {
      setBulkMsg(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const title = (c: { titleEn: string; titleAr: string }) => ((locale === 'ar' && c.titleAr) || c.titleEn);
  const allChecked = !!data?.items.length && data.items.every((r) => selected.has(r.id));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.apps.title')}</h1>
        <Button variant="secondary" size="sm" onClick={() => downloadViaApi(`/admin/applications.csv?${apiQuery}`, 'applications.csv').catch(() => undefined)}>
          ⬇ {t('admin.common.export')}
        </Button>
      </div>

      <div className="mt-5 space-y-4 rounded-card border border-line bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <form
            className="sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q });
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.common.search')}</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm" />
            </label>
          </form>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.course')}</span>
            <select className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm" value={params.courseId ?? ''} onChange={(e) => set({ courseId: e.target.value })}>
              <option value="">{t('admin.common.any')}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {title(c)}
                </option>
              ))}
            </select>
          </label>
          <MultiSelect
            label={t('admin.apps.status')}
            options={APPLICATION_STATUSES.map((s) => ({ value: s, label: applicationStatusLabels[s][locale] }))}
            value={listParam(params.status)}
            onChange={(v) => set({ status: v })}
          />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.ref')}</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} onBlur={() => ref !== (params.ref ?? '') && set({ ref })} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.from')}</span>
            <input type="date" value={params.from ?? ''} onChange={(e) => set({ from: e.target.value })} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.to')}</span>
            <input type="date" value={params.to ?? ''} onChange={(e) => set({ to: e.target.value })} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.apps.sort')}</span>
            <select className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm" value={params.sort ?? 'newest'} onChange={(e) => set({ sort: e.target.value })}>
              {(['newest', 'oldest', 'name', 'experience'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`admin.apps.sorts.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)} className="text-sm font-semibold text-primary underline">
          {t('admin.common.filters')} {showFilters ? '▴' : '▾'}
        </button>
        {showFilters && <ProfileFilters params={params} set={set} />}
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          <SavedViews scope="APPLICATIONS" query={query} onApply={replaceAll} />
          {query && (
            <button type="button" className="text-sm text-muted underline" onClick={() => replaceAll('')}>
              {t('admin.common.reset')}
            </button>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mt-4 flex flex-wrap items-end gap-3 rounded-card border border-primary/40 bg-primary-soft p-3" role="region" aria-label={t('admin.apps.bulk')}>
          <span className="text-sm font-semibold">{t('admin.common.selected', { count: selected.size })}</span>
          <label className="block">
            <span className="sr-only">{t('admin.apps.bulk')}</span>
            <select value={event} onChange={(e) => setEvent(e.target.value as AdminApplicationEvent)} className="min-h-10 rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm">
              {(['SHORTLIST', 'ACCEPT', 'REJECT', 'WAITLIST'] as const).map((ev) => (
                <option key={ev} value={ev}>
                  {t(`admin.apps.events.${ev}`)}
                </option>
              ))}
            </select>
          </label>
          {event === 'REJECT' && (
            <input
              aria-label={t('admin.apps.reason')}
              placeholder={t('admin.apps.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              className="min-h-10 min-w-64 rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm"
            />
          )}
          <Button size="sm" loading={busy} onClick={runBulk}>
            {t('admin.apps.run')}
          </Button>
        </div>
      )}
      {bulkMsg && (
        <p role="status" className="mt-3 text-sm text-success">
          {bulkMsg}
        </p>
      )}
      {bulkErrors.length > 0 && (
        <Alert tone="warning" className="mt-2">
          <ul className="list-disc ps-5">
            {bulkErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}

      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted-bg text-start text-xs text-muted">
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
              <th className="p-3 text-start">{t('admin.apps.student')}</th>
              <th className="p-3 text-start">{t('admin.apps.course')}</th>
              <th className="p-3 text-start">{t('profile.fields.experienceYears')}</th>
              <th className="p-3 text-start">{t('admin.apps.status')}</th>
              <th className="p-3 text-start">{t('admin.apps.applied')}</th>
              <th className="p-3 text-start">{t('admin.apps.ref')}</th>
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  {t('admin.common.loading')}
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
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
                  <p className="text-xs text-muted">
                    {[r.student.jobTitle, r.student.country ? countryName(r.student.country, locale) : null, r.student.primaryArea ? areaLabels[r.student.primaryArea as keyof typeof areaLabels]?.[locale] : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </td>
                <td className="p-3">{title(r.course)}</td>
                <td className="p-3">{r.student.experienceYears ? experienceRangeLabels[r.student.experienceYears as keyof typeof experienceRangeLabels][locale] : '—'}</td>
                <td className="p-3">
                  <StatusBadge status={r.status} locale={locale} />
                </td>
                <td className="p-3 whitespace-nowrap">{formatDate(r.createdAt, locale)}</td>
                <td className="p-3 text-xs">{r.ref ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) }, false)} />}
    </div>
  );
}
