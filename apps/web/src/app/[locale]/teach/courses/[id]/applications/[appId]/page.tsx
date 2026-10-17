'use client';

import { useParams } from 'next/navigation';
import { ApplicationDetail } from '@/components/admin/ApplicationDetail';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Container } from '@/components/ui/Container';
import { useI18n } from '@/i18n/client';

/** Teaching → {course} → Applications → one application (MANAGE_APPLICATIONS). */
export default function TeachApplicationPage() {
  const { locale, t } = useI18n();
  const { id, appId } = useParams<{ id: string; appId: string }>();
  return (
    <RequireAuth>
      {() => (
        <Container className="py-6 sm:py-10">
          <ApplicationDetail
            id={appId}
            apiBase={`/teach/courses/${id}`}
            back={{ href: `/${locale}/teach/courses/${id}?tab=applications`, label: t('teach.tabs.applications') }}
          />
        </Container>
      )}
    </RequireAuth>
  );
}
