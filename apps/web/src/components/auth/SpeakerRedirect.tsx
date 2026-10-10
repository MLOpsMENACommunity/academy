'use client';

import { homePath } from '@academy/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useI18n } from '@/i18n/client';
import { PageSpinner } from '../ui/Spinner';

/** Student-only pages send a speaker account to the speaker portal (one account, one role). */
export function SpeakerRedirect() {
  const { locale } = useI18n();
  const router = useRouter();
  useEffect(() => {
    router.replace(homePath('SPEAKER', locale));
  }, [router, locale]);
  return <PageSpinner />;
}
