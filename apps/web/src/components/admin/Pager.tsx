'use client';

import { useI18n } from '@/i18n/client';

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{t('admin.common.total', { count: total })}</span>
      <span className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-9 rounded-lg border border-line-strong px-3 disabled:opacity-50">
          {t('admin.common.prev')}
        </button>
        <span>{t('admin.common.page', { page, pages })}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="min-h-9 rounded-lg border border-line-strong px-3 disabled:opacity-50">
          {t('admin.common.next')}
        </button>
      </span>
    </nav>
  );
}
