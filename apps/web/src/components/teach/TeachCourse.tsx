'use client';

import { courseStatusLabels, PUBLIC_COURSE_STATUSES, teachTabsFor, type TeachingCourseDetailDto, type TeachingSessionDto, type TeachTab } from '@academy/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { AssessmentsEditor } from '@/components/admin/AssessmentsEditor';
import { speakerAssessmentEndpoints } from '@/components/admin/assessment-endpoints';
import { CertificatesPanel } from '@/components/admin/CertificatesPanel';
import { CourseApplications } from '@/components/admin/CourseApplications';
import { EnrolByEmail } from '@/components/admin/EnrolByEmail';
import { Waitlist } from '@/components/admin/Waitlist';
import { AttendancePanel } from '@/components/attendance/AttendancePanel';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { TeachingGradebook } from '@/components/speakers/teaching/TeachingGradebook';
import { TeachingMaterials } from '@/components/speakers/teaching/TeachingMaterials';
import { TeachingPoints } from '@/components/speakers/teaching/TeachingPoints';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { TeachAnnouncements } from './TeachAnnouncements';
import { TeachDetails, TeachSessions } from './TeachManage';
import { TeachRoster } from './TeachRoster';

/** /teach/courses/{id}: a course I'm on the staff of, with the tabs my role's permissions open. */
export function TeachCourse({ courseId }: { courseId: string }) {
  return <RequireAuth>{() => <Course courseId={courseId} />}</RequireAuth>;
}

export function BackToTeaching() {
  const { locale, t } = useI18n();
  return (
    <Link href={`/${locale}/teach`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:underline">
      <span aria-hidden className="inline-block rtl:rotate-180">
        ←
      </span>
      {t('teach.back')}
    </Link>
  );
}

function Course({ courseId }: { courseId: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const [course, setCourse] = useState<TeachingCourseDetailDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);
  const endpoints = useMemo(() => speakerAssessmentEndpoints(courseId), [courseId]);
  const tabs = useMemo(() => (course ? teachTabsFor(course.permissions) : []), [course]);
  const asked = search.get('tab') ?? '';
  const tab: TeachTab | undefined = (tabs as string[]).includes(asked) ? (asked as TeachTab) : tabs[0];
  const base = `/teach/courses/${courseId}`;

  useEffect(() => {
    api<TeachingCourseDetailDto>(base)
      .then(setCourse)
      .catch((err: unknown) => setError(err instanceof ApiError && (err.status === 403 || err.status === 404) ? 'forbidden' : 'generic'));
  }, [base]);

  const go = (next: TeachTab) => router.replace(`/${locale}/teach/courses/${courseId}${next === tabs[0] ? '' : `?tab=${next}`}`, { scroll: false });
  const onKey = (e: KeyboardEvent) => {
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    const i = tabs.indexOf(tab);
    const d = (e.key === 'ArrowRight') !== (locale === 'ar') ? 1 : -1;
    const next = tabs[(i + d + tabs.length) % tabs.length]!;
    go(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const updateSession = (s: TeachingSessionDto) => setCourse((c) => (c ? { ...c, sessions: c.sessions.map((x) => (x.id === s.id ? s : x)) } : c));

  if (error) {
    return (
      <Container className="max-w-2xl py-10">
        <BackToTeaching />
        <Alert tone={error === 'forbidden' ? 'warning' : 'danger'} className="mt-3">
          {t(error === 'forbidden' ? 'teach.notYours' : 'errors.generic')}
        </Alert>
      </Container>
    );
  }
  if (!course) return <PageSpinner />;
  const title = locale === 'ar' ? course.titleAr : course.titleEn;
  const role = (locale === 'ar' && course.roleNameAr) || course.roleName;

  return (
    <Container className="py-6 sm:py-10">
      <BackToTeaching />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl break-words sm:text-3xl">{title}</h1>
        <Badge tone={course.status === 'OPEN' ? 'success' : course.status === 'DRAFT' ? 'warning' : 'neutral'}>{courseStatusLabels[course.status][locale]}</Badge>
        {(PUBLIC_COURSE_STATUSES as readonly string[]).includes(course.status) && (
          <a href={`/${locale}/courses/${course.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            {t('admin.courses.viewPublic')} ↗
          </a>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        {role ? t('teach.introRole', { role }) : t('teach.introAdmin')} {t('teach.introAudit')}
      </p>

      {tabs.length === 0 || !tab ? (
        <Alert tone="info" className="mt-5">
          {t('teach.noPermissions')}
        </Alert>
      ) : (
        <>
          <div role="tablist" aria-label={title} className="mt-5 flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
            {tabs.map((k) => (
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
                {t(`teach.tabs.${k}`)}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
            {tab === 'assessments' && <AssessmentsEditor courseId={course.id} sessions={course.sessions} endpoints={endpoints} previewSlug={course.slug} />}
            {tab === 'gradebook' && <TeachingGradebook courseId={course.id} endpoints={endpoints} />}
            {tab === 'materials' && <TeachingMaterials courseId={course.id} sessions={course.sessions} onChange={updateSession} />}
            {tab === 'attendance' && (
              <AttendancePanel
                base={base}
                canEditSettings={false}
                sessionId={search.get('session')}
                onSession={(sid) => router.replace(`/${locale}/teach/courses/${courseId}?tab=attendance${sid ? `&session=${encodeURIComponent(sid)}` : ''}`, { scroll: false })}
              />
            )}
            {tab === 'points' && <TeachingPoints courseId={course.id} />}
            {tab === 'roster' && <TeachRoster courseId={course.id} />}
            {tab === 'announcements' && <TeachAnnouncements courseId={course.id} title={title} />}
            {tab === 'details' && <TeachDetails courseId={course.id} />}
            {tab === 'sessions' && <TeachSessions courseId={course.id} canAttendance={course.permissions.includes('UPLOAD_ATTENDANCE')} />}
            {tab === 'applications' && <CourseApplications courseId={course.id} slug={course.slug} paid={course.type === 'PAID'} apiBase={base} />}
            {tab === 'enrolment' && (
              <div className="space-y-10">
                <EnrolByEmail courseId={course.id} paid={course.type === 'PAID'} apiBase={base} canWaivePayment={course.canWaivePayment} />
                <section aria-labelledby="teach-waitlist" className="space-y-3">
                  <h2 id="teach-waitlist" className="text-xl">
                    {t('admin.courses.waitlist')}
                  </h2>
                  <Waitlist courseId={course.id} status={course.status} titleEn={course.titleEn} titleAr={course.titleAr} apiBase={base} />
                </section>
              </div>
            )}
            {tab === 'certificates' && <CertificatesPanel courseId={course.id} apiBase={base} />}
          </div>
        </>
      )}
    </Container>
  );
}
