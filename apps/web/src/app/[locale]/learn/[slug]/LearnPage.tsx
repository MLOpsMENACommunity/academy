'use client';

import { parseSessionHash, type AssessmentSummaryDto, type LearnCertificateDto, type LearnCourseDto, type LearnSessionDto, type MeResponse } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { CertificateBanner, CertificateRuleCard } from '@/components/certificates/LearnCertificate';
import { LocalTime } from '@/components/course/LocalTime';
import { CheckboxField } from '@/components/forms/fields';
import { AssessmentList } from '@/components/learn/AssessmentList';
import { CalendarMenu } from '@/components/learn/CalendarMenu';
import { FeedbackForm } from '@/components/learn/FeedbackForm';
import { CourseAnnouncements } from '@/components/learn/Announcements';
import { DriveNote } from '@/components/learn/DriveNote';
import { SessionCard } from '@/components/learn/SessionCard';
import { Leaderboard } from '@/components/points/Leaderboard';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Arrow, IconCheck } from '@/components/ui/Icons';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

export function LearnPage() {
  return <RequireAuth>{(user) => <Inner user={user} />}</RequireAuth>;
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

/** #session-3 (or #session-3-feedback, from the feedback emails and the dashboard) → 3. */
const hashOrder = () => parseSessionHash(window.location.hash)?.order ?? null;

/**
 * Scrolls to a rating form named by the hash (#session-3-feedback, #course-feedback) once it
 * is on the page, and moves focus to it so keyboard and screen-reader users land there too.
 */
function scrollToFeedback(): void {
  const h = window.location.hash;
  if (!parseSessionHash(h)?.feedback && h !== '#course-feedback') return;
  // Twice: once the session card has rendered, then again after images and fonts shift the layout.
  const go = () => {
    const el = document.getElementById(h.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  };
  requestAnimationFrame(go);
  setTimeout(go, 400);
}

function Inner({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const [course, setCourse] = useState<LearnCourseDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);
  const [reminderMsg, setReminderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [assessments, setAssessments] = useState<AssessmentSummaryDto[]>([]);
  const [certificate, setCertificate] = useState<LearnCertificateDto | null>(null);
  const main = useRef<HTMLDivElement>(null);

  // The certificate card is an optional extra too (it follows progress locally, see CertificateRuleCard).
  const loadCertificate = useCallback(() => {
    api<LearnCertificateDto>(`/learn/${slug}/certificate`)
      .then(setCertificate)
      .catch(() => undefined);
  }, [slug]);

  const load = useCallback(() => {
    api<LearnCourseDto>(`/learn/${slug}`)
      .then(setCourse)
      .catch((e: unknown) => setError(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'forbidden' : 'generic'));
    // Assessments are optional extras on this page: if they fail to load, the course still shows.
    api<AssessmentSummaryDto[]>(`/learn/${slug}/assessments`)
      .then(setAssessments)
      .catch(() => undefined);
    loadCertificate();
  }, [slug, loadCertificate]);
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
    scrollToFeedback();
  }, [course]);
  useEffect(() => {
    const onHash = () => {
      const n = hashOrder();
      if (n) setSelected(n);
      scrollToFeedback();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (error) {
    return (
      <Container className="py-12">
        <Alert tone={error === 'forbidden' ? 'info' : 'danger'}>
          {error === 'forbidden' ? t('learn.notEnrolled') : t('errors.generic')}{' '}
          {/* "Enrol by email": an invited student is enrolled once their address is confirmed. */}
          {error === 'forbidden' && !user.emailVerified && <>{t('learn.confirmEmailFirst')} </>}
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
  const onProgress = (id: string, completed: boolean) => {
    setCourse((c) => {
      if (!c) return c;
      const list = c.sessions.map((s) => (s.id === id ? { ...s, completed } : s));
      const done = list.filter((s) => s.completed).length;
      return { ...c, sessions: list, progress: { completed: done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 } };
    });
  };
  const ended = sessions.length > 0 && sessions.every((s) => s.phase === 'ended');
  const dueCount = assessments.filter((a) => a.due).length;
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

      {/* Students enrolled by email may not have filled in their profile: a nudge, never a gate. */}
      {user.role === 'STUDENT' && !user.profile.coreComplete && (
        <Container className="pt-4">
          <Alert tone="info">
            {t('learn.profileNudge')}{' '}
            <Link href={`/${locale}/profile`} className="font-semibold underline">
              {t('dashboard.completeProfile')}
            </Link>
          </Alert>
        </Container>
      )}

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

          {assessments.length > 0 && (
            <a
              href="#assessments"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('assessments')?.scrollIntoView({ block: 'start' });
                document.getElementById('assessments-title')?.focus({ preventScroll: true });
              }}
              className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-[0.9375rem] font-medium text-fg hover:bg-hover-bg"
            >
              {t('assessments.title')}
              {dueCount > 0 && (
                <span className="rounded-full bg-cta px-2.5 py-0.5 text-[0.8125rem] font-semibold text-cta-text">{t('assessments.dueCount', { count: dueCount })}</span>
              )}
            </a>
          )}

          <a
            href="#leaderboard"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('leaderboard')?.scrollIntoView({ block: 'start' });
              document.getElementById('leaderboard-title')?.focus({ preventScroll: true });
            }}
            className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-[0.9375rem] font-medium text-fg hover:bg-hover-bg"
          >
            {t('leaderboard.title')}
            <span aria-hidden>🏆</span>
          </a>

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
          <CertificateBanner data={certificate} />
          {current ? (
            <SessionCard
              key={current.id}
              course={course}
              session={current}
              onProgress={onProgress}
              total={sessions.length}
              assessments={assessments.filter((a) => a.sessionId === current.id)}
            />
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

          {assessments.length > 0 && (
            <div id="assessments" className="scroll-mt-6">
              <AssessmentList slug={course.slug} items={assessments} headingId="assessments-title" title={t('assessments.courseTitle')} level="h2" />
            </div>
          )}

          <CertificateRuleCard data={certificate} progress={course.progress} />

          <div id="leaderboard" className="scroll-mt-6">
            <Leaderboard slug={course.slug} />
          </div>

          <CourseAnnouncements items={course.announcements ?? []} />

          {ended && (
            <section id="course-feedback" className="scroll-mt-6 rounded-xl border border-line p-5 sm:p-6">
              <FeedbackForm slug={course.slug} sessionId={null} legend={t('learn.courseFeedback')} initial={course.courseFeedback} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
