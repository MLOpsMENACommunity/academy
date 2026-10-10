'use client';

import type { LeaderboardDto, LeaderboardScope } from '@academy/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckboxField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { badgeName, BadgeIcon } from './BadgeIcon';

/**
 * The course leaderboard on the learn page: this week's best or the whole course (the
 * final "Best of the course" once it ends), top 10 of the students who opted in, plus
 * the student's own standing (shown only to them) and the opt-in switch.
 */
export function Leaderboard({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const weekSelect = useId();
  const [scope, setScope] = useState<LeaderboardScope>('week');
  const [week, setWeek] = useState<number | null>(null);
  const [data, setData] = useState<LeaderboardDto | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const firstLoad = useRef(true);
  /** Only the newest request may update the board (quick scope or week switches). */
  const latest = useRef(0);

  const load = useCallback(() => {
    const q = new URLSearchParams({ scope });
    if (scope === 'week' && week) q.set('week', String(week));
    const id = ++latest.current;
    api<LeaderboardDto>(`/learn/${slug}/leaderboard?${q}`)
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setError(false);
        // After the course, open on the course board ("Best of the course").
        if (firstLoad.current && d.courseEnded) setScope('course');
        firstLoad.current = false;
      })
      .catch(() => id === latest.current && setError(true));
  }, [slug, scope, week]);
  useEffect(load, [load]);

  if (error) return <Alert tone="danger">{t('errors.generic')}</Alert>;
  if (!data) return <p className="text-muted">{t('common.loading')}</p>;

  const notStarted = data.weeks.available === 0;
  const courseLabel = data.courseEnded ? t('leaderboard.bestOfCourse') : t('leaderboard.wholeCourse');
  const weekLabel = (n: number) => t('leaderboard.weekN', { n });
  const range =
    data.scope === 'week' && data.weeks.start && data.weeks.end
      ? t('leaderboard.range', { from: formatDate(data.weeks.start, locale), to: formatDate(new Date(new Date(data.weeks.end).getTime() - 1), locale) })
      : null;

  const toggle = async (optedIn: boolean) => {
    setSaving(true);
    setMsg(null);
    // Optimistic: the switch moves at once; the board reloads after the save.
    setData((d) => (d?.me ? { ...d, me: { ...d.me, optedIn } } : d));
    try {
      await api(`/learn/${slug}/leaderboard/opt-in`, { method: 'PUT', json: { optedIn } });
      setMsg({ ok: true, text: t(optedIn ? 'leaderboard.optedIn' : 'leaderboard.optedOut') });
      load();
    } catch {
      setData((d) => (d?.me ? { ...d, me: { ...d.me, optedIn: !optedIn } } : d));
      setMsg({ ok: false, text: t('errors.generic') });
    } finally {
      setSaving(false);
    }
  };

  const me = data.me;
  return (
    <section aria-labelledby="leaderboard-title" className="flex flex-col gap-4 rounded-xl border border-line p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="leaderboard-title" tabIndex={-1} className="text-xl">
          {t('leaderboard.title')}
        </h2>
        <div role="group" aria-label={t('leaderboard.view')} className="inline-flex rounded-lg border border-line-button p-0.5">
          {(['week', 'course'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`min-h-10 rounded-md px-3 text-sm font-medium ${scope === s ? 'bg-primary-soft text-primary' : 'text-muted hover:text-fg'}`}
            >
              {s === 'week' ? t('leaderboard.thisWeek') : courseLabel}
            </button>
          ))}
        </div>
      </div>

      {scope === 'week' && data.weeks.available > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
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
          {range && <span className="text-muted">{range}</span>}
        </div>
      )}

      {notStarted ? (
        <p className="text-muted">{t('leaderboard.notStarted')}</p>
      ) : data.rows.length === 0 ? (
        <p className="text-muted">{t('leaderboard.empty')}</p>
      ) : (
        <ol aria-label={data.scope === 'week' && data.week ? weekLabel(data.week) : courseLabel} className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
          {data.rows.map((r, i) => (
            <li key={i} className={`flex min-h-12 items-center gap-3 px-4 py-2.5 ${r.me ? 'bg-primary-soft' : ''}`} aria-current={r.me ? 'true' : undefined}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${r.rank <= 3 ? 'bg-cta text-cta-text' : 'bg-muted-bg text-body'}`}>
                <span className="sr-only">{t('leaderboard.rank')} </span>
                {r.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">
                  <bdi>{r.name}</bdi>
                  {r.me && <span className="ms-2 text-xs font-normal text-primary">{t('leaderboard.you')}</span>}
                </span>
                {r.badges.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.badges.slice(0, 6).map((b, j) => (
                      <BadgeIcon key={j} size="sm" icon={b.icon} name={badgeName(b, locale, b.period, weekLabel)} />
                    ))}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-fg">{t('points.total', { count: r.points })}</span>
            </li>
          ))}
        </ol>
      )}

      {me && (
        <p className="rounded-lg bg-muted-bg px-4 py-3 text-sm text-body" data-testid="my-rank">
          {me.points <= 0
            ? t('leaderboard.meNoPoints')
            : me.optedIn
              ? t('leaderboard.meRank', { rank: me.rank ?? '–', count: me.points })
              : t('leaderboard.meHidden', { rank: me.rank ?? '–', count: me.points })}
        </p>
      )}

      {me && (
        <div>
          <CheckboxField label={t('leaderboard.optIn')} hint={t('leaderboard.optInHint')} checked={me.optedIn} onChange={(v) => !saving && void toggle(v)} />
          <p role="status" className={`ms-8 text-xs ${msg?.ok ? 'text-success' : 'text-danger'}`}>
            {msg?.text}
          </p>
        </div>
      )}

      <p className="text-xs text-muted">{t('leaderboard.participants', { count: data.participants, total: data.total })}</p>
    </section>
  );
}
