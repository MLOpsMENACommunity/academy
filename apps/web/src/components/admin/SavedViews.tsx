'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

interface View {
  id: string;
  name: string;
  filters: { query?: string };
}

/** Admin-specific saved filter views (e.g. "Senior MLOps in KSA/Egypt"). */
export function SavedViews({ scope, query, onApply }: { scope: 'APPLICATIONS' | 'STUDENTS'; query: string; onApply: (q: string) => void }) {
  const { t } = useI18n();
  const [views, setViews] = useState<View[]>([]);
  const [name, setName] = useState('');
  const load = useCallback(() => {
    api<View[]>(`/admin/saved-filters?scope=${scope}`).then(setViews).catch(() => setViews([]));
  }, [scope]);
  useEffect(load, [load]);
  const clean = query.replace(/(^|&)page=\d+/, '');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.common.savedViews')}</span>
        <select
          className="min-h-10 rounded-lg border border-line-strong bg-card px-2 text-sm"
          value=""
          onChange={(e) => {
            const v = views.find((x) => x.id === e.target.value);
            if (v) onApply(v.filters.query ?? '');
          }}
        >
          <option value="">—</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await api('/admin/saved-filters', { method: 'POST', json: { scope, name: name.trim(), query: clean } });
          setName('');
          load();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.common.viewName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-h-10 rounded-lg border border-line-strong bg-card px-2 text-sm" />
        </label>
        <button type="submit" disabled={!name.trim()} className="min-h-10 rounded-lg border border-line-strong px-3 text-sm font-semibold disabled:opacity-50">
          {t('admin.common.saveView')}
        </button>
      </form>
      {views.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{t('admin.common.delete')}…</summary>
          <ul className="mt-1 space-y-1">
            {views.map((v) => (
              <li key={v.id}>
                <button type="button" className="text-danger underline" onClick={() => api(`/admin/saved-filters/${v.id}`, { method: 'DELETE' }).then(load)}>
                  {v.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
