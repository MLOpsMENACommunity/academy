'use client';

import { ChallengesManager } from '@/components/challenges/ChallengesManager';
import { useI18n } from '@/i18n/client';

/** Admin → Challenges (ACADEMIC): every challenge, open to everyone or of one course, and the entries to review. */
export default function AdminChallenges() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">{t('challenges.manage.pageTitle')}</h1>
        <p className="mt-1 max-w-3xl text-muted">{t('challenges.manage.pageIntro')}</p>
      </div>
      <ChallengesManager apiBase="/admin/challenges" canManage canReview pickCourse />
    </div>
  );
}
