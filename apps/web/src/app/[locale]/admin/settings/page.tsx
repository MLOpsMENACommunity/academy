'use client';

import { paymentsConfigured, SESSION_TEAM_EMAILS_MAX, settingsUpdateSchema, type Settings } from '@academy/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { EmailListEditor } from '@/components/admin/EmailListEditor';
import { TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

const GROUPS: { title: string; keys: (keyof Settings)[] }[] = [
  { title: 'payment', keys: ['instapayHandle', 'instapayName', 'vodafoneCashNumber', 'vodafoneCashName', 'orangeCashNumber', 'orangeCashName', 'etisalatCashNumber', 'etisalatCashName'] },
  { title: 'support', keys: ['supportEmail', 'supportWhatsapp'] },
  { title: 'windows', keys: ['liveLinkRevealMinutes', 'screenshotRetentionDays'] },
  { title: 'speakers', keys: ['speakerMaxOpenBookings', 'speakerCancelDays'] },
  { title: 'points', keys: ['sessionCompletedPoints', 'certificatePoints', 'speakerPointsCap'] },
];
const NUMERIC = new Set<keyof Settings>(['liveLinkRevealMinutes', 'screenshotRetentionDays', 'speakerMaxOpenBookings', 'speakerCancelDays', 'sessionCompletedPoints', 'certificatePoints', 'speakerPointsCap']);
/** Points settings keep their strings with the rest of points (admin.points.settings.*). */
const POINTS_KEYS = new Set<string>(['points', 'sessionCompletedPoints', 'certificatePoints', 'speakerPointsCap']);
/** Fields that explain what an empty value does. */
const HINTS = new Set<keyof Settings>(['instapayHandle', 'vodafoneCashNumber', 'orangeCashNumber', 'etisalatCashNumber', 'supportEmail', 'supportWhatsapp', 'speakerCancelDays']);

export default function AdminSettings() {
  const { t } = useI18n();
  const [values, setValues] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>('/admin/settings')
      .then(setValues)
      .catch((err) => setFormError(errorMessage(err, t)));
  }, [t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setFormError(null);
    const parsed = settingsUpdateSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setValues(await api<Settings>('/admin/settings', { method: 'PUT', json: parsed.data }));
      setSaved(true);
    } catch (err) {
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!values) return formError ? <Alert tone="danger">{formError}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <h1 className="text-3xl">{t('admin.settings.title')}</h1>
      {!paymentsConfigured(values) && <Alert tone="warning">{t('admin.settings.placeholderWarning')}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}
      {GROUPS.map((g) => (
        <Card key={g.title}>
          <fieldset>
            <legend className="text-lg font-semibold text-fg">{t(POINTS_KEYS.has(g.title) ? `admin.points.settings.${g.title}` : `admin.settings.${g.title}`)}</legend>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {g.keys.map((k) => (
                <TextField
                  key={k}
                  label={t(POINTS_KEYS.has(k) ? `admin.points.settings.${k}` : `admin.settings.${k}`)}
                  hint={HINTS.has(k) ? t(`admin.settings.hints.${k}`) : undefined}
                  type={NUMERIC.has(k) ? 'number' : k === 'supportEmail' ? 'email' : k === 'supportWhatsapp' ? 'tel' : 'text'}
                  dir={NUMERIC.has(k) ? undefined : 'ltr'}
                  value={String(values[k])}
                  error={errors[k]}
                  onChange={(x) => {
                    setSaved(false);
                    setValues({ ...values, [k]: NUMERIC.has(k) ? Number(x || 0) : x });
                  }}
                />
              ))}
            </div>
          </fieldset>
        </Card>
      ))}
      <Card>
        <EmailListEditor
          name="sessionTeamEmails"
          legend={t('admin.settings.sessionTeamEmails')}
          hint={t('admin.settings.hints.sessionTeamEmails')}
          value={values.sessionTeamEmails}
          max={SESSION_TEAM_EMAILS_MAX}
          errors={errors}
          onChange={(list) => {
            setSaved(false);
            setValues({ ...values, sessionTeamEmails: list });
          }}
        />
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>
          {t('admin.common.save')}
        </Button>
        <span role="status" className="text-sm text-success">
          {saved ? `✓ ${t('admin.common.saved')}` : ''}
        </span>
      </div>
    </form>
  );
}
