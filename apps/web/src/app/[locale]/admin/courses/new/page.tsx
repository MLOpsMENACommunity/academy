'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CourseForm, EMPTY_COURSE } from '@/components/admin/CourseForm';
import { useI18n } from '@/i18n/client';

export default function NewCourse() {
  const { locale, t } = useI18n();
  const router = useRouter();
  return (
    <div>
      <Link href={`/${locale}/admin/courses`} className="text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.courses.title')}
      </Link>
      <h1 className="mt-2 text-3xl">{t('admin.courses.new')}</h1>
      <div className="mt-5">
        <CourseForm initial={EMPTY_COURSE} onSaved={(id) => router.replace(`/${locale}/admin/courses/${id}`)} />
      </div>
    </div>
  );
}
