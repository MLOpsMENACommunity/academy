'use client';

import type { LearnCourseDto } from '@academy/shared';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { useI18n } from '@/i18n/client';

/** Risk 1: recordings are shared with one Google account; say which, and whether it's done yet. */
export function DriveNote({ course }: { course: LearnCourseDto }) {
  const { locale, t } = useI18n();
  if (!course.googleEmail) {
    return (
      <Alert tone="warning">
        {t('learn.driveNoEmail')}{' '}
        <Link href={`/${locale}/profile?tab=core`} className="font-semibold underline">
          {t('learn.addGoogleEmail')}
        </Link>
      </Alert>
    );
  }
  return (
    <Alert tone="info">
      {course.driveAccessGranted
        ? t('learn.driveNote', { email: course.googleEmail })
        : t('learn.driveSetup', { email: course.googleEmail })}
    </Alert>
  );
}
