'use client';

import { courseStatusLabels, PUBLIC_COURSE_STATUSES, type TeachingCourseDetailDto, type TeachingSessionDto } from '@academy/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { AssessmentsEditor } from '@/components/admin/AssessmentsEditor';
import { speakerAssessmentEndpoints } from '@/components/admin/assessment-endpoints';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { SpeakerAnnouncements } from '../SpeakerAnnouncements';
import { TeachingGradebook } from './TeachingGradebook';
import { TeachingMaterials } from './TeachingMaterials';
import { TeachingPoints } from './TeachingPoints';

const TABS = ['assessments', 'gradebook', 'points', 'materials', 'announcements'] as const;
type Tab = (typeof TABS)[number];

/** /speaker/courses/{id}: a speaker teaching an assigned course. */
export function TeachingCourse({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  return (
    <RequireAuth>
      {(user) =>
        user.role === 'SPEAKER' ? (
          <Course courseId={courseId} />
        ) : (
          <Container className="max-w-2xl py-10">
            <Alert tone="info">{t('speakerTeaching.notSpeaker')}</Alert>
            <Link href={`/${locale}/speaker`} className={`${buttonClass('secondary', 'md')} mt-5`}>
              {t('speakerTeaching.back')}
            </Link>
          </Container>
        )
      }
    </RequireAuth>
  );
}

function Course({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const asked = search.get('tab') ?? '';
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : 'assessments';
  const [course, setCourse] = useState<TeachingCourseDetailDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);
  const endpoints = useMemo(() => speakerAssessmentEndpoints(courseId), [courseId]);

  useEffect(() => {
    api<TeachingCourseDetailDto>(`/speaker/courses/${courseId}`)
      .then(setCourse)
      .catch((err: unknown) => setError(err instanceof ApiError && (err.status === 403 || err.status === 404) ? 'forbidden' : 'generic'));
  }, [courseId]);

  const go = (next: Tab) => router.replace(`/${locale}/speaker/courses/${courseId}${next === 'assessments' ? '' : `?tab=${next}`}`, { scroll: false });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(tab);
    const d = (e.key === 'ArrowRight') !== (locale === 'ar') ? 1 : -1;
    const next = TABS[(i + d + TABS.length) % TABS.length]!;
    go(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const updateSession = (s: TeachingSessionDto) => setCourse((c) => (c ? { ...c, sessions: c.sessions.map((x) => (x.id === s.id ? s : x)) } : c));

  const back = (
    <Link href={`/${locale}/speaker`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
      <span aria-hidden className="inline-block rtl:rotate-180">
        ←
      </span>
      {t('speakerTeaching.back')}
    </Link>
  );

  if (error) {
    return (
      <Container className="max-w-2xl py-10">
        {back}
        <Alert tone={error === 'forbidden' ? 'warning' : 'danger'} className="mt-3">
          {t(error === 'forbidden' ? 'speakerTeaching.notYours' : 'errors.generic')}
        </Alert>
      </Container>
    );
  }
  if (!course) return <PageSpinner />;
  const title = locale === 'ar' ? course.titleAr : course.titleEn;

  return (
    <Container className="py-6 sm:py-10">
      {back}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl break-words sm:text-3xl">{title}</h1>
        <Badge tone={course.status === 'OPEN' ? 'success' : course.status === 'DRAFT' ? 'warning' : 'neutral'}>{courseStatusLabels[course.status][locale]}</Badge>
        {(PUBLIC_COURSE_STATUSES as readonly string[]).includes(course.status) && (
          <a href={`/${locale}/courses/${course.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            {t('admin.courses.viewPublic')} ↗
          </a>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('speakerTeaching.intro')}</p>

      <div role="tablist" aria-label={title} className="mt-5 flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
        {TABS.map((k) => (
          <button
            key={k}
            id={`tab-${k}`}
            role="tab"
            type="button"
            aria-selected={tab === k}
            aria-controls={tab === k ? `panel-${k}` : undefined}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => go(k)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t(`speakerTeaching.tabs.${k}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === 'assessments' && <AssessmentsEditor courseId={course.id} sessions={course.sessions} endpoints={endpoints} previewSlug={course.slug} />}
        {tab === 'gradebook' && <TeachingGradebook courseId={course.id} endpoints={endpoints} />}
        {tab === 'points' && <TeachingPoints courseId={course.id} />}
        {tab === 'materials' && <TeachingMaterials courseId={course.id} sessions={course.sessions} onChange={updateSession} />}
        {tab === 'announcements' && <SpeakerAnnouncements courseId={course.id} />}
      </div>
    </Container>
  );
}
