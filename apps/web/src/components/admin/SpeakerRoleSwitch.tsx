'use client';

import { useState } from 'react';
import { speakerError } from '@/components/speakers/shared';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

/** Turns a student account into a speaker account (they then use /speaker, and keep studying). */
export function SpeakerRoleSwitch({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!window.confirm(t('admin.speakerApps.toSpeakerConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${userId}/role`, { method: 'PUT', json: { role: 'SPEAKER' } });
      setDone(true);
    } catch (err) {
      setError(speakerError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg">{t('admin.speakerApps.account')}</h2>
      <p className="mt-2 text-sm text-muted">{t('admin.speakerApps.accountHint')}</p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {done ? (
        <Alert tone="success" className="mt-3">
          {t('admin.speakerApps.nowSpeaker')}
        </Alert>
      ) : (
        <Button variant="secondary" className="mt-3" loading={busy} onClick={run}>
          {t('admin.speakerApps.toSpeaker')}
        </Button>
      )}
    </Card>
  );
}
