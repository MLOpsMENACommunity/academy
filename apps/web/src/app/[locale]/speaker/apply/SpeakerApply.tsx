'use client';

import type { MeResponse, SpeakerPortalDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SpeakerApplicationForm } from '@/components/speakers/SpeakerApplicationForm';
import { speakerError } from '@/components/speakers/shared';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

export function SpeakerApply() {
  return <RequireAuth>{(user) => <Inner me={user} />}</RequireAuth>;
}

function Inner({ me }: { me: MeResponse }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<SpeakerPortalDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const speaker = me.role === 'SPEAKER';
  useEffect(() => {
    if (speaker) api<SpeakerPortalDto>('/speaker').then(setData).catch((err) => setError(speakerError(err, t)));
  }, [speaker, t]);

  const back = (
    <Link href={`/${locale}/speaker`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
      <span aria-hidden className="inline-block rtl:rotate-180">←</span>&nbsp;{t('speakers.portal.title')}
    </Link>
  );
  if (!speaker) {
    return (
      <Container className="max-w-2xl py-10">
        {back}
        <Alert tone="info" className="mt-3">
          {me.role === 'ADMIN' ? t('speakers.portal.adminNotice') : t('speakers.portal.studentNotice')}
        </Alert>
      </Container>
    );
  }
  if (error) return <Container className="py-10"><Alert tone="danger">{error}</Alert></Container>;
  if (!data) return <PageSpinner />;
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      {back}
      <h1 className="mt-1 text-3xl sm:text-4xl">{t('speakers.portal.form.heading')}</h1>
      <p className="mt-2 mb-6 max-w-2xl text-muted">{t('speakers.portal.form.intro')}</p>
      {data.application?.status === 'APPROVED' ? (
        <Alert tone="success">{t('speakers.portal.application.approved')}</Alert>
      ) : (
        <SpeakerApplicationForm me={me} application={data.application} />
      )}
    </Container>
  );
}
