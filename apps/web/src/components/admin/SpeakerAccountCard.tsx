'use client';

import { speakerAccountSchema, type SpeakerAccountDto, type SpeakerAccountResultDto } from '@academy/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RadioGroup, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

/**
 * Admin → Speakers → {speaker}: the account that signs in as this speaker. Invite a new address
 * (a speaker account and a "choose your password" email) or link an existing account, so the
 * speaker reaches this profile's courses under Teaching; unlink a wrong one.
 */
export function SpeakerAccountCard({
  instructorId,
  account,
  autoOpen = false,
  onChanged,
}: {
  instructorId: string;
  account: SpeakerAccountDto | null;
  /** Coming from "Invite speaker": the form starts open, in view. */
  autoOpen?: boolean;
  onChanged: () => void;
}) {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.speakerAccount.${k}`, v);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(autoOpen);
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<string>(locale);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (autoOpen) ref.current?.scrollIntoView({ block: 'center' });
  }, [autoOpen]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const parsed = speakerAccountSchema.safeParse({ email, locale: lang });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await api<SpeakerAccountResultDto>(`/admin/instructors/${instructorId}/account`, { method: 'POST', json: parsed.data });
      setDone(a(r.outcome, { email: r.account.email }));
      setEmail('');
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      await api(`/admin/instructors/${instructorId}/account`, { method: 'DELETE' });
      setDone(a('unlinked', { email: account!.email }));
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 space-y-3">
      <div ref={ref} />
      <h2 className="text-lg">{a('title')}</h2>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {account ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium ltr-embed break-all">{account.email}</span>
            <Badge tone={account.role === 'SPEAKER' ? 'info' : 'neutral'}>{t(`admin.speakerAccount.role.${account.role}`)}</Badge>
            {account.pending && <Badge tone="warning">{a('pending')}</Badge>}
          </p>
          <p className="text-sm text-muted">{a('linkedHint')}</p>
          {!confirming ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              {a('unlink')}
            </Button>
          ) : (
            <div className="space-y-2 rounded-card border border-danger/40 p-3">
              <p className="text-sm">{a('unlinkConfirm', { email: account.email })}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" loading={busy} onClick={unlink}>
                  {a('unlinkButton')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t('admin.common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : !open ? (
        <>
          <p className="text-sm text-muted">{a('none')}</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            {a('invite')}
          </Button>
        </>
      ) : (
        <form onSubmit={invite} noValidate className="space-y-4">
          <p className="text-sm text-muted">{a('intro')}</p>
          <TextField label={a('email')} required type="email" dir="ltr" autoComplete="off" value={email} onChange={setEmail} error={errors.email} />
          <RadioGroup
            legend={a('language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {a('submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('admin.common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
