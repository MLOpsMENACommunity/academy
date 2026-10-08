'use client';

import { Suspense, useEffect, useState } from 'react';
import { Pager } from '@/components/admin/Pager';
import { useQueryState } from '@/components/admin/query';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Row {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: string | null;
  metadata: unknown;
  createdAt: string;
}

const PAGE_SIZE = 50;

function AuditLog() {
  const { locale, t } = useI18n();
  const { params, query, set } = useQueryState();
  const [data, setData] = useState<{ total: number; page: number; items: Row[] } | null>(null);
  const [error, setError] = useState(false);
  const [action, setAction] = useState(params.action ?? '');
  useEffect(() => setAction(params.action ?? ''), [params.action]);

  useEffect(() => {
    let current = true;
    setError(false);
    api<typeof data>(`/admin/audit?${query}`)
      .then((d) => current && setData(d))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [query]);

  return (
    <div>
      <h1 className="text-3xl">{t('admin.audit.title')}</h1>
      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set({ action });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.audit.filterAction')}</span>
          <input
            type="search"
            dir="ltr"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="payment."
            className="block min-h-10 w-64 rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm"
          />
        </label>
        <button type="submit" className="min-h-10 rounded-lg border border-line-strong px-3 text-sm font-semibold">
          {t('admin.common.apply')}
        </button>
      </form>
      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted-bg text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{t('admin.audit.when')}</th>
              <th className="p-3 text-start">{t('admin.audit.actor')}</th>
              <th className="p-3 text-start">{t('admin.audit.action')}</th>
              <th className="p-3 text-start">{t('admin.audit.entity')}</th>
              <th className="p-3 text-start">{t('admin.audit.details')}</th>
            </tr>
          </thead>
          <tbody dir="ltr">
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  {t('admin.common.none')}
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap">{formatDateTime(r.createdAt, locale)}</td>
                <td className="p-3">{r.actor ?? t('admin.audit.system')}</td>
                <td className="p-3 font-mono text-xs">{r.action}</td>
                <td className="p-3 text-xs">
                  {r.entityType}
                  {r.entityId && <span className="block font-mono text-muted">{r.entityId}</span>}
                </td>
                <td className="max-w-xs p-3 font-mono text-xs break-all text-muted">
                  {r.metadata && Object.keys(r.metadata as object).length ? JSON.stringify(r.metadata) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set({ page: String(p) }, false)} />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
