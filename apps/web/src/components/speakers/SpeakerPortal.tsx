'use client';

import {
  PUBLIC_COURSE_STATUSES,
  speakerKindLabels,
  type CourseStatus,
  type MeResponse,
  type SpeakerBookingDto,
  type SpeakerPortalDto,
  type SpeakingSlotDto,
} from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, viewerTimezone } from '@/lib/format';
import { useSearchParam } from '@/lib/use-search-param';
import { BookingForm, type BookingValues } from './BookingForm';
import { byMonth, monthLabel, SPEAKER_APP_TONE, speakerError } from './shared';
import { SpeakerAnnouncements } from './SpeakerAnnouncements';
import { TeachCourses } from '@/components/teach/TeachCourses';

/** /speaker: the speaker's home (application, open slots, bookings). */
export function SpeakerPortal() {
  return <RequireAuth>{(user) => (user.role === 'SPEAKER' ? <Portal user={user} /> : <NotSpeaker user={user} />)}</RequireAuth>;
}

/** Students and admins who open the portal: one account, one role. */
function NotSpeaker({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  return (
    <Container className="max-w-2xl py-10">
      <h1 className="text-3xl">{t('speakers.portal.title')}</h1>
      <Alert tone="info" className="mt-5">
        {user.role === 'ADMIN' ? t('speakers.portal.adminNotice') : t('speakers.portal.studentNotice')}
      </Alert>
      <Link href={user.role === 'ADMIN' ? `/${locale}/admin/speakers/applications` : `/${locale}/dashboard`} className={`${buttonClass('secondary', 'md')} mt-5`}>
        {user.role === 'ADMIN' ? t('speakers.portal.toAdmin') : t('nav.dashboard')}
      </Link>
    </Container>
  );
}

/** Speakers study too: their courses live on the student dashboard ("My learning"). */
function MyLearning({ learning }: { learning: boolean }) {
  const { locale, t } = useI18n();
  if (!learning) {
    return (
      <p className="text-sm text-muted">
        {t('speakers.portal.learning.emptyBody')}{' '}
        <Link href={`/${locale}/courses`} className="font-semibold text-primary underline">
          {t('speakers.portal.learning.browse')}
        </Link>
      </p>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl">{t('speakers.portal.learning.title')}</h2>
          <p className="mt-1 text-muted">{t('speakers.portal.learning.body')}</p>
        </div>
        <Link href={`/${locale}/dashboard`} className={buttonClass('secondary', 'md')}>
          {t('speakers.portal.learning.cta')}
        </Link>
      </div>
    </Card>
  );
}

function Portal({ user }: { user: MeResponse }) {
  const { locale, t } = useI18n();
  const sent = useSearchParam('sent');
  const [data, setData] = useState<SpeakerPortalDto | null>(null);
  const [slots, setSlots] = useState<SpeakingSlotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<SpeakerBookingDto | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<SpeakerPortalDto>('/speaker');
      setData(d);
      setSlots(d.application?.status === 'APPROVED' ? await api<SpeakingSlotDto[]>('/speaker/slots') : []);
    } catch (err) {
      setError(speakerError(err, t));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (confirmed) confirmation.current?.focus();
  }, [confirmed]);

  if (error && !data) {
    return (
      <Container className="py-10">
        <Alert tone="danger">{error}</Alert>
      </Container>
    );
  }
  if (!data || !slots) return <PageSpinner />;
  const app = data.application;
  const upcoming = data.bookings.filter((b) => !b.past).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = data.bookings.filter((b) => b.past);
  const atLimit = upcoming.length >= data.rules.maxOpenBookings;
  const when = (iso: string) => formatDateTime(iso, locale, viewerTimezone());

  return (
    <Container className="max-w-4xl space-y-6 py-8 sm:py-12">
      <div>
        <h1 className="text-3xl sm:text-4xl">{t('speakers.portal.title')}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t('speakers.portal.intro')}</p>
      </div>
      {sent && app?.status === 'SUBMITTED' && <Alert tone="success">{t('speakers.portal.sent')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {user.learning && <MyLearning learning />}

      {confirmed && (
        <div ref={confirmation} tabIndex={-1} className="outline-none">
          <Alert tone="success" title={t('speakers.portal.booked.title')}>
            <p>{t(confirmed.course ? 'speakers.portal.booked.bodyCourse' : 'speakers.portal.booked.body', { title: confirmed.title, when: when(confirmed.startsAt) })}</p>
            <CalendarLinks booking={confirmed} />
          </Alert>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl">{t('speakers.portal.application.title')}</h2>
          {app && <Badge tone={SPEAKER_APP_TONE[app.status]}>{t(`speakers.portal.status.${app.status}`)}</Badge>}
        </div>
        {!app && (
          <>
            <p className="mt-2 text-muted">{t('speakers.portal.application.none')}</p>
            <Link href={`/${locale}/speaker/apply`} className={`${buttonClass('primary', 'md')} mt-4`}>
              {t('speakers.portal.application.apply')}
            </Link>
          </>
        )}
        {app && (
          <div className="mt-3 space-y-3">
            <p className="font-medium text-fg">
              {app.kind !== 'SESSION' && <span className="me-2 inline-block align-middle"><Badge tone="info">{speakerKindLabels[app.kind][locale]}</Badge></span>}
              {app.sessionTitle}
            </p>
            {app.status === 'SUBMITTED' && <p className="text-sm text-muted">{t('speakers.portal.application.waiting', { date: when(app.submittedAt) })}</p>}
            {app.status === 'REJECTED' && (
              <Alert tone="warning" title={t('speakers.portal.application.rejectedTitle')}>
                {app.reviewNote}
              </Alert>
            )}
            {app.status === 'APPROVED' && <p className="text-sm text-muted">{t('speakers.portal.application.approved')}</p>}
            <div className="flex flex-wrap gap-2">
              {app.status !== 'APPROVED' && (
                <Link href={`/${locale}/speaker/apply`} className={buttonClass(app.status === 'REJECTED' ? 'primary' : 'secondary', 'md')}>
                  {app.status === 'REJECTED' ? t('speakers.portal.application.resend') : t('speakers.portal.application.edit')}
                </Link>
              )}
              {data.speakerPageSlug && (
                <Link href={`/${locale}/speakers/${data.speakerPageSlug}`} className={buttonClass('secondary', 'md')}>
                  {t('speakers.portal.publicPage')}
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>

      <TeachCourses />

      <SpeakerAnnouncements />

      {data.bookings.length > 0 && (
        <section aria-labelledby="bookings-h" className="space-y-3">
          <h2 id="bookings-h" className="text-2xl">
            {t('speakers.portal.bookings.title')}
          </h2>
          {upcoming.length > 0 && (
            <ul className="space-y-3">
              {upcoming.map((b) => (
                <UpcomingBooking key={b.slotId} booking={b} cancelDays={data.rules.cancelDays} onChange={load} />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <>
              <h3 className="pt-2 text-lg">{t('speakers.portal.bookings.past')}</h3>
              <ul className="space-y-3">
                {past.map((b) => (
                  <li key={b.slotId}>
                    <Card className="!p-4 sm:!p-5">
                      <p className="font-medium text-fg">{b.title}</p>
                      <p className="mt-1 text-sm text-muted">{when(b.startsAt)}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        {b.event && <span>{t('speakers.portal.bookings.registered', { n: b.event.registered })}</span>}
                        {b.course ? (
                          (PUBLIC_COURSE_STATUSES as readonly string[]).includes(b.course.status) && (
                            <Link href={`/${locale}/courses/${b.course.slug}`} className="font-medium text-primary underline">
                              {t('speakers.portal.bookings.coursePage')}
                            </Link>
                          )
                        ) : b.event?.recordingUrl ? (
                          <a href={b.event.recordingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                            {t('speakers.portal.bookings.recording')}
                          </a>
                        ) : (
                          <span className="text-muted">{t('speakers.portal.bookings.noRecording')}</span>
                        )}
                        {b.event?.status === 'PUBLISHED' && (
                          <Link href={`/${locale}/sessions/${b.event.slug}`} className="font-medium text-primary underline">
                            {t('speakers.portal.bookings.sessionPage')}
                          </Link>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {app?.status === 'APPROVED' && (
        <section aria-labelledby="slots-h" className="space-y-3">
          <h2 id="slots-h" className="text-2xl">
            {t('speakers.portal.slots.title')}
          </h2>
          <p className="text-sm text-muted">{t('speakers.portal.slots.rules', { max: data.rules.maxOpenBookings, days: data.rules.cancelDays })}</p>
          {atLimit && <Alert tone="info">{t('speakers.portal.slots.atLimit', { max: data.rules.maxOpenBookings })}</Alert>}
          {slots.length === 0 && <p className="rounded-card border border-dashed border-line-strong/50 p-6 text-center text-muted">{t('speakers.portal.slots.none')}</p>}
          {byMonth(slots).map(([month, list]) => (
            <Card key={month} className="!p-0">
              <h3 className="border-b border-line px-5 py-3 text-lg">{monthLabel(month, locale)}</h3>
              <ul className="divide-y divide-line">
                {list.map((s) => (
                  <SlotRow
                    key={s.id}
                    slot={s}
                    disabled={atLimit}
                    defaults={{ title: app.sessionTitle, abstract: app.abstract, kind: app.kind, details: app.details }}
                    onBooked={(b) => {
                      setConfirmed(b);
                      void load();
                    }}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </section>
      )}

      {!user.learning && <MyLearning learning={false} />}
    </Container>
  );
}

function CalendarLinks({ booking }: { booking: SpeakerBookingDto }) {
  const { locale, t } = useI18n();
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <a href={booking.calendarUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
        {t('speakers.portal.calendar.google')}
      </a>
      <a href={`/api/speaker/slots/${booking.slotId}/calendar.ics?locale=${locale}`} className="font-medium underline">
        {t('speakers.portal.calendar.ics')}
      </a>
    </p>
  );
}

function SlotRow({
  slot,
  disabled,
  defaults,
  onBooked,
}: {
  slot: SpeakingSlotDto;
  disabled: boolean;
  defaults: BookingValues;
  onBooked: (b: SpeakerBookingDto) => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-fg">{formatDateTime(slot.startsAt, locale, viewerTimezone())}</p>
          <p className="text-sm text-muted">{t('speakers.portal.slots.minutes', { n: slot.durationMin })}</p>
        </div>
        {!open && (
          <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
            {t('speakers.portal.slots.book')}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-muted-bg p-4">
          <BookingForm
            initial={defaults}
            submitLabel={t('speakers.portal.slots.confirm')}
            submit={async (body) => onBooked(await api<SpeakerBookingDto>(`/speaker/slots/${slot.id}/booking`, { method: 'POST', json: body }))}
            extra={
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('speakers.portal.slots.back')}
              </Button>
            }
          />
        </div>
      )}
    </li>
  );
}

function UpcomingBooking({ booking: b, cancelDays, onChange }: { booking: SpeakerBookingDto; cancelDays: number; onChange: () => Promise<void> }) {
  const { locale, t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A course booking is followed through its course; a session or podcast, through its session.
  const status = b.course ? courseProgress(b.course.status) : (b.event?.status ?? 'DRAFT');
  const coursePublic = b.course && (PUBLIC_COURSE_STATUSES as readonly string[]).includes(b.course.status);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/speaker/slots/${b.slotId}/booking`, { method: 'DELETE' });
      await onChange();
    } catch (err) {
      setError(speakerError(err, t));
      setBusy(false);
    }
  }

  return (
    <li>
      <Card className="!p-4 sm:!p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium break-words text-fg">
              {b.kind !== 'SESSION' && <span className="me-2 inline-block align-middle"><Badge tone="info">{speakerKindLabels[b.kind][locale]}</Badge></span>}
              {b.title}
            </p>
            <p className="mt-1 text-sm text-muted">{formatDateTime(b.startsAt, locale, viewerTimezone())}</p>
          </div>
          <Badge tone={status === 'PUBLISHED' ? 'success' : status === 'CANCELLED' ? 'danger' : 'info'}>{t(`speakers.portal.bookings.event.${status}`)}</Badge>
        </div>
        <CalendarLinks booking={b} />
        {editing && (
          <div className="mt-3 rounded-xl bg-muted-bg p-4">
            <BookingForm
              initial={{ title: b.title, abstract: b.abstract, kind: b.kind, details: b.details }}
              detailsOpen
              submitLabel={t('speakers.portal.bookings.saveDetails')}
              submit={async (body) => {
                await api<SpeakerBookingDto>(`/speaker/slots/${b.slotId}/booking`, { method: 'PUT', json: body });
                setEditing(false);
                await onChange();
              }}
              extra={
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {t('speakers.portal.slots.back')}
                </Button>
              }
            />
          </div>
        )}
        {b.course?.status === 'DRAFT' && <p className="mt-2 text-sm text-body">{t('speakers.portal.bookings.courseDraft')}</p>}
        {coursePublic && b.course && (
          <p className="mt-2 text-sm">
            <Link href={`/${locale}/courses/${b.course.slug}`} className="font-medium text-primary underline">
              {t('speakers.portal.bookings.coursePage')}
            </Link>
          </p>
        )}
        {status === 'PUBLISHED' && b.event && (
          <p className="mt-2 text-sm">
            <Link href={`/${locale}/sessions/${b.event.slug}`} className="font-medium text-primary underline">
              {t('speakers.portal.bookings.sessionPage')}
            </Link>{' '}
            · {t('speakers.portal.bookings.registered', { n: b.event.registered })}
          </p>
        )}
        {error && (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {b.canEdit && !editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t('speakers.portal.bookings.editDetails')}
            </Button>
          )}
          {!b.canEdit && <span className="text-xs text-muted">{t('speakers.portal.bookings.lockedHint')}</span>}
          {b.canCancel ? (
            confirming ? (
              <>
                <span className="text-sm">{t('speakers.portal.bookings.cancelConfirm')}</span>
                <Button variant="danger" size="sm" loading={busy} onClick={cancel}>
                  {t('speakers.portal.bookings.cancelYes')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  {t('speakers.portal.slots.back')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                  {t('speakers.portal.bookings.cancel')}
                </Button>
                <span className="text-xs text-muted">{t('speakers.portal.bookings.cancelUntil', { date: formatDateTime(b.cancelUntil, locale, viewerTimezone()) })}</span>
              </>
            )
          ) : (
            <span className="text-sm text-muted">{t('speakers.portal.bookings.tooLate', { days: cancelDays })}</span>
          )}
        </div>
      </Card>
    </li>
  );
}

/** Where a course booking stands, in the words used for sessions: being prepared, published, or cancelled (archived). */
function courseProgress(status: CourseStatus): 'DRAFT' | 'PUBLISHED' | 'CANCELLED' {
  if (status === 'DRAFT') return 'DRAFT';
  return status === 'ARCHIVED' ? 'CANCELLED' : 'PUBLISHED';
}
