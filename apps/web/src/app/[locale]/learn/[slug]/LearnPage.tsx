'use client';

import type { LearnCourseDto } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { CheckboxField } from '@/components/forms/fields';
import { FeedbackForm } from '@/components/learn/FeedbackForm';
import { SessionCard } from '@/components/learn/SessionCard';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { Progress } from '@/components/ui/Progress';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

export function LearnPage() {
  return <RequireAuth>{() => <Inner />}</RequireAuth>;
}

function Inner() {
  const { locale, t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const [course, setCourse] = useState<LearnCourseDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);

  useEffect(() => {
    api<LearnCourseDto>(`/learn/${slug}`)
      .then(setCourse)
      .catch((e: unknown) => setError(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'forbidden' : 'generic'));
  }, [slug]);

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
  const onProgress = (id: string, completed: boolean) =>
    setCourse((c) => {
      if (!c) return c;
      const sessions = c.sessions.map((s) => (s.id === id ? { ...s, completed } : s));
      const done = sessions.filter((s) => s.completed).length;
      return { ...c, sessions, progress: { completed: done, total: sessions.length, percent: sessions.length ? Math.round((done / sessions.length) * 100) : 0 } };
    });
  const ended = course.sessions.length > 0 && course.sessions.every((s) => s.phase === 'ended');

  return (
    <Container className="max-w-4xl py-10">
      <Link href={`/${locale}/dashboard`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('applications.back')}
      </Link>
      <h1 className="mt-2 text-3xl">{title}</h1>

      <div className="mt-6 grid gap-4 rounded-card border border-line bg-card p-5 sm:grid-cols-2">
        <Progress value={course.progress.percent} label={t('learn.progress', { completed: course.progress.completed, total: course.progress.total })} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:justify-end">
          <a href={`/api/learn/${course.slug}/calendar.ics`} className="font-semibold text-primary underline" download>
            {t('learn.wholeCourse')}
          </a>
          {course.youtubePlaylistUrl && (
            <a href={course.youtubePlaylistUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {t('learn.playlist')}
            </a>
          )}
          {course.driveFolderUrl && (
            <a href={course.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {t('learn.folder')}
            </a>
          )}
        </div>
        <div id="reminders" className="sm:col-span-2">
          <CheckboxField
            label={t('learn.reminders')}
            checked={course.emailReminders}
            onChange={async (v) => {
              setCourse({ ...course, emailReminders: v });
              await api(`/learn/${course.slug}/reminders`, { method: 'PUT', json: { emailReminders: v } }).catch(() => undefined);
              setReminderMsg(t('learn.remindersSaved'));
            }}
          />
          <p role="status" className="ms-8 text-xs text-success">
            {reminderMsg}
          </p>
        </div>
      </div>

      <h2 className="mt-10 text-2xl">{t('learn.sessions')}</h2>
      <div className="mt-4 space-y-4">
        {course.sessions.map((s) => (
          <SessionCard key={s.id} course={course} session={s} onProgress={onProgress} />
        ))}
      </div>

      {ended && (
        <section className="mt-10 rounded-card border border-line bg-card p-5 sm:p-6">
          <FeedbackForm slug={course.slug} sessionId={null} legend={t('learn.courseFeedback')} initial={course.courseFeedback} />
        </section>
      )}
    </Container>
  );
}
