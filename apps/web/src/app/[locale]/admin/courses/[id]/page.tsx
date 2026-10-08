'use client';

import { courseStatusLabels, PUBLIC_COURSE_STATUSES, type CourseStatus, type FaqItem, type Included, type LocalizedList, type LocalizedText, type OutlineModule } from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type KeyboardEvent } from 'react';
import { Announcements } from '@/components/admin/Announcements';
import { DuplicateCourse } from '@/components/admin/DuplicateCourse';
import { CourseForm, toLocalInput, type CourseFormValue } from '@/components/admin/CourseForm';
import { EnrolledStudents, FeedbackPanel, QuestionsEditor, SessionsEditor, type QuestionRow, type SessionRow } from '@/components/admin/CourseTabs';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

const TABS = ['details', 'questions', 'sessions', 'enrolled', 'announcements', 'feedback'] as const;
type Tab = (typeof TABS)[number];

interface AdminCourse extends Omit<CourseFormValue, 'targetAudience' | 'notFor' | 'preparation' | 'learningOutcomes' | 'prerequisites' | 'outline' | 'faq' | 'included'> {
  id: string;
  status: CourseStatus;
  targetAudience: LocalizedText;
  notFor: LocalizedText;
  preparation?: LocalizedText;
  learningOutcomes: LocalizedList;
  prerequisites: LocalizedList;
  outline: OutlineModule[];
  faq: FaqItem[];
  included: Included;
  questions: QuestionRow[];
  sessions: SessionRow[];
}

function toForm(c: AdminCourse): CourseFormValue {
  return {
    slug: c.slug,
    titleEn: c.titleEn,
    titleAr: c.titleAr,
    shortDescriptionEn: c.shortDescriptionEn,
    shortDescriptionAr: c.shortDescriptionAr,
    longDescriptionEn: c.longDescriptionEn,
    longDescriptionAr: c.longDescriptionAr,
    type: c.type,
    price: c.price,
    currency: c.currency,
    requiresApproval: c.requiresApproval,
    capacity: c.capacity,
    status: c.status,
    level: c.level,
    language: c.language,
    startDate: toLocalInput(c.startDate),
    applicationsOpenAt: toLocalInput(c.applicationsOpenAt),
    applicationDeadline: toLocalInput(c.applicationDeadline),
    durationWeeks: c.durationWeeks,
    hoursPerWeek: c.hoursPerWeek,
    coverImageUrl: c.coverImageUrl,
    targetAudience: c.targetAudience,
    notFor: c.notFor,
    preparation: c.preparation ?? { en: '', ar: '' },
    learningOutcomes: c.learningOutcomes,
    prerequisites: c.prerequisites,
    outline: c.outline,
    faq: c.faq,
    included: c.included,
    deliveryPlatform: c.deliveryPlatform,
    recordingsPlatform: c.recordingsPlatform,
    driveFolderUrl: c.driveFolderUrl,
    youtubePlaylistUrl: c.youtubePlaylistUrl,
    instructorIds: c.instructorIds,
  };
}

function CourseEditor() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as Tab) : 'details';
  const [course, setCourse] = useState<AdminCourse | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<AdminCourse>(`/admin/courses/${id}`)
      .then(setCourse)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id, version]);

  const refresh = () => setVersion((v) => v + 1);
  const go = (next: Tab) => router.replace(`/${locale}/admin/courses/${id}${next === 'details' ? '' : `?tab=${next}`}`, { scroll: false });
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const d = (e.key === 'ArrowRight') !== (locale === 'ar') ? 1 : -1;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(i + d + TABS.length) % TABS.length]!;
    go(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  if (error) return <Alert tone="danger">{t(error === 'notFound' ? 'errors.notFound' : 'errors.generic')}</Alert>;
  if (!course) return <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <div>
      <Link href={`/${locale}/admin/courses`} className="text-sm text-muted hover:underline">
        ← {t('admin.courses.title')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">{(locale === 'ar' && course.titleAr) || course.titleEn}</h1>
        <Badge tone={course.status === 'OPEN' ? 'success' : course.status === 'DRAFT' ? 'warning' : course.status === 'COMING_SOON' ? 'info' : 'neutral'}>{courseStatusLabels[course.status][locale]}</Badge>
        {(PUBLIC_COURSE_STATUSES as readonly string[]).includes(course.status) && (
          <a href={`/${locale}/courses/${course.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            {t('admin.courses.viewPublic')} ↗
          </a>
        )}
        <div className="ms-auto">
          <DuplicateCourse courseId={course.id} slug={course.slug} titleEn={course.titleEn} />
        </div>
      </div>

      <div role="tablist" aria-label={t('admin.courses.title')} className="mt-5 flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
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
            className={`min-h-10 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t(`admin.courses.${k}`)}
            {k === 'sessions' && ` (${course.sessions.length})`}
            {k === 'questions' && ` (${course.questions.length})`}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === 'details' && <CourseForm initial={toForm(course)} courseId={course.id} onSaved={refresh} />}
        {tab === 'questions' && <QuestionsEditor courseId={course.id} initial={course.questions} onChange={refresh} />}
        {tab === 'sessions' && <SessionsEditor courseId={course.id} initial={course.sessions} onChange={refresh} />}
        {tab === 'enrolled' && <EnrolledStudents courseId={course.id} usesDrive={course.recordingsPlatform === 'GOOGLE_DRIVE' || Boolean(course.driveFolderUrl)} initialPendingOnly={search.get('driveAccess') === 'pending'} />}
        {tab === 'announcements' && <Announcements courseId={course.id} />}
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
