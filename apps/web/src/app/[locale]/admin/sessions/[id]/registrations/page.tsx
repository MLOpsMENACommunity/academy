'use client';

import { countryName } from '@academy/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminEvent } from '@/components/admin/EventForm';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, viewerTimezone } from '@/lib/format';

interface Registration {
  userId: string;
  email: string;
  name: string | null;
  country: string | null;
  jobTitle: string | null;
  registeredAt: string;
}

export default function SessionRegistrations() {
  const { locale, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<AdminEvent>(`/admin/events/${id}`), api<Registration[]>(`/admin/events/${id}/registrations`)])
      .then(([e, r]) => {
        setEvent(e);
        setRows(r);
      })
      .catch((err) => setError(t(err instanceof ApiError && err.status === 404 ? 'errors.notFound' : 'errors.generic')));
  }, [id, t]);

  async function csv() {
    if (!event) return;
    setBusy(true);
    try {
      await downloadViaApi(`/admin/events/${id}/registrations.csv`, `session-registrations-${event.slug}.csv`);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const c = (k: string) => t(`admin.sessions.columns.${k}`);

  return (
    <div>
      <Link href={event ? `/${locale}/admin/sessions/${id}` : `/${locale}/admin/sessions`} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
        <span aria-hidden className="me-1 inline-block rtl:-scale-x-100">←</span>{event ? (locale === 'ar' && event.titleAr) || event.titleEn : t('admin.sessions.title')}
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.sessions.registrations')}</h1>
        <Button variant="secondary" onClick={csv} loading={busy} disabled={!rows?.length}>
          {t('admin.sessions.csv')}
        </Button>
      </div>
      {event && rows && (
        <p className="mt-2 text-sm text-muted">
          {event.capacity
            ? t('admin.sessions.ofCapacity', { count: rows.length, capacity: event.capacity })
            : t('admin.sessions.registeredCount', { count: rows.length })}
        </p>
      )}
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {!rows && !error && <p className="mt-5 text-muted">{t('admin.common.loading')}</p>}
      {rows?.length === 0 && <p className="mt-5 rounded-card border border-dashed border-line-strong p-8 text-center text-muted">{t('admin.sessions.noRegistrations')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-card">
          <li aria-hidden className="hidden gap-4 bg-muted-bg px-4 py-2 text-xs text-muted md:grid md:grid-cols-[2fr_1fr_1fr_1fr]">
            <span>{c('name')}</span>
            <span>{c('country')}</span>
            <span>{c('jobTitle')}</span>
            <span>{c('registeredAt')}</span>
          </li>
          {rows.map((r) => (
            <li key={r.userId} className="grid gap-1 p-4 text-sm md:grid-cols-[2fr_1fr_1fr_1fr] md:items-center md:gap-4">
              <div className="min-w-0">
                <Link href={`/${locale}/admin/students/${r.userId}`} className="font-semibold text-primary hover:underline">
                  {r.name || r.email}
                </Link>
                <p className="truncate text-muted ltr-embed">{r.email}</p>
              </div>
              <span>
                <span className="text-muted md:sr-only">{c('country')}: </span>
                {r.country ? countryName(r.country, locale) : '—'}
              </span>
              <span className="min-w-0 break-words">
                <span className="text-muted md:sr-only">{c('jobTitle')}: </span>
                {r.jobTitle || '—'}
              </span>
              <span className="text-muted">{formatDateTime(r.registeredAt, locale, viewerTimezone())}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
