'use client';

import type { TeachRosterStudentDto } from '@academy/shared';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

/** Teaching → {course} → Roster (VIEW_ROSTER): the enrolled students and how to reach them. */
export function TeachRoster({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const r = (k: string, v?: Record<string, string | number>) => t(`teach.roster.${k}`, v);
  const [rows, setRows] = useState<TeachRosterStudentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api<TeachRosterStudentDto[]>(`/teach/courses/${courseId}/roster`)
      .then(setRows)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [courseId, t]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows || !needle) return rows;
    return rows.filter((x) => [x.name, x.nameAr, x.email, x.telegram, x.discord].some((v) => v?.toLowerCase().includes(needle)));
  }, [rows, q]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows || !shown) return <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <section aria-labelledby="roster-h" className="space-y-4">
      <div>
        <h2 id="roster-h" className="text-xl">
          {r('title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{r('intro')}</p>
      </div>
      <label className="block max-w-sm">
        <span className="mb-1 block text-xs font-semibold text-fg">{r('search')}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="block min-h-11 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm" />
      </label>
      <p className="text-sm text-muted" aria-live="polite">
        {r('count', { count: shown.length })}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{r('none')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-card">
          {shown.map((x) => (
            <li key={x.userId} className="grid gap-1 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold break-words text-fg" dir="auto">
                  {(locale === 'ar' && x.nameAr) || x.name || '—'}
                </p>
                <p className="text-sm break-all text-muted" dir="ltr">
                  <a href={`mailto:${x.email}`} className="hover:underline">
                    {x.email}
                  </a>
                </p>
              </div>
              <p className="text-sm text-body">
                {x.telegram || x.discord ? (
                  <>
                    {x.telegram && <span className="me-3">Telegram: <span dir="ltr">{x.telegram}</span></span>}
                    {x.discord && <span>Discord: <span dir="ltr">{x.discord}</span></span>}
                  </>
                ) : (
                  <span className="text-muted">{r('noCommunity')}</span>
                )}
              </p>
              <p className="text-xs text-muted">{r('enrolled', { date: formatDate(x.enrolledAt, locale) })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
