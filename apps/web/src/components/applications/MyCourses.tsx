'use client';

import { courseLanguageLabels, courseLevelsText, type CourseLanguage, type CourseLevelsOf } from '@academy/shared';
import Link from 'next/link';
import { SegmentedTabs } from '@/components/catalog/Segmented';
import { useI18n } from '@/i18n/client';
import { formatDate } from '@/lib/format';
import { isCompleted, type CourseProgress } from '@/lib/use-progress';
import { Alert } from '../ui/Alert';
import { buttonClass } from '../ui/Button';
import { Arrow } from '../ui/Icons';
import { StatusBadge } from './StatusBadge';

/** Public facts about a course, for the card's metadata line. */
export interface CourseMeta extends CourseLevelsOf {
  language: CourseLanguage;
  durationWeeks: number | null;
  startDate: string | null;
  completed: boolean;
}

function CourseRow({ item: p, meta }: { item: CourseProgress; meta?: CourseMeta }) {
  const { locale, t } = useI18n();
  const title = locale === 'ar' ? p.course.titleAr : p.course.titleEn;
  const done = isCompleted(p);
  const needsPayment = p.status === 'AWAITING_PAYMENT' || p.status === 'PAYMENT_REJECTED';
  const bar = done ? 'bg-logo-green' : p.enrolled ? 'bg-logo-cyan' : 'bg-transparent';
  const facts = [
    meta && courseLevelsText(meta, locale),
    meta?.durationWeeks ? t('catalog.weeks', { count: meta.durationWeeks }) : null,
    meta && courseLanguageLabels[meta.language][locale],
    p.course.startDate && !meta?.completed ? t('catalog.starts', { date: formatDate(p.course.startDate, locale) }) : null,
  ].filter(Boolean);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-card">
      <div aria-hidden className={`h-1.5 ${bar}`} />
      <div className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {done ? (
            <span className="rounded-md bg-success-soft px-2.5 py-0.5 text-[0.8125rem] font-medium text-success">{t('paths.done')}</span>
          ) : p.enrolled ? (
            <span className="rounded-md bg-info-soft px-2.5 py-0.5 text-[0.8125rem] font-medium text-info">{t('paths.inProgress')}</span>
          ) : (
            <StatusBadge status={p.status} locale={locale} />
          )}
        </div>
        <h3 className="text-[1.1875rem] leading-snug">{title}</h3>
        {facts.length > 0 && <p className="text-sm text-muted">{facts.join(' · ')}</p>}
        {p.progress ? (
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={t('paths.courseProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={p.progress.percent}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"
            >
              <div className="h-full rounded-full bg-logo-cyan" style={{ width: `${p.progress.percent}%` }} />
            </div>
            <span className="text-sm text-body">{t('learn.progress', { completed: p.progress.completed, total: p.progress.total })}</span>
          </div>
        ) : (
          !p.enrolled && <p className="text-sm text-body">{t(`applications.next.${p.status}`)}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          {p.enrolled ? (
            <Link href={`/${locale}/learn/${p.slug}${p.nextSession && !done ? `#session-${p.nextSession.order}` : ''}`} className={buttonClass('primary', 'md')}>
              {p.nextSession && !done ? t('dashboard.resumeSession', { n: p.nextSession.order }) : t('applications.goToCourse')}
            </Link>
          ) : needsPayment ? (
            <Link href={`/${locale}/dashboard/applications/${p.applicationId}#payment-title`} className={buttonClass('primary', 'md')}>
              {t('applications.pay')}
            </Link>
          ) : null}
          <Link href={`/${locale}/dashboard/applications/${p.applicationId}`} className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] font-medium text-primary hover:underline">
            {t('apply.viewApplication')} <Arrow />
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Dashboard "My courses": every application, with progress for enrolled courses, filtered by All / In progress / Completed. */
export function MyCourses({ items, error, courses }: { items: CourseProgress[] | null; error: boolean; courses: Record<string, CourseMeta> }) {
  const { locale, t } = useI18n();
  const heading = (
    <h2 id="my-courses" className="text-xl">
      {t('dashboard.myCourses')}
    </h2>
  );

  if (error) {
    return (
      <section aria-labelledby="my-courses" className="flex flex-col gap-4">
        {heading}
        <Alert tone="danger">{t('errors.generic')}</Alert>
      </section>
    );
  }
  if (!items) {
    return (
      <section aria-labelledby="my-courses" className="flex flex-col gap-4">
        {heading}
        <p className="text-muted">{t('common.loading')}</p>
      </section>
    );
  }
  if (!items.length) {
    return (
      <section aria-labelledby="my-courses" className="flex flex-col gap-4">
        {heading}
        <div className="rounded-card border border-dashed border-line-strong/50 bg-card p-8 text-center">
          <p className="text-muted">{t('dashboard.noCourses')}</p>
          <Link href={`/${locale}/courses`} className={buttonClass('primary', 'md', 'mt-4')}>
            {t('dashboard.browse')}
          </Link>
        </div>
      </section>
    );
  }

  const inProgress = items.filter((p) => p.enrolled && !isCompleted(p));
  const completed = items.filter(isCompleted);
  const list = (rows: CourseProgress[], empty: string) =>
    rows.length ? (
      <ul className="grid gap-5 md:grid-cols-2">
        {rows.map((p) => (
          <li key={p.applicationId}>
            <CourseRow item={p} meta={courses[p.slug]} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="rounded-card border border-dashed border-line-strong/50 bg-card p-6 text-center text-muted">{empty}</p>
    );
  const count = (n: number) => <span className="opacity-80">{n}</span>;

  return (
    <section aria-labelledby="my-courses">
      <SegmentedTabs
        label={t('dashboard.myCourses')}
        headerStart={heading}
        tabs={[
          { id: 'all', label: <>{t('dashboard.tabAll')} {count(items.length)}</>, panel: list(items, '') },
          { id: 'progress', label: <>{t('dashboard.tabInProgress')} {count(inProgress.length)}</>, panel: list(inProgress, t('dashboard.noneInProgress')) },
          { id: 'done', label: <>{t('dashboard.tabCompleted')} {count(completed.length)}</>, panel: list(completed, t('dashboard.noneCompleted')) },
        ]}
      />
    </section>
  );
}
