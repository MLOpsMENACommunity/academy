'use client';

import type { ConsultantSettingsDto, ConsultationBookingAdminDto, ExpertOverviewDto, GoogleCalendarStatusDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';
import { ConsultantSettingsForm } from './ConsultantSettingsForm';
import { egp, StatusBadge, whenLabel } from './shared';

type Overview = ExpertOverviewDto;

/** On /speaker and /consultations: a short card for experts only (nothing for anyone else). */
export function ExpertPortalCard() {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const [upcoming, setUpcoming] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    api<Overview>('/consultations/expert')
      .then((o) => setUpcoming(o.bookings.filter((b) => b.status === 'CONFIRMED' && b.startsAt !== null && new Date(b.startsAt).getTime() > Date.now()).length))
      .catch(() => setUpcoming(null));
  }, [user]);
  if (upcoming === null) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl">{t('consultations.portal.title')}</h2>
        <p className="mt-1 text-muted">{t('consultations.portal.cardBody', { count: upcoming })}</p>
      </div>
      <Link href={`/${locale}/consultations/expert`} className={buttonClass('secondary', 'md')}>
        {t('consultations.portal.open')}
      </Link>
    </Card>
  );
}

/** /consultations/expert: the expert's bookings (name and note, never the student's email), Google Calendar and settings. */
export function ExpertPortal() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notSetUp' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState('Africa/Cairo');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTz(viewerTimezone());
    api<Overview>('/consultations/expert')
      .then((o) => {
        setData(o);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setState('notSetUp');
        else {
          setError(errorMessage(err, t));
          setState('error');
        }
      });
  }, [t]);

  if (state === 'loading') return <PageSpinner />;
  if (state === 'notSetUp') return <Alert tone="info">{t('consultations.portal.notSetUp')}</Alert>;
  if (state === 'error' || !data) return <Alert tone="danger">{error}</Alert>;

  const now = Date.now();
  // Booked calls still ahead, then paid ones the student hasn't booked a time for yet.
  const upcoming = [
    ...data.bookings.filter((b) => b.status === 'CONFIRMED' && b.endsAt !== null && new Date(b.endsAt).getTime() > now),
    ...data.bookings.filter((b) => b.status === 'PAID'),
  ];

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      const b = await api<ConsultationBookingAdminDto>(`/consultations/expert/bookings/${id}/cancel`, { method: 'POST', json: { reason } });
      setData((d) => d && { ...d, bookings: d.bookings.map((x) => (x.id === id ? b : x)) });
      setCancelling(null);
      setReason('');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/${locale}/consultations`} className="text-[0.9375rem] text-muted hover:text-fg">
          {t('consultations.portal.back')}
        </Link>
        <h1 className="mt-3 text-3xl">{t('consultations.portal.title')}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t(data.settings.enabled ? 'consultations.portal.listed' : 'consultations.portal.notListed')}</p>
      </div>

      <section aria-labelledby="bookings" className="flex flex-col gap-3">
        <h2 id="bookings" className="text-xl">
          {t('consultations.portal.upcoming')}
        </h2>
        {error && <Alert tone="danger">{error}</Alert>}
        {upcoming.length === 0 ? (
          <p className="text-muted">{t('consultations.portal.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex-1 font-medium text-fg">
                      {b.student.name} · {b.startsAt ? whenLabel(b.startsAt, locale, tz) : t('consultations.portal.noTimeYet')} · {t('consultations.minutes', { min: b.durationMin })}
                    </p>
                    <StatusBadge status={b.status} t={t} />
                  </div>
                  <p className="text-[0.875rem] text-muted">
                    {b.reference} · {egp(b.priceEgp, locale)}
                  </p>
                  {b.note && <p className="text-[0.9375rem] whitespace-pre-line text-body">{b.note}</p>}
                  {b.canCancel &&
                    (cancelling === b.id ? (
                      <div className="flex flex-col gap-2">
                        <TextField label={t('consultations.booking.cancelReason')} value={reason} onChange={setReason} maxLength={500} />
                        <div className="flex gap-2">
                          <Button type="button" variant="danger" size="sm" loading={busy} onClick={() => void cancel(b.id)}>
                            {t('consultations.booking.cancelYes')}
                          </Button>
                          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setCancelling(null)}>
                            {t('consultations.booking.keep')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setCancelling(b.id)}>
                        {t('consultations.booking.cancel')}
                      </Button>
                    ))}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.google.available && <GoogleCard status={data.google} onChange={(google) => setData((d) => d && { ...d, google })} />}

      <section aria-labelledby="settings" className="flex flex-col gap-3">
        <h2 id="settings" className="text-xl">
          {t('consultations.portal.settings')}
        </h2>
        <Card>
          <ConsultantSettingsForm
            initial={data.settings}
            withEnabled={false}
            onSave={async (body) => {
              const next = await api<ConsultantSettingsDto>('/speaker/consultations/settings', { method: 'PUT', json: body });
              setData((d) => d && { ...d, settings: next });
              return next;
            }}
          />
        </Card>
      </section>
    </div>
  );
}

/** Connect Google Calendar: busy times hide slots, and paid calls get an event with a Meet link. */
function GoogleCard({ status, onChange }: { status: GoogleCalendarStatusDto; onChange: (s: GoogleCalendarStatusDto) => void }) {
  const { t } = useI18n();
  // Back from Google: ?google=connected | cancelled | permissions | failed (read once, then dropped from the address).
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('google');
    if (!r) return;
    setResult(r);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/consultations/expert/google/connect', { method: 'POST' });
      window.location.assign(url);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<GoogleCalendarStatusDto>('/consultations/expert/google', { method: 'DELETE' }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const broken = status.connected && status.error;
  return (
    <section aria-labelledby="google" className="flex flex-col gap-3">
      <h2 id="google" className="text-xl">
        {t('consultations.google.title')}
      </h2>
      <Card className="flex flex-col gap-3">
        {result && result !== 'connected' && <Alert tone="warning">{t(`consultations.google.result.${result}`)}</Alert>}
        {result === 'connected' && !broken && <Alert tone="success">{t('consultations.google.result.connected')}</Alert>}
        {broken ? (
          <Alert tone="warning">{t('consultations.google.expired')}</Alert>
        ) : status.connected ? (
          <p className="text-body">{t('consultations.google.connected', { email: status.email ?? '' })}</p>
        ) : (
          <p className="text-body">{t('consultations.google.intro')}</p>
        )}
        <p className="text-[0.875rem] text-muted">{t('consultations.google.privacy')}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          {(!status.connected || broken) && (
            <Button type="button" onClick={() => void connect()} loading={busy}>
              {t(broken ? 'consultations.google.reconnect' : 'consultations.google.connect')}
            </Button>
          )}
          {status.connected && (
            <Button type="button" variant="secondary" onClick={() => void disconnect()} disabled={busy}>
              {t('consultations.google.disconnect')}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
