'use client';

import type { MyCertificateDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pick } from '@/lib/sessions';
import { CertificateActions } from './CertificateActions';

/** Dashboard: "My certificates". Hidden until the student has one. */
export function MyCertificates() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<MyCertificateDto[] | null>(null);
  useEffect(() => {
    api<MyCertificateDto[]>('/me/certificates').then(setItems).catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section id="certificates" aria-labelledby="my-certificates" className="flex scroll-mt-6 flex-col gap-3">
      <h2 id="my-certificates" className="text-xl">
        {t('certificates.mine')}
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-medium text-fg">{pick(locale, c.courseTitleEn, c.courseTitleAr)}</p>
                <p className="text-sm text-muted">
                  {t('certificates.issuedOn', { date: formatDate(c.issuedAt, locale) })}
                  {c.grade && ` · ${t('certificates.grade', { grade: c.grade })}`}
                  {' · '}
                  <span dir="ltr">{c.serial}</span>
                </p>
              </div>
              <Badge tone={c.status === 'VALID' ? 'success' : 'danger'}>{t(`certificates.status.${c.status}`)}</Badge>
            </div>
            {c.status === 'VALID' ? <CertificateActions cert={c} compact /> : <p className="text-sm text-muted">{t('certificates.revokedNote')}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
