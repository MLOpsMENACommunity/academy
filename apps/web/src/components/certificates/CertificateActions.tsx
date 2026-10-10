'use client';

import { certificatePath, linkedInAddUrl, type MyCertificateDto } from '@academy/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { ApiError } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { absoluteUrl } from '@/lib/site';

/** Download the PDF, open the public page, add to LinkedIn, copy the link. Valid certificates only. */
export function CertificateActions({ cert, compact = false }: { cert: MyCertificateDto; compact?: boolean }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: boolean } | null>(null);
  const page = certificatePath(locale, cert.serial);
  // LinkedIn shows the English title and links to the English page (the profile's language varies).
  const linkedIn = linkedInAddUrl({ courseTitle: cert.courseTitleEn, issuedAt: cert.issuedAt, verifyUrl: absoluteUrl(certificatePath('en', cert.serial)), serial: cert.serial });
  const size = compact ? 'sm' : 'md';

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      await downloadViaApi(`/me/certificates/${cert.serial}/pdf`, `${cert.serial}.pdf`);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.code === 'REVOKED' ? t('certificates.revokedNote') : errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(page));
      setMsg({ ok: true, text: t('certificates.copied') });
    } catch {
      // No clipboard access: show the link to copy by hand.
      setMsg({ ok: true, text: absoluteUrl(page), url: true });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size={size} onClick={download} loading={busy}>
          {t('certificates.download')}
        </Button>
        <a href={linkedIn} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', size)}>
          {t('certificates.linkedin')} <span aria-hidden className="inline-block rtl:-scale-x-100">↗</span>
        </a>
        <Link href={page} className={buttonClass('secondary', size)}>
          {t('certificates.view')}
        </Link>
        <Button size={size} variant="ghost" onClick={copy}>
          {t('certificates.copy')}
        </Button>
      </div>
      <p role="status" className={`text-sm ${msg?.url ? 'break-all text-body' : msg?.ok ? 'text-success' : 'text-danger'}`} dir={msg?.url ? 'ltr' : undefined}>
        {msg?.text}
      </p>
    </div>
  );
}
