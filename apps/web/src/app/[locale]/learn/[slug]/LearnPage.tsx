'use client';

import type { LearnCourseDto, LearnSessionDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { LocalTime } from '@/components/course/LocalTime';
import { CheckboxField } from '@/components/forms/fields';
import { CalendarMenu } from '@/components/learn/CalendarMenu';
import { FeedbackForm } from '@/components/learn/FeedbackForm';
import { CourseAnnouncements } from '@/components/learn/Announcements';
import { DriveNote } from '@/components/learn/DriveNote';
import { SessionCard } from '@/components/learn/SessionCard';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Arrow, IconCheck } from '@/components/ui/Icons';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

export function LearnPage() {
  return <RequireAuth>{() => <Inner />}</RequireAuth>;
}

/** Where a student lands: a live session, then one whose join link is open, then the first unwatched recording, then the next upcoming one. */
function defaultSession(sessions: LearnSessionDto[]): number | null {
  const sorted = [...sessions].sort((a, b) => a.order - b.order);
  const pick =
    sorted.find((s) => s.phase === 'live') ??
    sorted.find((s) => s.phase === 'upcoming' && s.liveUrl) ??
    sorted.find((s) => s.phase === 'ended' && !s.completed) ??
    sorted.find((s) => s.phase === 'upcoming') ??
    sorted[sorted.length - 1];
  return pick?.order ?? null;
}

const hashOrder = () => {
  const m = /^#session-(\d+)$/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
};

function Inner() {
  const { locale, t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const [course, setCourse] = useState<LearnCourseDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);
  const [reminderMsg, setReminderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const main = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<LearnCourseDto>(`/learn/${slug}`)
      .then(setCourse)
      .catch((e: unknown) => setError(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'forbidden' : 'generic'));
  }, [slug]);
  useEffect(load, [load]);

  // Live links unlock and sessions start/end over time: refresh at the next such moment,
  // and whenever the student comes back to the tab.
  const nextBoundary = useMemo(() => {
    if (!course) return null;
    const now = Date.now();
    const times = course.sessions.flatMap((s) => {
      const start = new Date(s.startsAt).getTime();
      return [new Date(s.liveLinkAt).getTime(), start, start + s.durationMin * 60_000];
    });
    const future = times.filter((x) => x > now);
    return future.length ? Math.min(...future) : null;
  }, [course]);
  useEffect(() => {
    if (!nextBoundary) return;
    const delay = Math.min(Math.max(nextBoundary - Date.now() + 1000, 1000), 2_147_000_000);
    const id = setTimeout(load, delay);
    return () => clearTimeout(id);
  }, [nextBoundary, load]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // The open session follows the URL hash (#session-3), so deep links, reminders and Back work.
  const initialised = useRef(false);
  useEffect(() => {
    if (!course || initialised.current) return;
    initialised.current = true;
    const fromHash = hashOrder();
    setSelected(fromHash && course.sessions.some((s) => s.order === fromHash) ? fromHash : defaultSession(course.sessions));
    if (window.location.hash === '#reminders') requestAnimationFrame(() => document.getElementById('reminders')?.scrollIntoView({ block: 'start' }));
  }, [course]);
  useEffect(() => {
    const onHash = () => {
      const n = hashOrder();
      if (n) setSelected(n);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (error) {
    return (
      <Container className="py-12">
        <Alert tone={error === 'forbidden' ? 'info' : 'danger'}>
          {error === 'forbidden' ? t('learn.notEnrolled') : t('errors.generic')}{' '}
          <Link href={`/${locale}/courses/${slug}`} className="font-semibold underline">
            {t('applications.viewCourse')}
          </Link>
        </Alert>
      </Container>
    );
  }
  if (!course) return <PageSpinner />;

  const title = locale === 'ar' ? course.titleAr : course.titleEn;
  const sessions = [...course.sessions].sort((a, b) => a.order - b.order);
  // A stale or hand-edited #session-N that matches nothing falls back to the default session.
  const current = sessions.find((s) => s.order === selected) ?? sessions.find((s) => s.order === defaultSession(sessions)) ?? null;
  const index = current ? sessions.indexOf(current) : -1;
  const prev = index > 0 ? sessions[index - 1] : null;
  const next = index >= 0 && index < sessions.length - 1 ? sessions[index + 1] : null;
  const onProgress = (id: string, completed: boolean) =>
    setCourse((c) => {
      if (!c) return c;
      const list = c.sessions.map((s) => (s.id === id ? { ...s, completed } : s));
      const done = list.filter((s) => s.completed).length;
      return { ...c, sessions: list, progress: { completed: done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 } };
    });
  const ended = sessions.length > 0 && sessions.every((s) => s.phase === 'ended');
  const sessionTitle = (s: LearnSessionDto) => (locale === 'ar' ? s.titleAr : s.titleEn);
  const go = (s: LearnSessionDto) => {
    setSelected(s.order);
    window.history.replaceState(null, '', `#session-${s.order}`);
    if (window.matchMedia('(max-width: 63.99rem)').matches) main.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div>
      <div className="border-b border-line bg-card">
        <Container className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3">
          <h1 className="min-w-0 flex-[1_1_16rem] text-lg leading-snug sm:text-xl">{title}</h1>
          <div className="flex items-center gap-3 text-sm text-body">
            <div
              role="progressbar"
              aria-label={t('paths.courseProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={course.progress.percent}
              className="h-1.5 w-28 overflow-hidden rounded-full bg-track sm:w-40"
            >
              <div className="h-full rounded-full bg-logo-cyan transition-[width]" style={{ width: `${course.progress.percent}%` }} />
            </div>
            {t('learn.percentDone', { percent: course.progress.percent })}
          </div>
          <Link href={`/${locale}/dashboard`} className={buttonClass('secondary', 'sm')}>
            {t('learn.exit')}
          </Link>
        </Container>
      </div>

      <div className="mx-auto flex w-full max-w-[90rem] flex-col lg:min-h-[calc(100dvh-8rem)] lg:flex-row">
        <nav aria-labelledby="curriculum" className="order-last flex flex-col gap-4 border-t border-line bg-muted-bg px-4 py-6 sm:px-6 lg:order-first lg:w-[22rem] lg:shrink-0 lg:border-e lg:border-t-0 lg:px-4 lg:py-6">
          <div className="flex items-baseline justify-between gap-3 px-2">
            <h2 id="curriculum" className="text-base">
              {t('learn.content')}
            </h2>
            <span className="text-[0.8125rem] text-muted">{t('learn.progress', { completed: course.progress.completed, total: course.progress.total })}</span>
          </div>
          <ol className="overflow-hidden rounded-xl border border-line bg-card">
            {sessions.map((s) => {
              const active = s.order === current?.order;
              return (
                <li key={s.id} className="border-b border-line-soft last:border-0">
                  <a
                    href={`#session-${s.order}`}
                    aria-current={active ? 'step' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      go(s);
                    }}
                    className={`flex min-h-12 gap-3 px-4 py-3 text-[0.9375rem] hover:bg-hover-bg ${active ? 'bg-primary-soft font-medium text-fg hover:bg-primary-soft' : 'text-body'}`}
                  >
                    {s.completed ? (
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-logo-green text-white">
                        <IconCheck size={12} strokeWidth={3.2} />
                        <span className="sr-only">{t('learn.done')}</span>
                      </span>
                    ) : (
                      <span aria-hidden className={`mt-0.5 size-5 shrink-0 rounded-full bg-card ${active ? 'border-[3px] border-logo-cyan' : 'border-2 border-line-button'}`} />
                    )}
                    <span className="min-w-0">
                      <span className="block">
                        {s.order}. {sessionTitle(s)}
                      </span>
                      <span className={`block text-[0.8125rem] font-normal ${s.phase === 'live' ? 'text-danger' : 'text-muted'}`}>
                        {s.phase === 'live' ? t('learn.live') : <LocalTime iso={s.startsAt} style="date" />}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>

          <section aria-labelledby="course-tools" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
            <h2 id="course-tools" className="text-sm font-medium text-muted">
              {t('learn.tools')}
            </h2>
            <div className="flex flex-col items-start gap-1 text-[0.9375rem]">
              <CalendarMenu slug={course.slug} align="start" />
              {course.youtubePlaylistUrl && (
                <a href={course.youtubePlaylistUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline">
                  {t('learn.playlist')}
                </a>
              )}
              {course.driveFolderUrl && (
                <a href={course.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline">
                  {t('learn.folder')}
                </a>
              )}
            </div>
            {course.driveFolderUrl && <DriveNote course={course} />}
            <div id="reminders" className="scroll-mt-6">
              <CheckboxField
                label={t('learn.reminders')}
                checked={course.emailReminders}
                onChange={async (v) => {
                  setCourse({ ...course, emailReminders: v });
                  try {
                    await api(`/learn/${course.slug}/reminders`, { method: 'PUT', json: { emailReminders: v } });
                    setReminderMsg({ ok: true, text: t('learn.remindersSaved') });
                  } catch {
                    setCourse((c) => (c ? { ...c, emailReminders: !v } : c));
                    setReminderMsg({ ok: false, text: t('errors.generic') });
                  }
                }}
              />
              <p role="status" className={`ms-8 text-xs ${reminderMsg?.ok ? 'text-success' : 'text-danger'}`}>
                {reminderMsg?.text}
              </p>
            </div>
          </section>
        </nav>

        <div ref={main} className="flex min-w-0 flex-1 scroll-mt-4 flex-col gap-8 px-5 py-8 sm:px-8 lg:max-w-[60rem] lg:px-10">
          {current ? (
            <SessionCard key={current.id} course={course} session={current} onProgress={onProgress} total={sessions.length} />
          ) : (
            <p className="text-muted">{t('learn.noSessions')}</p>
          )}

          {(prev || next) && (
            <nav aria-label={t('learn.sessionNav')} className="flex flex-wrap justify-between gap-4 border-t border-line pt-5 text-[0.9375rem]">
              {prev ? (
                <a
                  href={`#session-${prev.order}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(prev);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 text-primary hover:underline"
                >
                  <span aria-hidden className="inline-block rtl:rotate-180">←</span> {prev.order}. {sessionTitle(prev)}
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a
                  href={`#session-${next.order}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(next);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  {t('learn.nextSession', { n: next.order, title: sessionTitle(next) })} <Arrow />
                </a>
              )}
            </nav>
          )}

          <CourseAnnouncements items={course.announcements ?? []} />

          {ended && (
            <section className="rounded-xl border border-line p-5 sm:p-6">
              <FeedbackForm slug={course.slug} sessionId={null} legend={t('learn.courseFeedback')} initial={course.courseFeedback} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
