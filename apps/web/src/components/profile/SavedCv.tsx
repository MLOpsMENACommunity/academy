'use client';

import type { ProfileDto } from '@academy/shared';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

/**
 * CVs are no longer asked for. A student who uploaded one before still sees it
 * here and can open or remove it; nothing is shown when there is no CV.
 */
export function SavedCv({ profile, onChange }: { profile: ProfileDto; onChange: (p: ProfileDto) => void }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = (k: string, v?: Record<string, string>) => t(`profile.fields.${k}`, v);

  /** Opens the owner's CV through a 5-minute signed link (QA L23). */
  async function view() {
    setError(null);
    // Open the tab now, inside the click, so pop-up blockers allow it; point it at the CV once the link arrives.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setViewing(true);
    try {
      const { url } = await api<{ url: string }>('/me/profile/cv');
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError(errorMessage(err, t));
    } finally {
      setViewing(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      onChange(await api<ProfileDto>('/me/profile/cv', { method: 'DELETE' }));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!profile.hasCv) return null;
  return (
    <div className="rounded-lg border border-line bg-muted-bg/50 p-4">
      <p className="text-sm text-body">
        {profile.cvUploadedAt ? f('cvUploaded', { date: formatDate(profile.cvUploadedAt, locale) }) : f('cvView')}
      </p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={view} loading={viewing} disabled={busy}>
          {f('cvView')}
        </Button>
        <Button type="button" variant="ghost" onClick={remove} loading={busy}>
          {f('cvDelete')}
        </Button>
      </div>
    </div>
  );
}
