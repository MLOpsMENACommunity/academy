'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { InstructorForm, toSpeakerInput } from '@/components/admin/InstructorEditor';
import { SpeakerProfileExtras, type SpeakerAccountInfo } from '@/components/admin/SpeakerProfileExtras';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import type { AdminSpeaker } from '../types';

export default function EditSpeaker() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [speaker, setSpeaker] = useState<(AdminSpeaker & SpeakerAccountInfo) | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<AdminSpeaker & SpeakerAccountInfo>(`/admin/instructors/${id}`)
      .then(setSpeaker)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id, version]);

  if (error) return <Alert tone="danger">{t(error === 'notFound' ? 'errors.notFound' : 'errors.generic')}</Alert>;
  if (!speaker) return <p className="text-muted">{t('admin.common.loading')}</p>;
  const visible = Boolean(speaker.slug) && speaker.courses + speaker.events > 0;

  return (
    <div>
      <Link href={`/${locale}/admin/speakers`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.speakers.title')}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-3xl break-words">{(locale === 'ar' && speaker.nameAr) || speaker.name}</h1>
        {speaker.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">{t('admin.speakers.appearances', { courses: speaker.courses, events: speaker.events })}</p>
      {speaker.source === 'import' && <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.speakers.importedHint')}</p>}
      {visible && (
        <a href={`/${locale}/speakers/${speaker.slug}`} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'md', 'mt-3 -ms-3')}>
          {t('admin.speakers.viewPublic')} ↗
        </a>
      )}
      <Card className="mt-5">
        {/* Keyed by version: after a save the form restarts from what the server stored. */}
        <InstructorForm
          key={version}
          standalone
          id={speaker.id}
          initial={toSpeakerInput(speaker)}
          onSaved={() => {
            setSaved(true);
            setVersion((v) => v + 1);
          }}
        />
        <p role="status" className="mt-3 text-sm text-success">
          {saved ? `✓ ${t('admin.common.saved')}` : ''}
        </p>
      </Card>
      <SpeakerProfileExtras speaker={speaker} onDeleted={() => router.push(`/${locale}/admin/speakers?deleted=1`)} />
    </div>
  );
}
