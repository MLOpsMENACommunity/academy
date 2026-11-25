'use client';

import type { TopicScore } from '@academy/shared';
import { useI18n } from '@/i18n/client';

/**
 * One attempt's score per topic (in question weights), with the overall row: a real table with
 * a caption. The bars only repeat the percentage that is written next to them.
 */
export function TopicScores({ topics, attempt }: { topics: TopicScore[]; attempt: number }) {
  const { t } = useI18n();
  const r = (k: string, v?: Record<string, string | number>) => t(`assessments.result.${k}`, v);
  const earned = topics.reduce((n, x) => n + x.earned, 0);
  const possible = topics.reduce((n, x) => n + x.possible, 0);
  const overall = possible ? Math.round((earned / possible) * 1000) / 10 : 0;
  const bar = (percent: number) => (
    <span aria-hidden className="block h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-muted-bg">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-start text-[0.9375rem]">
        <caption className="px-4 pt-4 pb-2 text-start text-base font-semibold text-fg sm:px-5">{r('topicsCaption', { n: attempt })}</caption>
        <thead>
          <tr className="border-b border-line text-[0.8125rem] text-muted">
            <th scope="col" className="px-4 py-2 text-start font-medium sm:px-5">
              {r('topic')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {r('topicScore')}
            </th>
            <th scope="col" className="w-2/5 px-4 py-2 text-start font-medium sm:px-5">
              {r('topicPercent')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {topics.map((x) => (
            <tr key={x.topic ?? ''}>
              <th scope="row" className="px-4 py-2.5 text-start font-medium text-fg sm:px-5">
                <span dir="auto">{x.topic ?? r('general')}</span>
              </th>
              <td className="px-2 py-2.5 whitespace-nowrap tabular-nums">{r('weightOf', { earned: x.earned, possible: x.possible })}</td>
              <td className="px-4 py-2.5 sm:px-5">
                <span className="flex items-center gap-2">
                  <span className="w-14 shrink-0 tabular-nums">{t('assessments.percent', { percent: x.percent })}</span>
                  {bar(x.percent)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold text-fg">
            <th scope="row" className="px-4 py-2.5 text-start sm:px-5">
              {r('overall')}
            </th>
            <td className="px-2 py-2.5 whitespace-nowrap tabular-nums">{r('weightOf', { earned, possible })}</td>
            <td className="px-4 py-2.5 sm:px-5">
              <span className="flex items-center gap-2">
                <span className="w-14 shrink-0 tabular-nums">{t('assessments.percent', { percent: overall })}</span>
                {bar(overall)}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
