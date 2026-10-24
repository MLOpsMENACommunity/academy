'use client';

import { CONSULTATION_RESCHEDULE_HOURS, CONSULTATION_WALLET_LABELS, googleCalendarLink, type MyConsultationDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button, ButtonLink, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';
import { egp, ExpertAvatar, expertName, StatusBadge, whenLabel } from './shared';
import { SlotPicker } from './SlotPicker';

/**
 * One of the student's paid calls, by status: the payment is being checked; it was rejected (why);
 * it's confirmed and they book a time; the call is booked (link, calendar, move once); cancelled.
 */
export function BookingView({ id }: { id: string }) {
  const { locale, t } = useI18n();
  const [b, setB] = useState<MyConsultationDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [tz, setTz] = useState('Africa/Cairo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setTz(viewerTimezone());
    api<MyConsultationDto>(`/consultations/bookings/${id}`)
      .then(setB)
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(errorMessage(err, t))));
  }, [id, t]);

  if (missing) return <Alert tone="warning">{t('consultations.booking.notFound')}</Alert>;
  if (!b) return error ? <Alert tone="danger">{error}</Alert> : <PageSpinner />;

  const name = expertName(b.consultant, locale);

  /** Books the chosen time (paid call), or moves the booked call there. */
  async function submitTime(kind: 'book' | 'reschedule') {
    if (!time) return;
    setBusy(true);
    setError(null);
    try {
      setB(await api<MyConsultationDto>(`/consultations/bookings/${id}/${kind}`, { method: 'POST', json: { startsAt: time } }));
      setMoving(false);
      setTime(null);
    } catch (err) {
      setError(errorMessage(err, t));
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') setReloadKey((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const picker = (kind: 'book' | 'reschedule') => (
    <>
      <SlotPicker url={`/consultations/bookings/${b.id}/slots`} horizonDays={b.consultant.horizonDays} value={time} onChange={setTime} reloadKey={reloadKey} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={kind === 'book' ? 'accent' : 'primary'} size="lg" onClick={() => void submitTime(kind)} disabled={!time} loading={busy}>
          {t(kind === 'book' ? 'consultations.booking.bookYes' : 'consultations.booking.moveYes')}
        </Button>
        {kind === 'reschedule' && (
          <Button type="button" variant="secondary" size="lg" onClick={() => setMoving(false)} disabled={busy}>
            {t('consultations.booking.keep')}
          </Button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/${locale}/consultations/bookings`} className="text-[0.9375rem] text-muted hover:text-fg">
        {t('consultations.mine.back')}
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <ExpertAvatar name={name} photoUrl={b.consultant.photoUrl} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.5rem] sm:text-[1.75rem]">{t('consultations.booking.title', { name })}</h1>
          <p className="mt-1 text-muted">
            {b.startsAt ? `${whenLabel(b.startsAt, locale, tz)} · ` : ''}
            {t('consultations.minutes', { min: b.durationMin })} · {egp(b.priceEgp, locale)}
          </p>
        </div>
        <StatusBadge status={b.status} t={t} />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{t('consultations.booking.reference')}</dt>
        <dd className="font-medium text-fg tabular-nums">{b.reference}</dd>
        <dt className="text-muted">{t('consultations.booking.paidWith')}</dt>
        <dd className="text-body">
          {CONSULTATION_WALLET_LABELS[b.method][locale]}
          {b.transactionRef && <span dir="ltr"> · {b.transactionRef}</span>}
        </dd>
        {b.note && (
          <>
            <dt className="text-muted">{t('consultations.booking.note')}</dt>
            <dd className="whitespace-pre-line text-body">{b.note}</dd>
          </>
        )}
      </dl>

      {b.status === 'PAYMENT_REVIEW' && <Alert tone="info" title={t('consultations.booking.reviewTitle')}>{t('consultations.booking.reviewBody')}</Alert>}

      {b.status === 'REJECTED' && (
        <Alert tone="warning" title={t('consultations.booking.rejectedTitle')}>
          {b.rejectionReason && <span className="block">{t('consultations.booking.reason', { reason: b.rejectionReason })}</span>}
          <span className="block">{t('consultations.booking.rejectedBody')}</span>
          <Link href={`/${locale}/consultations/${b.consultant.slug}`} className="mt-1 inline-block font-medium underline">
            {t('consultations.booking.payAgain')}
          </Link>
        </Alert>
      )}

      {b.canBook && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.bookTitle')}</h2>
          <p className="text-[0.9375rem] text-body">{t('consultations.booking.bookBody')}</p>
          {picker('book')}
        </Card>
      )}

      {b.status === 'CONFIRMED' && b.meetingUrl && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.meetingTitle')}</h2>
          <a href={b.meetingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
            {b.meetingUrl}
          </a>
          {b.startsAt && b.endsAt && (
            <div className="flex flex-wrap gap-2">
              <a
                href={googleCalendarLink({ title: t('consultations.booking.calendarTitle', { name }), start: b.startsAt, end: b.endsAt, details: typeof window === 'undefined' ? '' : window.location.href })}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('secondary', 'md')}
              >
                {t('consultations.booking.addGoogle')}
              </a>
              <a href={`/api/consultations/bookings/${b.id}/calendar.ics`} className={buttonClass('secondary', 'md')}>
                {t('consultations.booking.downloadIcs')}
              </a>
            </div>
          )}
        </Card>
      )}

      {b.status === 'CONFIRMED' && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.moveTitle')}</h2>
          {b.canReschedule ? (
            moving ? (
              picker('reschedule')
            ) : (
              <>
                <p className="text-[0.9375rem] text-body">{t('consultations.booking.moveRule', { hours: CONSULTATION_RESCHEDULE_HOURS })}</p>
                <Button type="button" variant="secondary" className="self-start" onClick={() => setMoving(true)}>
                  {t('consultations.booking.move')}
                </Button>
              </>
            )
          ) : (
            <p className="text-[0.9375rem] text-muted">
              {t(b.rescheduleCount > 0 ? 'consultations.booking.movedAlready' : 'consultations.booking.moveTooLate', { hours: CONSULTATION_RESCHEDULE_HOURS })}
            </p>
          )}
          <p className="text-[0.875rem] text-muted">{t('consultations.booking.noRefund')}</p>
        </Card>
      )}

      {b.status === 'CANCELLED' && (
        <Alert tone="info">
          {t('consultations.booking.cancelledAt', { time: whenLabel(b.cancelledAt ?? b.createdAt, locale, tz) })}
          {b.cancelReason && <span className="block">{t('consultations.booking.reason', { reason: b.cancelReason })}</span>}
          {b.paidAt && <span className="block">{t('consultations.booking.refundNote')}</span>}
        </Alert>
      )}

      <ButtonLink href={`/${locale}/consultations`} variant="ghost" className="self-start">
        {t('consultations.mine.findExpert')}
      </ButtonLink>
    </div>
  );
}
