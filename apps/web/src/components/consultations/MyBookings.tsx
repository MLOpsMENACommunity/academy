'use client';

import type { ConsultationBookingDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { viewerTimezone } from '@/lib/format';
import { egp, expertName, StatusBadge, whenLabel } from './shared';

export function MyBookings() {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<ConsultationBookingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState('Africa/Cairo');

  useEffect(() => {
    setTz(viewerTimezone());
    api<ConsultationBookingDto[]>('/consultations/bookings')
      .then(setRows)
      .catch((err) => setError(errorMessage(err, t)));
  }, [t]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows) return <PageSpinner />;
  const now = Date.now();
  const upcoming = rows.filter((b) => new Date(b.endsAt).getTime() > now && (b.status === 'AWAITING_PAYMENT' || b.status === 'CONFIRMED')).reverse();
  const past = rows.filter((b) => !upcoming.includes(b));

  const list = (items: ConsultationBookingDto[]) => (
    <ul className="flex flex-col gap-3">
      {items.map((b) => (
        <li key={b.id}>
          <Link href={`/${locale}/consultations/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-4 hover:border-primary">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg">{expertName(b.consultant, locale)}</p>
              <p className="text-[0.875rem] text-muted">
                {whenLabel(b.startsAt, locale, tz)} · {t('consultations.minutes', { min: b.durationMin })} · {egp(b.priceEgp, locale)}
              </p>
            </div>
            <StatusBadge status={b.status} t={t} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.75rem]">{t('consultations.mine.title')}</h1>
        <ButtonLink href={`/${locale}/consultations`} variant="secondary">
          {t('consultations.mine.findExpert')}
        </ButtonLink>
      </div>
      {rows.length === 0 && <p className="text-muted">{t('consultations.mine.empty')}</p>}
      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-3 text-[1.25rem]">
            {t('consultations.mine.upcoming')}
          </h2>
          {list(upcoming)}
        </section>
      )}
      {past.length > 0 && (
        <section aria-labelledby="past">
          <h2 id="past" className="mb-3 text-[1.25rem]">
            {t('consultations.mine.past')}
          </h2>
          {list(past)}
        </section>
      )}
    </div>
  );
}
