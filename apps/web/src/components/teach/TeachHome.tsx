'use client';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { Container } from '@/components/ui/Container';
import { useI18n } from '@/i18n/client';
import { TeachCourses } from './TeachCourses';

/** /teach: every course I'm on the staff of, whatever my account role (speaker, student, admin). */
export function TeachHome() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      {() => (
        <Container className="py-6 sm:py-10">
          <h1 className="text-2xl sm:text-3xl">{t('teach.title')}</h1>
          <p className="mt-2 mb-6 max-w-3xl text-muted">{t('teach.intro')}</p>
          <TeachCourses variant="page" />
        </Container>
      )}
    </RequireAuth>
  );
}
