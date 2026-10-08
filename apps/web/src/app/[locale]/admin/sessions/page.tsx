'use client';

import { eventEnded, eventStatusLabels } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DeleteEvent, eventStatusTone, type AdminEvent } from '@/components/admin/EventForm';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, viewerTimezone } from '@/lib/format';

export default function AdminSessions() {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    api<AdminEvent[]>('/admin/events')
      .then(setRows)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.sessions.title')}</h1>
        <Link href={`/${locale}/admin/sessions/new`} className={buttonClass('primary', 'md')}>
          + {t('admin.sessions.new')}
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.sessions.intro')}</p>
      {error && (
        <Alert tone="danger" className="mt-4">
          {t('errors.generic')}
        </Alert>
      )}
      {!rows && !error && <p className="mt-5 text-muted">{t('admin.common.loading')}</p>}
      {rows?.length === 0 && <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.common.none')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-card">
          {rows.map((e) => {
            const ended = eventEnded(new Date(e.startsAt), e.durationMin);
            const count = e._count.registrations;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
                <div className="min-w-0 flex-1 basis-64">
                  <Link href={`/${locale}/admin/sessions/${e.id}`} className="font-medium text-primary hover:underline">
                    {(locale === 'ar' && e.titleAr) || e.titleEn}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted">{formatDateTime(e.startsAt, locale, viewerTimezone())}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={eventStatusTone[e.status]}>{eventStatusLabels[e.status][locale]}</Badge>
                    {ended && <Badge>{t('admin.sessions.ended')}</Badge>}
                  </div>
                </div>
                <Link href={`/${locale}/admin/sessions/${e.id}/registrations`} className="inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-fg hover:text-primary hover:underline">
                  {e.capacity ? t('admin.sessions.ofCapacity', { count, capacity: e.capacity }) : t('admin.sessions.registeredCount', { count })}
                </Link>
                <div className="flex gap-2">
                  <Link href={`/${locale}/admin/sessions/${e.id}`} className={buttonClass('secondary', 'md')}>
                    {t('admin.common.edit')}
                  </Link>
                  <DeleteEvent event={e} onDone={load} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
