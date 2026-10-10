'use client';

import {
  SPEAKER_APPLICATION_STATUSES,
  SPEAKER_AREAS,
  speakerAreaLabels,
  type AdminSpeakerApplicationDto,
} from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SpeakersTabs } from '@/components/admin/SpeakersTabs';
import { Alert } from '@/components/ui/Alert';
import { SPEAKER_APP_TONE } from '@/components/speakers/shared';
import { Badge } from '@/components/ui/Badge';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default function AdminSpeakerApplications() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState('SUBMITTED');
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminSpeakerApplicationDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (area) params.set('area', area);
    if (q.trim()) params.set('q', q.trim());
    const id = setTimeout(() => {
      api<AdminSpeakerApplicationDto[]>(`/admin/speaker-applications?${params}`)
        .then((r) => {
          setRows(r);
          setError(false);
        })
        .catch(() => setError(true));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [status, area, q]);

  return (
    <div>
      <SpeakersTabs />
      <h1 className="text-3xl">{t('admin.speakerApps.title')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.speakerApps.intro')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-fg">{t('admin.speakerApps.filters.status')}</span>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.speakerApps.filters.all')}</option>
            {SPEAKER_APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`speakers.portal.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-fg">{t('admin.speakerApps.filters.area')}</span>
          <select className={inputClass} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">{t('admin.speakerApps.filters.all')}</option>
            {SPEAKER_AREAS.map((a) => (
              <option key={a} value={a}>
                {speakerAreaLabels[a][locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-fg">{t('admin.speakerApps.filters.search')}</span>
          <input className={inputClass} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.speakerApps.filters.searchHint')} />
        </label>
      </div>
      {error && (
        <Alert tone="danger" className="mt-4">
          {t('errors.generic')}
        </Alert>
      )}
      {!rows && !error && <p className="mt-5 text-muted">{t('admin.common.loading')}</p>}
      {rows?.length === 0 && <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.common.none')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-card">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 basis-60">
                <Link href={`/${locale}/admin/speakers/applications/${a.id}`} className="font-medium text-primary hover:underline">
                  {a.fullName}
                </Link>
                <p className="mt-0.5 text-sm text-muted">
                  {a.title}
                  {a.company ? ` · ${a.company}` : ''}
                </p>
                <p className="mt-1 text-sm break-words text-fg">{a.sessionTitle}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.areas.map((x) => (
                    <Badge key={x}>{speakerAreaLabels[x][locale]}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-sm text-muted">
                <Badge tone={SPEAKER_APP_TONE[a.status]}>{t(`speakers.portal.status.${a.status}`)}</Badge>
                <span>{formatDate(a.submittedAt, locale)}</span>
                {a.submissions > 1 && <span>{t('admin.speakerApps.resubmitted', { n: a.submissions })}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
