'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EMPTY_EVENT, EventForm } from '@/components/admin/EventForm';
import { useI18n } from '@/i18n/client';

export default function NewSession() {
  const { locale, t } = useI18n();
  const router = useRouter();
  return (
    <div>
      <Link href={`/${locale}/admin/sessions`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="me-1 inline-block rtl:-scale-x-100">←</span>{t('admin.sessions.title')}
      </Link>
      <h1 className="mt-1 text-3xl">{t('admin.sessions.new')}</h1>
      <div className="mt-5">
        <EventForm initial={EMPTY_EVENT} onSaved={(id) => router.replace(`/${locale}/admin/sessions/${id}`)} />
      </div>
    </div>
  );
}
