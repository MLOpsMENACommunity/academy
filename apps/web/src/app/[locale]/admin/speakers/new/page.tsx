'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EMPTY_SPEAKER, InstructorForm } from '@/components/admin/InstructorEditor';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { useSearchParam } from '@/lib/use-search-param';

export default function NewSpeaker() {
  const { locale, t } = useI18n();
  const router = useRouter();
  // "Invite speaker": their public profile first, then the account form on the profile page.
  const inviting = useSearchParam('invite') === '1';
  return (
    <div>
      <Link href={`/${locale}/admin/speakers`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.speakers.title')}
      </Link>
      <h1 className="mt-1 text-3xl">{t(inviting ? 'admin.speakers.invite' : 'admin.speakers.new')}</h1>
      {inviting && <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.speakers.inviteIntro')}</p>}
      <Card className="mt-5">
        <InstructorForm standalone initial={EMPTY_SPEAKER} onSaved={(s) => router.replace(`/${locale}/admin/speakers/${s.id}${inviting ? '?invite=1' : ''}`)} />
      </Card>
    </div>
  );
}
