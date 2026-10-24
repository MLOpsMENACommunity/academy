'use client';

import { CONSULTATION_RESCHEDULE_HOURS, CONSULTATION_WALLET_LABELS, googleCalendarLink, whatsappUrl, type MyConsultationDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TextField } from '@/components/forms/fields';
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

/** One of the student's bookings: how to pay while it waits, the link once paid, and cancelling. */
export function BookingView({ id }: { id: string }) {
  const { locale, t } = useI18n();
  const [b, setB] = useState<MyConsultationDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [tz, setTz] = useState('Africa/Cairo');
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);
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
  const pay = b.payment;
  const waText = locale === 'ar' ? `دفع حجز المكالمة ${b.reference}` : `Payment for consultation ${b.reference}`;

  async function reschedule() {
    if (!newTime) return;
    setBusy(true);
    setError(null);
    try {
      setB(await api<MyConsultationDto>(`/consultations/bookings/${id}/reschedule`, { method: 'POST', json: { startsAt: newTime } }));
      setMoving(false);
      setNewTime(null);
    } catch (err) {
      setError(errorMessage(err, t));
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') setReloadKey((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      setB(await api<MyConsultationDto>(`/consultations/bookings/${id}/cancel`, { method: 'POST', json: { reason } }));
      setConfirming(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

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
            {whenLabel(b.startsAt, locale, tz)} · {t('consultations.minutes', { min: b.durationMin })} · {egp(b.priceEgp, locale)}
          </p>
        </div>
        <StatusBadge status={b.status} t={t} />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{t('consultations.booking.reference')}</dt>
        <dd className="font-medium text-fg tabular-nums">{b.reference}</dd>
        {b.note && (
          <>
            <dt className="text-muted">{t('consultations.booking.note')}</dt>
            <dd className="whitespace-pre-line text-body">{b.note}</dd>
          </>
        )}
      </dl>

      {b.status === 'AWAITING_PAYMENT' && pay && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.payTitle')}</h2>
          <ol className="flex list-decimal flex-col gap-2 ps-5 text-[0.9375rem] leading-relaxed text-body">
            <li>
              {t('consultations.booking.payStep1', { price: egp(b.priceEgp, locale) })}
              <ul className="mt-2 flex flex-col gap-1.5">
                {pay.methods.map((m) => (
                  <li key={m.kind} className="rounded-lg bg-muted-bg px-3 py-2">
                    <span className="font-medium text-fg">{CONSULTATION_WALLET_LABELS[m.kind][locale]}</span>{' '}
                    <span dir="ltr" className="tabular-nums select-all">
                      {m.handle}
                    </span>
                    {m.name && <span className="block text-[0.875rem] text-muted">{t('consultations.booking.payName', { name: m.name })}</span>}
                  </li>
                ))}
              </ul>
            </li>
            <li>{t('consultations.booking.payStep2', { ref: b.reference })}</li>
          </ol>
          {pay.supportWhatsapp && (
            <a
              href={`${whatsappUrl(pay.supportWhatsapp)}?text=${encodeURIComponent(waText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('accent', 'lg', 'self-start')}
            >
              {t('consultations.booking.whatsapp')}
            </a>
          )}
          {b.holdUntil && <p className="text-[0.9375rem] text-body">{t('consultations.booking.holdUntil', { time: whenLabel(b.holdUntil, locale, tz) })}</p>}
          <p className="text-[0.875rem] text-muted">{t('consultations.booking.afterPay')}</p>
        </Card>
      )}

      {b.status === 'CONFIRMED' && b.meetingUrl && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.meetingTitle')}</h2>
          <a href={b.meetingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
            {b.meetingUrl}
          </a>
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
        </Card>
      )}

      {b.status === 'EXPIRED' && (
        <Alert tone="warning">
          {t('consultations.booking.expired')}{' '}
          <Link href={`/${locale}/consultations/${b.consultant.slug}`} className="font-medium underline">
            {t('consultations.booking.bookAgain')}
          </Link>
        </Alert>
      )}
      {b.status === 'CANCELLED' && (
        <Alert tone="info">
          {t('consultations.booking.cancelledAt', { time: whenLabel(b.cancelledAt ?? b.startsAt, locale, tz) })}
          {b.cancelReason && <span className="block">{t('consultations.booking.reason', { reason: b.cancelReason })}</span>}
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {b.status === 'CONFIRMED' && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[1.25rem]">{t('consultations.booking.moveTitle')}</h2>
          {b.canReschedule ? (
            moving ? (
              <>
                <SlotPicker slug={b.consultant.slug} duration={b.durationMin} horizonDays={30} value={newTime} onChange={setNewTime} reloadKey={reloadKey} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void reschedule()} disabled={!newTime} loading={busy}>
                    {t('consultations.booking.moveYes')}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setMoving(false)} disabled={busy}>
                    {t('consultations.booking.keep')}
                  </Button>
                </div>
              </>
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

      {b.canCancel ? (
        confirming ? (
          <Card className="flex flex-col gap-3 p-5">
            <p className="font-medium text-fg">{t('consultations.booking.cancelConfirm')}</p>
            <TextField label={t('consultations.booking.cancelReason')} value={reason} onChange={setReason} maxLength={500} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" onClick={() => void cancel()} loading={busy}>
                {t('consultations.booking.cancelYes')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                {t('consultations.booking.keep')}
              </Button>
            </div>
          </Card>
        ) : (
          <Button type="button" variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
            {t('consultations.booking.cancel')}
          </Button>
        )
      ) : null}

      <ButtonLink href={`/${locale}/consultations`} variant="ghost" className="self-start">
        {t('consultations.mine.findExpert')}
      </ButtonLink>
    </div>
  );
}
