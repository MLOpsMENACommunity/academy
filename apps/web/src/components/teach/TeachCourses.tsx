'use client';

import { courseStatusLabels, type TeachingCourseDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** The courses whose staff I'm on (GET /teach/courses), or null while loading. */
export function useTeachCourses(): { courses: TeachingCourseDto[] | null; error: string | null } {
  const { t } = useI18n();
  const [courses, setCourses] = useState<TeachingCourseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<TeachingCourseDto[]>('/teach/courses')
      .then(setCourses)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [t]);
  return { courses, error };
}

/**
 * The courses I'm on the staff of, each with my role and a way in (Teaching → {course}).
 * `variant` "page": the /teach page (says so when there are none); "section": the speaker
 * portal's My courses (nothing renders without any).
 */
export function TeachCourses({ variant = 'section' }: { variant?: 'page' | 'section' }) {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`speakerTeaching.${k}`, v);
  const { courses, error } = useTeachCourses();

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!courses) return variant === 'page' ? <p className="text-muted">{t('admin.common.loading')}</p> : null;
  if (!courses.length) return variant === 'page' ? <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{t('teach.none')}</p> : null;

  const list = (
    <ul className="grid gap-3 sm:grid-cols-2">
      {courses.map((c) => (
        <li key={c.id}>
          <Card className="flex h-full flex-col gap-3 !p-4 sm:!p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-semibold break-words text-fg">{locale === 'ar' ? c.titleAr : c.titleEn}</p>
              <Badge tone={c.status === 'OPEN' ? 'success' : 'neutral'}>{courseStatusLabels[c.status][locale]}</Badge>
            </div>
            {c.roleName && (
              <p className="text-sm text-fg">
                {t('teach.yourRole')}: <span className="font-medium">{(locale === 'ar' && c.roleNameAr) || c.roleName}</span>
              </p>
            )}
            <p className="text-sm text-muted">
              {m('students', { count: c.students })} · {m('assessments', { count: c.assessments })}
            </p>
            {c.toGrade > 0 && (
              <span className="self-start">
                <Badge tone="danger">{t('admin.assessments.toGrade', { count: c.toGrade })}</Badge>
              </span>
            )}
            <Link href={`/${locale}/teach/courses/${c.id}`} className={`${buttonClass('primary', 'md')} mt-auto self-start`}>
              {m('open')}
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
  if (variant === 'page') return list;

  return (
    <section aria-labelledby="my-courses-h" className="space-y-3">
      <div>
        <h2 id="my-courses-h" className="text-2xl">
          {m('myCourses')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{m('myCoursesIntro')}</p>
      </div>
      {list}
      <Link href={`/${locale}/teach`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        {t('teach.openArea')}
        <span aria-hidden className="inline-block rtl:rotate-180">
          →
        </span>
      </Link>
    </section>
  );
}

/** Dashboard: a way into Teaching for anyone on a course's staff (nothing otherwise). */
export function TeachingCard({ className = '' }: { className?: string }) {
  const { locale, t } = useI18n();
  const { courses } = useTeachCourses();
  if (!courses?.length) return null;
  const toGrade = courses.reduce((n, c) => n + c.toGrade, 0);
  return (
    <div className={`${className} flex flex-col gap-2 p-5`}>
      <h2 className="text-base">{t('teach.title')}</h2>
      <p className="text-sm text-muted">{t('teach.cardBody', { count: courses.length })}</p>
      {toGrade > 0 && (
        <span className="self-start">
          <Badge tone="danger">{t('admin.assessments.toGrade', { count: toGrade })}</Badge>
        </span>
      )}
      <Link href={`/${locale}/teach`} className={`${buttonClass('secondary', 'md')} self-start`}>
        {t('teach.openArea')}
      </Link>
    </div>
  );
}
