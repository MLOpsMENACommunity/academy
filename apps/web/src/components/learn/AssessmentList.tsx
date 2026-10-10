'use client';

import type { AssessmentState, AssessmentSummaryDto } from '@academy/shared';
import Link from 'next/link';
import { LocalTime } from '@/components/course/LocalTime';
import { Badge, type Tone } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';

export const stateTone: Record<AssessmentState, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  GRADED: 'success',
  MISSED: 'danger',
};

/** Score as "8/10", without trailing zeros. */
export function scoreText(score: number, max: number): string {
  return `${Number(score.toFixed(2))}/${max}`;
}

/**
 * The assessments of a session (or of the whole course) in the course player:
 * type, title, due date and the student's status (not started, submitted, graded with the score, late).
 */
export function AssessmentList({
  slug,
  items,
  headingId,
  title,
  level = 'h3',
}: {
  slug: string;
  items: AssessmentSummaryDto[];
  headingId: string;
  title: string;
  level?: 'h2' | 'h3';
}) {
  const { locale, t } = useI18n();
  if (!items.length) return null;
  const Heading = level;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Heading id={headingId} tabIndex={-1} className="text-base">
        {title}
      </Heading>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/${locale}/learn/${slug}/assessments/${a.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-hover-bg">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.type === 'QUIZ' ? 'primary' : 'accent'}>{t(`assessments.type.${a.type}`)}</Badge>
                  <span className="font-medium text-fg">{locale === 'ar' ? a.titleAr : a.titleEn}</span>
                </span>
                <span className="text-[0.8125rem] text-muted">
                  {a.dueAt ? (
                    <>
                      {t('assessments.due')}: <LocalTime iso={a.dueAt} style="weekday-datetime" />
                    </>
                  ) : (
                    t('assessments.noDue')
                  )}
                  {' · '}
                  {t('assessments.points', { count: a.maxPoints })}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {a.late && <Badge tone="warning">{t('assessments.late')}</Badge>}
                {a.state === 'GRADED' && a.score !== null ? (
                  <Badge tone={a.passed ? 'success' : 'warning'}>{scoreText(a.score, a.maxPoints)}</Badge>
                ) : (
                  <Badge tone={stateTone[a.state]}>{t(`assessments.state.${a.state}`)}</Badge>
                )}
                <span aria-hidden className="inline-block text-primary rtl:rotate-180">
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
