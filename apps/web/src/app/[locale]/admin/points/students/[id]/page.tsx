'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { StudentPoints } from '@/components/admin/StudentPoints';
import { useI18n } from '@/i18n/client';

/**
 * Admin → Points & badges → one student: their ledger, badges and the award forms. The
 * course leaderboard links here, so the academic preset (which can't open the admissions
 * student page) can award, edit and remove points and badges. From there (`?course=`), the
 * back link returns to that course's leaderboard.
 */
export default function AdminStudentPointsPage() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const course = useSearchParams().get('course');
  return (
    <div className="space-y-5">
      <Link
        href={course ? `/${locale}/admin/courses/${encodeURIComponent(course)}?tab=leaderboard` : `/${locale}/admin/points`}
        className="text-sm text-primary hover:underline"
      >
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {course ? t('admin.points.backToBoard') : t('admin.points.pageTitle')}
      </Link>
      <StudentPoints studentId={id} heading />
    </div>
  );
}
