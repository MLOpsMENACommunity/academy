'use client';

import type { MyPointsDto, PointsEntryDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { badgeName, BadgeIcon } from './BadgeIcon';
import { entryText, signed } from './entry';

/** Profile → Points: every entry, newest first, with totals per course and the badges. */
export function PointsHistory() {
  const { locale, t } = useI18n();
  const [mine, setMine] = useState<MyPointsDto | null>(null);
  const [entries, setEntries] = useState<PointsEntryDto[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    Promise.all([api<MyPointsDto>('/me/points'), api<PointsEntryDto[]>('/me/points/history')])
      .then(([m, h]) => {
        setMine(m);
        setEntries(h);
      })
      .catch(() => setError(true));
  }, []);
  if (error) return <Alert tone="danger">{t('errors.generic')}</Alert>;
  if (!mine || !entries) return <p className="text-muted">{t('common.loading')}</p>;
  const week = (n: number) => t('leaderboard.weekN', { n });
  return (
    <div className="flex flex-col gap-6 rounded-card border border-line bg-card p-5 sm:p-8">
      <div>
        <h2 className="text-xl">{t('points.historyTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('points.historyHint')}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-muted-bg p-4">
          <dt className="text-sm text-muted">{t('points.totalLabel')}</dt>
          <dd className="text-2xl font-semibold">{mine.total}</dd>
        </div>
        {mine.courses.map((c) => (
          <div key={c.slug} className="rounded-xl bg-muted-bg p-4">
            <dt className="text-sm text-muted">{locale === 'ar' ? c.titleAr : c.titleEn}</dt>
            <dd className="text-2xl font-semibold">{c.points}</dd>
          </div>
        ))}
      </dl>
      {mine.badges.length > 0 && (
        <section aria-labelledby="my-badges">
          <h3 id="my-badges" className="text-base">
            {t('badges.title')}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {mine.badges.map((b) => (
              <li key={b.id} className="flex items-start gap-3">
                <BadgeIcon icon={b.badge.icon} name={badgeName(b.badge, locale)} />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-fg">{badgeName(b.badge, locale, b.period, week)}</span>
                  <span className="block text-muted">
                    {[locale === 'ar' ? b.badge.descriptionAr : b.badge.descriptionEn, b.course ? (locale === 'ar' ? b.course.titleAr : b.course.titleEn) : null, formatDate(b.awardedAt, locale)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="my-points">
        <h3 id="my-points" className="text-base">
          {t('points.entries')}
        </h3>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('points.empty')}</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-line-soft text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-fg">{entryText(e, locale, t)}</span>
                  <span className="block text-xs text-muted">
                    {[formatDate(e.createdAt, locale), e.course ? (locale === 'ar' ? e.course.titleAr : e.course.titleEn) : t('points.noCourse')].join(' · ')}
                  </span>
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${e.points < 0 ? 'text-danger' : 'text-success'}`} dir="ltr">
                  {signed(e.points, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
