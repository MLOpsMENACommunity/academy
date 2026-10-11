'use client';

import { courseStatusLabels, eventStatusLabels, speakerKindLabels, type CourseDraftResultDto, type CourseStatus, type EventStatus } from '@academy/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DeleteEvent, EventForm, eventStatusTone, toEventForm, type AdminEvent } from '@/components/admin/EventForm';
import { speakerError } from '@/components/speakers/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';

export default function EditSession() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<'notFound' | 'generic' | null>(null);
  const [version, setVersion] = useState(0);
  // What the last save did: the form restarts after a save, so the page says it.
  const [notice, setNotice] = useState<{ status: EventStatus; published: boolean } | null>(null);

  useEffect(() => {
    api<AdminEvent>(`/admin/events/${id}`)
      .then(setEvent)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notFound' : 'generic'));
  }, [id, version]);

  if (error) return <Alert tone="danger">{t(error === 'notFound' ? 'errors.notFound' : 'errors.generic')}</Alert>;
  if (!event) return <p className="text-muted">{t('admin.common.loading')}</p>;

  const booking = event.speakingSlot ?? null;
  const kind = booking?.kind ?? null;

  return (
    <div>
      <Link href={`/${locale}/admin/sessions`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('admin.sessions.title')}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-3xl break-words">{(locale === 'ar' && event.titleAr) || event.titleEn}</h1>
        <Badge tone={eventStatusTone[event.status]}>{eventStatusLabels[event.status][locale]}</Badge>
        {kind && kind !== 'SESSION' && <Badge tone="primary">{speakerKindLabels[kind][locale]}</Badge>}
        {event.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
      </div>
      {event.source === 'import' && <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.sessions.importedHint')}</p>}
      {booking?.bookedBy && (
        <p className="mt-2 max-w-2xl text-sm break-words text-muted">
          {t('admin.sessions.bookedBy', { name: booking.bookedBy.speakerApplication?.fullName ?? booking.bookedBy.email })}{' '}
          <Link href={`/${locale}/admin/speakers/availability`} className="text-primary underline">
            {t('admin.sessions.openAvailability')}
          </Link>
        </p>
      )}
      {notice && (
        <Alert tone={notice.status === 'DRAFT' ? 'warning' : 'success'} className="mt-4">
          {notice.status === 'DRAFT'
            ? t('admin.sessions.publish.savedDraft')
            : notice.published
              ? t('admin.sessions.publish.published')
              : `✓ ${t('admin.common.saved')}`}
        </Alert>
      )}
      {booking && kind === 'COURSE' && (
        <CourseFromBooking
          slotId={booking.id}
          course={booking.course ?? null}
          eventStatus={event.status}
          onCreated={(r) => router.push(`/${locale}/admin/courses/${r.courseId}`)}
        />
      )}
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
        {/* Keyed by the stored version: after a save (once it is reloaded) the form restarts from what the server stored. */}
        <EventForm
          key={event.updatedAt}
          initial={toEventForm(event)}
          initialDetails={event.details}
          eventId={event.id}
          onSaved={(_id, status) => {
            setNotice({ status, published: status === 'PUBLISHED' && event.status !== 'PUBLISHED' });
            setVersion((v) => v + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>
    </div>
  );
}

/**
 * A course booked as a session before course drafts existed: make its draft course (or open
 * the one it already has). Idempotent on the server.
 */
function CourseFromBooking({
  slotId,
  course,
  eventStatus,
  onCreated,
}: {
  slotId: string;
  course: { id: string; slug: string; status: CourseStatus } | null;
  eventStatus: EventStatus;
  onCreated: (r: CourseDraftResultDto) => void;
}) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (course) {
    return (
      <Alert tone="info" className="mt-4">
        {t('admin.sessions.courseLinked', { status: courseStatusLabels[course.status][locale] })}{' '}
        <Link href={`/${locale}/admin/courses/${course.id}`} className="font-semibold underline">
          {t('admin.slots.openCourse')}
        </Link>
      </Alert>
    );
  }

  async function run() {
    if (!window.confirm(t(eventStatus === 'DRAFT' ? 'admin.slots.courseDraftConfirm' : 'admin.slots.courseDraftConfirmKeep'))) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<CourseDraftResultDto>(`/admin/speaking-slots/${slotId}/course-draft`, { method: 'POST' }));
    } catch (err) {
      setError(speakerError(err, t));
      setBusy(false);
    }
  }

  return (
    <Alert tone="info" className="mt-4" title={t('admin.sessions.courseBooking')}>
      <p>{t('admin.sessions.courseBookingHint')}</p>
      <Button type="button" variant="secondary" size="sm" className="mt-3" loading={busy} onClick={run}>
        {t('admin.slots.createCourseDraft')}
      </Button>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </Alert>
  );
}
