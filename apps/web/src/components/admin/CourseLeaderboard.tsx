'use client';

import type { AdminLeaderboardDto, LeaderboardScope } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

/** Admin → Course → Leaderboard: everyone enrolled, ranked, with who is on the public board. */
export function CourseLeaderboard({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const weekSelect = useId();
  const [scope, setScope] = useState<LeaderboardScope>('course');
  const [week, setWeek] = useState<number | null>(null);
  const [data, setData] = useState<AdminLeaderboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = () => {
    const q = new URLSearchParams({ scope });
    if (scope === 'week' && week) q.set('week', String(week));
    return q.toString();
  };
  useEffect(() => {
    let current = true;
    setError(null);
    api<AdminLeaderboardDto>(`/admin/courses/${courseId}/leaderboard?${query()}`)
      .then((d) => current && setData(d))
      .catch((e: unknown) => current && setError(errorMessage(e, t)));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, scope, week, t]);

  const a = (k: string, v?: Record<string, string | number>) => t(`admin.points.${k}`, v);
  // Before anything loaded, the error is all there is; afterwards it shows above the controls.
  if (!data) return error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;
  const weekLabel = (n: number) => t('leaderboard.weekN', { n });

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="max-w-3xl text-sm text-muted">{a('boardHint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('leaderboard.view')} className="inline-flex rounded-lg border border-line-button p-0.5">
          {(['week', 'course'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`min-h-10 rounded-md px-3 text-sm font-medium ${scope === s ? 'bg-primary-soft text-primary' : 'text-muted hover:text-fg'}`}
            >
              {s === 'week' ? t('leaderboard.thisWeek') : data.courseEnded ? t('leaderboard.bestOfCourse') : t('leaderboard.wholeCourse')}
            </button>
          ))}
        </div>
        {scope === 'week' && data.weeks.available > 0 && (
          <span className="flex items-center gap-2 text-sm">
            <label htmlFor={weekSelect} className="text-muted">
              {t('leaderboard.week')}
            </label>
            <select id={weekSelect} className={`${inputClass} w-auto min-w-36`} value={data.week ?? ''} onChange={(e) => setWeek(Number(e.target.value))}>
              {Array.from({ length: data.weeks.available }, (_, i) => i + 1)
                .reverse()
                .map((n) => (
                  <option key={n} value={n}>
                    {n === data.weeks.current ? t('leaderboard.weekNow', { n }) : weekLabel(n)}
                  </option>
                ))}
            </select>
            {data.weeks.start && data.weeks.end && (
              <span className="text-muted">
                {t('leaderboard.range', { from: formatDate(data.weeks.start, locale), to: formatDate(new Date(new Date(data.weeks.end).getTime() - 1), locale) })}
              </span>
            )}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="ms-auto"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadViaApi(`/admin/courses/${courseId}/leaderboard.csv?${query()}`, `leaderboard-${scope}${scope === 'week' && data.week ? `-week-${data.week}` : ''}.csv`);
            } catch (e) {
              setError(errorMessage(e, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          {a('csv')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('leaderboard.participants', { count: data.participants, total: data.total })}</p>
      {scope === 'week' && data.weeks.available === 0 ? (
        <p className="text-muted">{t('leaderboard.notStarted')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted-bg text-start text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('leaderboard.rank')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{a('student')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{a('points')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{a('onBoard')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('badges.title')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {data.rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2 font-semibold tabular-nums">{r.rank ?? '–'}</td>
                  <td className="px-3 py-2">
                    <Link href={`/${locale}/admin/students/${r.userId}?course=${encodeURIComponent(courseId)}#points`} className="text-primary underline">
                      <bdi>{r.name ?? r.email}</bdi>
                    </Link>
                    <span className="block text-xs text-muted ltr-embed">{r.email}</span>
                  </td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums">{r.points}</td>
                  <td className="px-3 py-2">{r.optedIn ? <Badge tone="success">{a('shown')}</Badge> : <Badge>{a('hidden')}</Badge>}</td>
                  <td className="px-3 py-2 text-xs text-body">{r.badges.join(', ') || '–'}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted">{t('admin.common.none')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
