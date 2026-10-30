'use client';

import type { SpeakerAccountDto } from '@academy/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** What the admin speaker API adds to a profile: former addresses and the account behind it. */
export interface SpeakerAccountInfo {
  id: string;
  name: string;
  courses: number;
  events: number;
  previousSlugs?: string[];
  applicationId?: string | null;
  /** The account that signs in as this speaker, if any. */
  account?: SpeakerAccountDto | null;
}

/**
 * Admin → Speakers → {speaker}, below the profile form: the linked speaker application (to
 * edit it), the page's former addresses, and deleting the profile.
 */
export function SpeakerProfileExtras({ speaker, onDeleted }: { speaker: SpeakerAccountInfo; onDeleted: () => void }) {
  const { locale, t } = useI18n();
  const e = (k: string, v?: Record<string, string | number>) => t(`admin.speakerEdit.${k}`, v);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === speaker.name.trim().toLowerCase();

  async function remove(ev: FormEvent) {
    ev.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/instructors/${speaker.id}/delete`, { method: 'POST', json: { confirm: typed } });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      {(speaker.applicationId || (speaker.previousSlugs?.length ?? 0) > 0) && (
        <Card className="space-y-3">
          {speaker.applicationId && (
            <p>
              <Link href={`/${locale}/admin/speakers/applications/${speaker.applicationId}`} className="font-medium text-primary underline">
                {e('application')}
              </Link>
              <span className="block text-sm text-muted">{e('applicationHint')}</span>
            </p>
          )}
          {(speaker.previousSlugs?.length ?? 0) > 0 && (
            <p className="text-sm text-muted">
              {e('formerAddresses')}{' '}
              {speaker.previousSlugs!.map((s) => (
                <code key={s} className="me-2 ltr-embed">
                  /speakers/{s}
                </code>
              ))}
            </p>
          )}
        </Card>
      )}
      <Card className="space-y-3 border-danger/40">
        <h2 className="text-lg">{e('deleteTitle')}</h2>
        <p className="text-sm text-muted">{speaker.events + speaker.courses > 0 ? e('deleteHasSessions', { events: speaker.events, courses: speaker.courses }) : e('deleteBody')}</p>
        {speaker.applicationId && <p className="text-sm text-muted">{e('deleteAccountStays')}</p>}
        {!open ? (
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            {e('deleteButton')}
          </Button>
        ) : (
          <form onSubmit={remove} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextField label={e('deleteType', { name: speaker.name })} autoComplete="off" value={typed} onChange={setTyped} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={!matches} loading={busy}>
                {e('deleteConfirm')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t('admin.common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
