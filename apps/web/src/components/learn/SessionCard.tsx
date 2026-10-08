'use client';

import { googleCalendarUrl, type LearnCourseDto, type LearnSessionDto } from '@academy/shared';
import { useState } from 'react';
import { LocalTime } from '@/components/course/LocalTime';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { FeedbackForm } from './FeedbackForm';
import { YouTubeFacade } from './YouTubeFacade';

export function SessionCard({
  course,
  session: s,
  onProgress,
}: {
  course: LearnCourseDto;
  session: LearnSessionDto;
  onProgress: (sessionId: string, completed: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const [completed, setCompleted] = useState(s.completed);
  const title = locale === 'ar' ? s.titleAr : s.titleEn;
  const desc = locale === 'ar' ? s.descriptionAr : s.descriptionEn;
  const courseTitle = locale === 'ar' ? course.titleAr : course.titleEn;
  const pageUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0]! : '';

  async function toggle(next: boolean) {
    setCompleted(next);
    onProgress(s.id, next);
    try {
      await api(`/learn/${course.slug}/sessions/${s.id}/progress`, { method: 'PUT', json: { completed: next } });
    } catch {
      setCompleted(!next);
      onProgress(s.id, !next);
    }
  }

  return (
    <article id={`session-${s.order}`} className="rounded-card border border-line bg-card p-5 sm:p-6" aria-labelledby={`session-${s.id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-primary">{t('learn.session', { n: s.order })}</p>
          <h3 id={`session-${s.id}-title`} className="text-lg">
            {title}
          </h3>
          <p className="mt-1 text-sm text-body">
            <LocalTime iso={s.startsAt} style="weekday-datetime" /> · {t('course.minutes', { count: s.durationMin })}
          </p>
        </div>
        <Badge tone={s.phase === 'live' ? 'danger' : s.phase === 'upcoming' ? 'info' : 'neutral'}>{t(`learn.${s.phase}`)}</Badge>
      </div>
      {desc && <p className="mt-3 text-sm">{desc}</p>}

      {s.phase !== 'ended' &&
        (s.liveUrl ? (
          <a href={s.liveUrl} target="_blank" rel="noopener noreferrer" className={buttonClass(s.phase === 'live' ? 'danger' : 'accent', 'lg', 'mt-4')}>
            {t('learn.join')}
          </a>
        ) : (
          <p className="mt-4 rounded-lg bg-muted-bg p-3 text-sm text-muted">{t('learn.linkAt', { minutes: course.liveLinkRevealMinutes })}</p>
        ))}

      {s.phase === 'upcoming' && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <a href={`/api/learn/${course.slug}/sessions/${s.id}/calendar.ics`} className="text-primary underline" download>
            {t('learn.downloadIcs')}
          </a>
          <span aria-hidden>·</span>
          <a
            href={googleCalendarUrl({ title: `${courseTitle}: ${title}`, startsAt: s.startsAt, durationMin: s.durationMin, details: pageUrl })}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {t('learn.googleCalendar')}
          </a>
        </div>
      )}

      {s.phase === 'ended' && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-fg">{t('learn.recording')}</h4>
          {!s.recording ? (
            <p className="mt-1 text-sm text-muted">{t('learn.noRecording')}</p>
          ) : s.recording.kind === 'youtube' && s.recording.youtubeId ? (
            <div className="mt-2 space-y-2">
              <YouTubeFacade id={s.recording.youtubeId} title={title} />
              <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                {t('learn.watchOnYoutube')}
              </a>
            </div>
          ) : s.recording.kind === 'drive' ? (
            <div className="mt-2 space-y-2">
              <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md')}>
                {t('learn.openDrive')}
              </a>
              <Alert tone="info">{course.googleEmail ? t('learn.driveNote', { email: course.googleEmail }) : t('learn.driveNoEmail')}</Alert>
            </div>
          ) : (
            <a href={s.recording.url} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', 'mt-2')}>
              {t('learn.recording')}
            </a>
          )}
        </div>
      )}

      {(s.materials.length > 0 || s.assignmentUrl) && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {s.materials.map((m) => (
            <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {locale === 'ar' ? m.labelAr : m.labelEn}
            </a>
          ))}
          {s.assignmentUrl && (
            <a href={s.assignmentUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
              {t('learn.assignment')}
            </a>
          )}
        </div>
      )}

      {s.phase !== 'upcoming' && (
        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-fg">
            <input type="checkbox" checked={completed} onChange={(e) => toggle(e.target.checked)} className="size-5 accent-[var(--brand-primary)]" />
            {completed ? t('learn.done') : t('learn.markDone')}
          </label>
          <FeedbackForm slug={course.slug} sessionId={s.id} legend={t('learn.feedbackTitle')} initial={s.myFeedback} />
        </div>
      )}
    </article>
  );
}
