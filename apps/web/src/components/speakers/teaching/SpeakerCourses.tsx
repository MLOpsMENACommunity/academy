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

/** Speaker portal → My courses: the courses an admin assigned to this speaker, to teach. Nothing renders without any. */
export function SpeakerCourses() {
  const { locale, t } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`speakerTeaching.${k}`, v);
  const [courses, setCourses] = useState<TeachingCourseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<TeachingCourseDto[]>('/speaker/courses')
      .then(setCourses)
      .catch((err: unknown) => setError(errorMessage(err, t)));
  }, [t]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!courses?.length) return null;

  return (
    <section aria-labelledby="my-courses-h" className="space-y-3">
      <div>
        <h2 id="my-courses-h" className="text-2xl">
          {m('myCourses')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{m('myCoursesIntro')}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses.map((c) => (
          <li key={c.id}>
            <Card className="flex h-full flex-col gap-3 !p-4 sm:!p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-semibold break-words text-fg">{locale === 'ar' ? c.titleAr : c.titleEn}</p>
                <Badge tone={c.status === 'OPEN' ? 'success' : 'neutral'}>{courseStatusLabels[c.status][locale]}</Badge>
              </div>
              <p className="text-sm text-muted">
                {m('students', { count: c.students })} · {m('assessments', { count: c.assessments })}
              </p>
              {c.toGrade > 0 && (
                <span className="self-start">
                  <Badge tone="danger">{t('admin.assessments.toGrade', { count: c.toGrade })}</Badge>
                </span>
              )}
              <Link href={`/${locale}/speaker/courses/${c.id}`} className={`${buttonClass('primary', 'md')} mt-auto self-start`}>
                {m('open')}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
