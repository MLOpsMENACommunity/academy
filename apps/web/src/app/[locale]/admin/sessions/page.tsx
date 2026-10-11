'use client';

import { EVENT_STATUSES, eventEnded, eventStatusLabels, speakerKindLabels, type EventStatus } from '@academy/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { DeleteEvent, eventStatusTone, type AdminEvent } from '@/components/admin/EventForm';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, viewerTimezone } from '@/lib/format';

type Filter = 'ALL' | EventStatus;
const FILTERS: Filter[] = ['ALL', ...EVENT_STATUSES];

// useSearchParams needs a Suspense boundary in a statically rendered page.
export default function AdminSessionsPage() {
  return (
    <Suspense>
      <AdminSessions />
    </Suspense>
  );
}

function AdminSessions() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('status');
  // In the address, so a link (or the back button) keeps the filter.
  const filter: Filter = raw && (EVENT_STATUSES as readonly string[]).includes(raw) ? (raw as EventStatus) : 'ALL';
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
      {rows && rows.length > 0 && (
        <nav aria-label={t('admin.sessions.filterLabel')} className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = f === 'ALL' ? rows.length : rows.filter((e) => e.status === f).length;
            const active = f === filter;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => router.replace(`/${locale}/admin/sessions${f === 'ALL' ? '' : `?status=${f}`}`, { scroll: false })}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-medium ${active ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-card text-body hover:border-line-strong'}`}
              >
                {f === 'ALL' ? t('admin.sessions.filterAll') : t(`admin.sessions.filter.${f}`)}
                <span className={`rounded-full px-2 text-sm ${f === 'DRAFT' && count > 0 ? 'bg-warning-soft text-warning' : 'bg-muted-bg text-muted'}`}>{count}</span>
              </button>
            );
          })}
        </nav>
      )}
      {rows?.length === 0 && <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.common.none')}</p>}
      {rows && rows.length > 0 && shown(rows, filter).length === 0 && (
        <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.common.none')}</p>
      )}
      {rows && shown(rows, filter).length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-card">
          {shown(rows, filter).map((e) => {
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
                    {e.speakingSlot?.kind && e.speakingSlot.kind !== 'SESSION' && <Badge tone="primary">{speakerKindLabels[e.speakingSlot.kind][locale]}</Badge>}
                    {e.speakingSlot && <Badge tone="info">{t('admin.sessions.fromBooking')}</Badge>}
                    {ended && <Badge>{t('admin.sessions.ended')}</Badge>}
                    {e.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
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

/** The sessions under the chosen filter (all of them by default). */
function shown(rows: AdminEvent[], filter: Filter): AdminEvent[] {
  return filter === 'ALL' ? rows : rows.filter((e) => e.status === filter);
}
