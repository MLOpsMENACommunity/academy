'use client';

import { googleCalendarLink, type AssessmentSummaryDto, type LearnCourseDto, type LearnSessionDto } from '@academy/shared';
import { useState } from 'react';
import { LocalTime } from '@/components/course/LocalTime';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { IconCheck } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { AssessmentList } from './AssessmentList';
import { DriveNote } from './DriveNote';
import { FeedbackForm } from './FeedbackForm';
import { YouTubeFacade } from './YouTubeFacade';

const rowLink = 'flex min-h-14 items-center justify-between gap-4 px-5 py-3.5 hover:bg-hover-bg';

/**
 * One session in the course player: the recording (or the live link), then the
 * title, "Mark as done", materials, the session's assessments, what it covers and the feedback form.
 */
export function SessionCard({
  course,
  session: s,
  onProgress,
  total,
  assessments = [],
}: {
  course: LearnCourseDto;
  session: LearnSessionDto;
  onProgress: (sessionId: string, completed: boolean) => void;
  /** Number of sessions in the course ("Session 2 of 6"). */
  total?: number;
  /** Published assessments attached to this session. */
  assessments?: AssessmentSummaryDto[];
}) {
  const { locale, t } = useI18n();
  const [completed, setCompleted] = useState(s.completed);
  const [actionError, setActionError] = useState<string | null>(null);
  const title = locale === 'ar' ? s.titleAr : s.titleEn;
  const desc = locale === 'ar' ? s.descriptionAr : s.descriptionEn;
  const courseTitle = locale === 'ar' ? course.titleAr : course.titleEn;
  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';

  async function toggle(next: boolean) {
    setCompleted(next);
    onProgress(s.id, next);
    setActionError(null);
    try {
      await api(`/learn/${course.slug}/sessions/${s.id}/progress`, { method: 'PUT', json: { completed: next } });
    } catch (err) {
      setCompleted(!next);
      onProgress(s.id, !next);
      setActionError(errorMessage(err, t));
    }
  }

  const hasMaterials = s.materials.length > 0 || Boolean(s.assignmentUrl);

  return (
    <article id={`session-${s.order}`} className="flex scroll-mt-6 flex-col gap-6" aria-labelledby={`session-${s.id}-title`}>
      {s.phase === 'ended' &&
        (!s.recording ? (
          <div className="grid aspect-video place-items-center rounded-xl bg-muted-bg p-6 text-center text-muted">{t('learn.noRecording')}</div>
        ) : s.recording.kind === 'youtube' && s.recording.youtubeId ? (
          <div className="flex flex-col gap-2">
            <YouTubeFacade id={s.recording.youtubeId} title={title} />
            <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center self-start text-sm text-primary underline">
              {t('learn.watchOnYoutube')}
            </a>
          </div>
        ) : s.recording.kind === 'drive' ? (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-muted-bg p-6">
            <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md')}>
              {t('learn.openDrive')}
            </a>
            <DriveNote course={course} />
          </div>
        ) : (
          <div className="rounded-xl bg-muted-bg p-6">
            <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
              {t('learn.recording')}
            </a>
          </div>
        ))}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {total ? t('learn.sessionOf', { n: s.order, total }) : t('learn.session', { n: s.order })}
            <Badge tone={s.phase === 'live' ? 'danger' : s.phase === 'upcoming' ? 'info' : 'neutral'}>{t(`learn.${s.phase}`)}</Badge>
          </p>
          <h2 id={`session-${s.id}-title`} className="text-[1.5rem] leading-snug sm:text-[1.75rem]">
            {title}
          </h2>
          <p className="text-[0.9375rem] text-muted">
            <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
          </p>
        </div>
        {s.phase !== 'upcoming' && (
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-4 text-[0.9375rem] font-medium ${
              completed ? 'border-success/40 bg-success-soft text-success' : 'border-line-button bg-card text-fg hover:bg-hover-bg'
            }`}
          >
            <input type="checkbox" checked={completed} onChange={(e) => toggle(e.target.checked)} className="size-5 accent-[var(--success)]" />
            {completed ? (
              <span className="inline-flex items-center gap-1.5">
                <IconCheck size={16} />
                {t('learn.done')}
              </span>
            ) : (
              t('learn.markDone')
            )}
          </label>
        )}
      </div>

      {s.phase !== 'ended' &&
        (s.liveUrl ? (
          <a href={s.liveUrl} target="_blank" rel="noopener noreferrer" className={buttonClass(s.phase === 'live' ? 'danger' : 'primary', 'lg', 'self-start')}>
            {t('learn.join')}
          </a>
        ) : (
          <p className="rounded-xl bg-muted-bg p-4 text-[0.9375rem] text-muted">{t('learn.linkAt', { minutes: course.liveLinkRevealMinutes })}</p>
        ))}

      {(hasMaterials || s.phase === 'upcoming') && (
        <section aria-labelledby={`session-${s.id}-materials`} className="flex flex-col gap-3">
          <h3 id={`session-${s.id}-materials`} className="text-base">
            {t('learn.materials')}
          </h3>
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
            {s.materials.map((m) => (
              <li key={m.url}>
                <a href={m.url} target="_blank" rel="noopener noreferrer" className={rowLink}>
                  <span className="font-medium text-fg">{locale === 'ar' ? m.labelAr : m.labelEn}</span>
                  <span aria-hidden className="text-primary">
                    ↗
                  </span>
                </a>
              </li>
            ))}
            {s.assignmentUrl && (
              <li>
                <a href={s.assignmentUrl} target="_blank" rel="noopener noreferrer" className={rowLink}>
                  <span className="font-medium text-accent">{t('learn.assignment')}</span>
                  <span aria-hidden className="text-primary">
                    ↗
                  </span>
                </a>
              </li>
            )}
            {s.phase === 'upcoming' && (
              <>
                <li>
                  <button
                    type="button"
                    className={`${rowLink} w-full text-start`}
                    onClick={() => {
                      setActionError(null);
                      downloadViaApi(`/learn/${course.slug}/sessions/${s.id}/calendar.ics`, `${course.slug}-${s.order}.ics`).catch((err: unknown) => setActionError(errorMessage(err, t)));
                    }}
                  >
                    <span className="font-medium text-fg">{t('learn.downloadIcs')}</span>
                    <span aria-hidden className="text-primary">
                      +
                    </span>
                  </button>
                </li>
                <li>
                  <a
                    href={googleCalendarLink({
                      title: `${courseTitle}: ${title}`,
                      start: s.startsAt,
                      end: new Date(new Date(s.startsAt).getTime() + s.durationMin * 60_000),
                      details: pageUrl,
                      location: pageUrl ? `${pageUrl}#session-${s.order}` : undefined,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={rowLink}
                  >
                    <span className="font-medium text-fg">{t('learn.googleCalendar')}</span>
                    <span aria-hidden className="text-primary">
                      ↗
                    </span>
                  </a>
                </li>
              </>
            )}
          </ul>
        </section>
      )}

      <AssessmentList slug={course.slug} items={assessments} headingId={`session-${s.id}-assessments`} title={t('assessments.sessionTitle')} />

      {desc && (
        <section aria-labelledby={`session-${s.id}-about`} className="flex flex-col gap-2">
          <h3 id={`session-${s.id}-about`} className="text-base">
            {t('learn.about')}
          </h3>
          <p className="leading-relaxed whitespace-pre-line text-body">{desc}</p>
        </section>
      )}

      {s.phase !== 'upcoming' && (
        <section className="rounded-xl border border-line p-5">
          <FeedbackForm slug={course.slug} sessionId={s.id} legend={t('learn.feedbackTitle')} initial={s.myFeedback} />
        </section>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}
    </article>
  );
}
