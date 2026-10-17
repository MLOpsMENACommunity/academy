'use client';

import { useParams } from 'next/navigation';
import { ApplicationDetail } from '@/components/admin/ApplicationDetail';
import { useI18n } from '@/i18n/client';

export default function ApplicationDetailAdmin() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  return <ApplicationDetail id={id} back={{ href: `/${locale}/admin/applications`, label: t('admin.apps.title') }} />;
}
