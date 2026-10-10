'use client';

import type { QuizReviewDto } from '@academy/shared';
import { Badge } from '@/components/ui/Badge';
import { IconCheck, IconClose } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';

/** The answer key for one attempt: the student's choices, the right ones and why. */
export function QuizReview({ review }: { review: QuizReviewDto }) {
  const { locale, t } = useI18n();
  const ar = locale === 'ar';
  return (
    <section aria-labelledby="quiz-review" className="flex flex-col gap-3">
      <h2 id="quiz-review" className="text-lg">
        {t('assessments.result.reviewTitle')} · {t('assessments.result.attempt', { n: review.attempt })}
      </h2>
      <ol className="flex flex-col gap-3">
        {review.questions.map((q, i) => {
          const explanation = (ar && q.explanationAr) || q.explanationEn;
          return (
            <li key={q.id} className={`rounded-xl border bg-card p-4 sm:p-5 ${q.correct ? 'border-success/40' : 'border-danger/40'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[0.8125rem] text-muted">{t('assessments.player.questionOf', { n: i + 1, total: review.questions.length })}</p>
                <Badge tone={q.correct ? 'success' : 'danger'}>{q.correct ? t('assessments.result.correct') : t('assessments.result.incorrect')}</Badge>
              </div>
              <p className="mt-1 font-semibold whitespace-pre-line text-fg">{(ar && q.promptAr) || q.promptEn}</p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {q.options.map((o) => (
                  <li
                    key={o.id}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[0.9375rem] ${
                      o.correct ? 'border-success/40 bg-success-soft' : o.chosen ? 'border-danger/40 bg-danger-soft' : 'border-line'
                    }`}
                  >
                    <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${o.correct ? 'bg-success text-white' : o.chosen ? 'bg-danger text-white' : 'border border-line-strong'}`}>
                      {o.correct ? <IconCheck size={12} strokeWidth={3} /> : o.chosen ? <IconClose size={12} strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-line">{(ar && o.labelAr) || o.labelEn}</span>
                    <span className="flex shrink-0 flex-wrap gap-1 text-xs font-medium">
                      {o.chosen && <span className="text-fg">{t('assessments.result.yourChoice')}</span>}
                      {o.correct && <span className="text-success">{t('assessments.result.rightAnswer')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {explanation && (
                <p className="mt-3 rounded-lg bg-muted-bg p-3 text-[0.9375rem] whitespace-pre-line text-body">
                  <span className="font-semibold text-fg">{t('assessments.result.explanation')}: </span>
                  {explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
