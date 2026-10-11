'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SpeakersTabs } from '@/components/admin/SpeakersTabs';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { useSearchParam } from '@/lib/use-search-param';
import type { AdminSpeaker } from './types';

export default function AdminSpeakers() {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<AdminSpeaker[] | null>(null);
  const [error, setError] = useState(false);
  const deleted = useSearchParam('deleted');

  useEffect(() => {
    api<AdminSpeaker[]>('/admin/instructors')
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <SpeakersTabs />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">{t('admin.speakers.title')}</h1>
        <Link href={`/${locale}/admin/speakers/new`} className={buttonClass('primary', 'md')}>
          + {t('admin.speakers.new')}
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t('admin.speakers.intro')}</p>
      {deleted && (
        <Alert tone="success" className="mt-4">
          {t('admin.speakerEdit.deleted')}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mt-4">
          {t('errors.generic')}
        </Alert>
      )}
      {!rows && !error && <p className="mt-5 text-muted">{t('admin.common.loading')}</p>}
      {rows?.length === 0 && <p className="mt-5 rounded-card border border-dashed border-line-strong/50 p-8 text-center text-muted">{t('admin.common.none')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line bg-card">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              {s.photoUrl ? (
                <Image src={s.photoUrl} alt="" width={44} height={44} unoptimized className="size-11 shrink-0 rounded-full object-cover" />
              ) : (
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-logo-cyan-soft font-semibold text-primary">
                  {s.name.charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1 basis-56">
                <Link href={`/${locale}/admin/speakers/${s.id}`} className="font-medium text-primary hover:underline">
                  {(locale === 'ar' && s.nameAr) || s.name}
                </Link>
                <p className="mt-0.5 text-sm text-muted">{(locale === 'ar' && s.titleAr) || s.titleEn}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  {s.source === 'import' && <Badge tone="info">{t('admin.common.imported')}</Badge>}
                  <span>{t('admin.speakers.appearances', { courses: s.courses, events: s.events })}</span>
                </div>
              </div>
              <Link href={`/${locale}/admin/speakers/${s.id}`} className={buttonClass('secondary', 'md')}>
                {t('admin.common.edit')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
