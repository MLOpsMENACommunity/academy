'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { StudentPoints } from '@/components/admin/StudentPoints';
import { useI18n } from '@/i18n/client';

/**
 * Admin → Points & badges → one student: their ledger, badges and the award forms. The
 * course leaderboard links here, so the academic preset (which can't open the admissions
 * student page) can award, edit and remove points and badges.
 */
export default function AdminStudentPointsPage() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-5">
      <Link href={`/${locale}/admin/points`} className="text-sm text-primary hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.points.pageTitle')}
      </Link>
      <StudentPoints studentId={id} heading />
    </div>
  );
}
