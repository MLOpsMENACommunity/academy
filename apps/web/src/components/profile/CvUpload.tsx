'use client';

import type { ProfileDto } from '@academy/shared';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

const MAX = 5 * 1024 * 1024;

export function CvUpload({ profile, onChange }: { profile: ProfileDto; onChange: (p: ProfileDto) => void }) {
  const { locale, t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = (k: string, v?: Record<string, string>) => t(`profile.fields.${k}`, v);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX) return setError(t('uploads.tooLarge'));
    if (file.type && file.type !== 'application/pdf') return setError(t('uploads.pdfOnly'));
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      onChange(await api<ProfileDto>('/me/profile/cv', { method: 'POST', body }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      onChange(await api<ProfileDto>('/me/profile/cv', { method: 'DELETE' }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-muted-bg/50 p-4">
      <p className="text-sm font-semibold text-fg">
        {f('cv')} <span className="text-xs font-normal text-muted">({t('common.optional')})</span>
      </p>
      <p className="mt-1 text-xs text-muted">🔒 {f('cvPrivacy')}</p>
      {profile.hasCv && profile.cvUploadedAt && (
        <p className="mt-2 text-sm text-body">{f('cvUploaded', { date: formatDate(profile.cvUploadedAt, locale) })}</p>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          id="cv-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          {profile.hasCv ? f('cvReplace') : f('cvUpload')}
        </Button>
        {profile.hasCv && (
          <Button type="button" variant="ghost" onClick={remove} disabled={busy}>
            {f('cvDelete')}
          </Button>
        )}
      </div>
    </div>
  );
}
