'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EMPTY_SPEAKER, InstructorForm } from '@/components/admin/InstructorEditor';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';

export default function NewSpeaker() {
  const { locale, t } = useI18n();
  const router = useRouter();
  return (
    <div>
      <Link href={`/${locale}/admin/speakers`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.speakers.title')}
      </Link>
      <h1 className="mt-1 text-3xl">{t('admin.speakers.new')}</h1>
      <Card className="mt-5">
        <InstructorForm standalone initial={EMPTY_SPEAKER} onSaved={(s) => router.replace(`/${locale}/admin/speakers/${s.id}`)} />
      </Card>
    </div>
  );
}
