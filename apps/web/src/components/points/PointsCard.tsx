'use client';

import type { MyPointsDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Arrow } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { badgeName, BadgeIcon } from './BadgeIcon';
import { entryText, signed } from './entry';

/** Dashboard: total points, the latest entries and every badge earned. */
export function PointsCard({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<MyPointsDto | null>(null);
  useEffect(() => {
    api<MyPointsDto>('/me/points').then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const week = (n: number) => t('leaderboard.weekN', { n });
  return (
    <section id="points" aria-labelledby="points-title" className={`flex scroll-mt-6 flex-col gap-4 p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="points-title" className="text-[0.8125rem] font-medium text-muted">
          {t('points.title')}
        </h2>
        <p className="text-2xl font-semibold text-fg" data-testid="points-total">
          {t('points.total', { count: data.total })}
        </p>
      </div>

      {data.badges.length > 0 ? (
        <ul aria-label={t('badges.title')} className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
          {data.badges.map((b) => (
            <li key={b.id} className="flex flex-col items-center gap-1 text-center">
              <BadgeIcon icon={b.badge.icon} name={badgeName(b.badge, locale, b.period, week)} />
              <span className="text-xs leading-tight text-body">{badgeName(b.badge, locale)}</span>
              {b.period ? <span className="text-[0.6875rem] text-muted">{week(b.period)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('badges.none')}</p>
      )}

      {data.recent.length > 0 ? (
        <ul aria-label={t('points.recent')} className="flex flex-col divide-y divide-line-soft text-sm">
          {data.recent.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-fg">{entryText(e, locale, t)}</span>
                <span className="block text-xs text-muted">{formatDate(e.createdAt, locale)}</span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${e.points < 0 ? 'text-danger' : 'text-success'}`} dir="ltr">
                {signed(e.points, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('points.empty')}</p>
      )}
      <Link href={`/${locale}/profile?tab=points`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary hover:underline">
        {t('points.history')} <Arrow />
      </Link>
    </section>
  );
}
