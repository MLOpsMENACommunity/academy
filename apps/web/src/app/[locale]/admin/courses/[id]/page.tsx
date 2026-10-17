'use client';

import { COURSE_TAB_PERMISSIONS, courseStatusLabels, hasAdminPermission, PUBLIC_COURSE_STATUSES, type WaitlistDto } from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type KeyboardEvent } from 'react';
import { Announcements } from '@/components/admin/Announcements';
import { AttendancePanel } from '@/components/attendance/AttendancePanel';
import { AssessmentsEditor } from '@/components/admin/AssessmentsEditor';
import { CertificatesPanel } from '@/components/admin/CertificatesPanel';
import { CourseApplications } from '@/components/admin/CourseApplications';
import { CourseLeaderboard } from '@/components/admin/CourseLeaderboard';
import { Waitlist } from '@/components/admin/Waitlist';
import { DeleteCourse } from '@/components/admin/DeleteCourse';
import { DuplicateCourse } from '@/components/admin/DuplicateCourse';
import { EnrolByEmail } from '@/components/admin/EnrolByEmail';
import { CourseForm } from '@/components/admin/CourseForm';
import { toForm, type AdminCourse } from '@/components/admin/admin-course';
import { CourseStaffPanel } from '@/components/admin/CourseStaffPanel';
import { EnrolledStudents, FeedbackPanel, QuestionsEditor, SessionsEditor } from '@/components/admin/CourseTabs';
import { useAuth } from '@/components/auth/AuthProvider';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

const TABS = ['details', 'staff', 'questions', 'applications', 'sessions', 'attendance', 'assessments', 'leaderboard', 'enrolled', 'invites', 'certificates', 'announcements', 'waitlist', 'feedback'] as const;
type Tab = (typeof TABS)[number];

function CourseEditor() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();
  // Only the tabs this admin's presets cover (the API checks the same on every request).
  const tabs = TABS.filter((k) => hasAdminPermission(user, COURSE_TAB_PERMISSIONS[k]));
  const academic = hasAdminPermission(user, ['ACADEMIC']);
  const admissions = hasAdminPermission(user, ['ADMISSIONS']);
  const asked = search.get('tab') ?? '';
  const tab: Tab = (tabs as readonly string[]).includes(asked) ? (asked as Tab) : (tabs[0] ?? 'details');
  const [course, setCourse] = useState<AdminCourse | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);
  const [version, setVersion] = useState(0);
  const [waiting, setWaiting] = useState<{ count: number; waiting: number } | null>(null);
  const [applications, setApplications] = useState<number | null>(null);

  useEffect(() => {
    api<AdminCourse>(`/admin/courses/${id}`)
      .then(setCourse)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id, version]);

  // For the tab count and the "tell the waiting list" prompt once the course opens.
  useEffect(() => {
    if (!admissions) return;
    api<WaitlistDto>(`/admin/courses/${id}/waitlist`)
      .then((w) => setWaiting({ count: w.count, waiting: w.waiting }))
      .catch(() => setWaiting(null));
  }, [id, version, tab, admissions]);

  // For the Applications tab count: every application to this course, whatever its status.
  useEffect(() => {
    if (!admissions) return;
    api<{ total: number }>(`/admin/applications?courseId=${encodeURIComponent(id)}&pageSize=10`)
      .then((r) => setApplications(r.total))
      .catch(() => setApplications(null));
  }, [id, version, admissions]);

  const refresh = () => setVersion((v) => v + 1);
  const go = (next: Tab) => router.replace(`/${locale}/admin/courses/${id}${next === tabs[0] ? '' : `?tab=${next}`}`, { scroll: false });
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(tab);
    const d = (e.key === 'ArrowRight') !== (locale === 'ar') ? 1 : -1;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + d + tabs.length) % tabs.length]!;
    go(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  if (error) return <Alert tone="danger">{t(error === 'notFound' ? 'errors.notFound' : 'errors.generic')}</Alert>;
  if (!course) return <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <div>
      <Link href={`/${locale}/admin/courses`} className="text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.courses.title')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">{(locale === 'ar' && course.titleAr) || course.titleEn}</h1>
        <Badge tone={course.status === 'OPEN' ? 'success' : course.status === 'DRAFT' ? 'warning' : course.status === 'COMING_SOON' ? 'info' : 'neutral'}>{courseStatusLabels[course.status][locale]}</Badge>
        {course.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
        {course.source === 'speaker-booking' && <Badge tone="info">{t('admin.courses.fromBooking.badge')}</Badge>}
        {(PUBLIC_COURSE_STATUSES as readonly string[]).includes(course.status) && (
          <a href={`/${locale}/courses/${course.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            {t('admin.courses.viewPublic')} ↗
          </a>
        )}
        {academic && (
        <div className="ms-auto flex items-start gap-2">
          <DuplicateCourse courseId={course.id} slug={course.slug} titleEn={course.titleEn} />
          <DeleteCourse
            courseId={course.id}
            title={course.titleEn}
            titleAr={course.titleAr}
            slug={course.slug}
            // Back to the list either way: the open Details form still holds the old status.
            onDone={() => router.push(`/${locale}/admin/courses`)}
          />
        </div>
        )}
      </div>

      {course.source === 'import' && <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.courses.importedHint')}</p>}
      {course.source === 'speaker-booking' && course.status === 'DRAFT' && (
        <Alert tone="warning" className="mt-4" title={t('admin.courses.fromBooking.title')}>
          {t('admin.courses.fromBooking.body')}
        </Alert>
      )}

      {/* Opening a course never emails anyone by itself: the admin decides when to tell the list. */}
      {course.status === 'OPEN' && waiting && waiting.waiting > 0 && tab !== 'waitlist' && (
        <Alert tone="info" className="mt-4">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {t('admin.courses.wl.openPrompt', { count: waiting.waiting })}
            <button type="button" onClick={() => go('waitlist')} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 sm:min-h-0">
              {t('admin.courses.wl.openPromptAction')}
            </button>
          </span>
        </Alert>
      )}

      <div role="tablist" aria-label={t('admin.courses.title')} className="mt-5 flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
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
            className={`min-h-10 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {k === 'staff' ? t('admin.staff.tab') : k === 'attendance' ? t('attendance.tab') : k === 'assessments' ? t('admin.assessments.tab') : k === 'leaderboard' ? t('admin.points.boardTab') : k === 'certificates' ? t('admin.certificates.tab') : t(`admin.courses.${k}`)}
            {k === 'sessions' && ` (${course.sessions.length})`}
            {k === 'questions' && ` (${course.questions.length})`}
            {k === 'waitlist' && waiting && ` (${waiting.count})`}
            {k === 'applications' && applications !== null && ` (${applications})`}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === 'details' && <CourseForm initial={toForm(course)} courseId={course.id} onSaved={refresh} />}
        {tab === 'staff' && <CourseStaffPanel courseId={course.id} />}
        {tab === 'questions' && <QuestionsEditor courseId={course.id} initial={course.questions} onChange={refresh} />}
        {tab === 'applications' && <CourseApplications courseId={course.id} slug={course.slug} paid={course.type === 'PAID'} onChange={refresh} />}
        {tab === 'sessions' && <SessionsEditor courseId={course.id} initial={course.sessions} onChange={refresh} />}
        {tab === 'attendance' && (
          <AttendancePanel
            base={`/admin/courses/${course.id}`}
            canEditSettings={academic}
            sessionId={search.get('session')}
            onSession={(sid) => router.replace(`/${locale}/admin/courses/${id}?tab=attendance${sid ? `&session=${encodeURIComponent(sid)}` : ''}`, { scroll: false })}
          />
        )}
        {tab === 'assessments' && <AssessmentsEditor courseId={course.id} sessions={course.sessions} />}
        {tab === 'leaderboard' && <CourseLeaderboard courseId={course.id} />}
        {tab === 'enrolled' && <EnrolledStudents courseId={course.id} usesDrive={course.recordingsPlatform === 'GOOGLE_DRIVE' || Boolean(course.driveFolderUrl)} initialPendingOnly={search.get('driveAccess') === 'pending'} />}
        {tab === 'invites' && <EnrolByEmail courseId={course.id} paid={course.type === 'PAID'} onChange={refresh} />}
        {tab === 'certificates' && <CertificatesPanel courseId={course.id} />}
        {tab === 'announcements' && <Announcements courseId={course.id} />}
        {tab === 'waitlist' && <Waitlist courseId={course.id} status={course.status} titleEn={course.titleEn} titleAr={course.titleAr} />}
        {tab === 'feedback' && <FeedbackPanel courseId={course.id} />}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CourseEditor />
    </Suspense>
  );
}
