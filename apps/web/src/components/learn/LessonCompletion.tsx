'use client';

import type { LearnSessionDto } from '@academy/shared';
import { Button } from '@/components/ui/Button';
import { IconCheck } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';

/** A self-paced lesson's status, with "Mark as complete" (or "Undo"). */
export function LessonCompletion({
  completion,
  busy,
  error,
  onChange,
}: {
  completion: LearnSessionDto['lessonCompletion'];
  busy: boolean;
  error: string | null;
  onChange: (completed: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {completion ? (
          <p role="status" className="flex items-center gap-2.5 font-medium text-success">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-logo-green text-white">
              <IconCheck size={12} strokeWidth={3.2} />
            </span>
            {t(completion === 'WATCHED' ? 'learn.lessonWatched' : 'learn.lessonMarked')}
          </p>
        ) : (
          <p className="min-w-0 flex-[1_1_16rem] text-[0.9375rem] text-muted">{t('learn.lessonHint')}</p>
        )}
        <Button type="button" variant={completion ? 'secondary' : 'primary'} size="sm" loading={busy} onClick={() => onChange(!completion)}>
          {t(completion ? 'learn.undoComplete' : 'learn.markComplete')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
