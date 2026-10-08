'use client';

import { eventStatusLabels } from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DeleteEvent, EventForm, eventStatusTone, toEventForm, type AdminEvent } from '@/components/admin/EventForm';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

export default function EditSession() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<AdminEvent>(`/admin/events/${id}`)
      .then(setEvent)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id, version]);

  if (error) return <Alert tone="danger">{t(error === 'notFound' ? 'errors.notFound' : 'errors.generic')}</Alert>;
  if (!event) return <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <div>
      <Link href={`/${locale}/admin/sessions`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.sessions.title')}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-3xl break-words">{(locale === 'ar' && event.titleAr) || event.titleEn}</h1>
        <Badge tone={eventStatusTone[event.status]}>{eventStatusLabels[event.status][locale]}</Badge>
        {event.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
      </div>
      {event.source === 'import' && <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.sessions.importedHint')}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/admin/sessions/${event.id}/registrations`} className={buttonClass('secondary', 'md')}>
          {t('admin.sessions.registrations')} ({event._count.registrations})
        </Link>
        {event.status !== 'DRAFT' && (
          <a href={`/${locale}/sessions/${event.slug}`} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'md')}>
            {t('admin.sessions.viewPublic')} ↗
          </a>
        )}
        <div className="ms-auto">
          <DeleteEvent event={event} onDone={() => router.push(`/${locale}/admin/sessions`)} />
        </div>
      </div>
      <div className="mt-6">
        {/* Keyed by version: after a save the form restarts from what the server stored. */}
        <EventForm key={version} initial={toEventForm(event)} eventId={event.id} onSaved={() => setVersion((v) => v + 1)} />
      </div>
    </div>
  );
}
