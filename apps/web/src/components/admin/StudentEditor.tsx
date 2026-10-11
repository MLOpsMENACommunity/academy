'use client';

import { adminOtherSectionSchema, PROFILE_SECTIONS, type AdminProfileSection, type ProfileDto } from '@academy/shared';
import { useRef, useState, type FormEvent } from 'react';
import { CheckboxField, focusFirstInvalid, TextField } from '@/components/forms/fields';
import { SectionForm } from '@/components/profile/SectionForm';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';

const SECTIONS: AdminProfileSection[] = [...PROFILE_SECTIONS, 'other'];

/**
 * Admin → Students → {student} → Edit: one step of the student's profile at a time, with the
 * student form's own fields and validation (saved through the admin API, audited).
 */
export function StudentEditor({ studentId, profile, onSaved }: { studentId: string; profile: ProfileDto; onSaved: (p: ProfileDto) => void }) {
  const { t } = useI18n();
  const [section, setSection] = useState<AdminProfileSection>('core');
  const label = (s: AdminProfileSection) => (s === 'other' ? t('admin.studentEdit.other') : t(`profile.sections.${s}`));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t('admin.studentEdit.intro')}</p>
      <div role="tablist" aria-label={t('admin.studentEdit.sections')} className="-mx-1 flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === section}
            onClick={() => setSection(s)}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${s === section ? 'bg-primary-soft font-semibold text-primary' : 'text-body hover:bg-hover-bg'}`}
          >
            {label(s)}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={label(section)}>
        {section === 'other' ? (
          <OtherForm key={`other-${profile.updatedAt}`} studentId={studentId} profile={profile} onSaved={onSaved} />
        ) : (
          // Keyed by the saved version, so the form restarts from what the server stored.
          <SectionForm key={`${section}-${profile.updatedAt}`} section={section} profile={profile} adminFor={studentId} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

/** Answers the profile no longer asks (kept for admins): correct or clear them. */
function OtherForm({ studentId, profile: p, onSaved }: { studentId: string; profile: ProfileDto; onSaved: (p: ProfileDto) => void }) {
  const { t } = useI18n();
  const form = useRef<HTMLFormElement>(null);
  const [v, setV] = useState({
    websiteUrl: p.websiteUrl ?? '',
    kaggleUrl: p.kaggleUrl ?? '',
    huggingfaceUrl: p.huggingfaceUrl ?? '',
    fieldOfStudy: p.fieldOfStudy ?? '',
    university: p.university ?? '',
    graduationYear: p.graduationYear ? String(p.graduationYear) : '',
    openToOpportunities: p.openToOpportunities,
    shareWithPartners: p.shareWithPartners,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string | boolean) => setV((prev) => ({ ...prev, [k]: x }));
  const f = (k: string) => t(`profile.fields.${k}`);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = adminOtherSectionSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      focusFirstInvalid(form.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onSaved(await api<ProfileDto>(`/admin/students/${studentId}/profile/other`, { method: 'PUT', json: parsed.data }));
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="space-y-5">
      <p className="text-sm text-muted">{t('admin.studentEdit.otherHint')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={f('websiteUrl')} type="url" dir="ltr" value={v.websiteUrl} onChange={set('websiteUrl')} error={errors.websiteUrl} />
        <TextField label={f('kaggleUrl')} type="url" dir="ltr" value={v.kaggleUrl} onChange={set('kaggleUrl')} error={errors.kaggleUrl} />
        <TextField label={f('huggingfaceUrl')} type="url" dir="ltr" value={v.huggingfaceUrl} onChange={set('huggingfaceUrl')} error={errors.huggingfaceUrl} />
        <TextField label={f('fieldOfStudy')} value={v.fieldOfStudy} onChange={set('fieldOfStudy')} error={errors.fieldOfStudy} />
        <TextField label={f('university')} value={v.university} onChange={set('university')} error={errors.university} />
        <TextField label={f('graduationYear')} inputMode="numeric" dir="ltr" value={v.graduationYear} onChange={set('graduationYear')} error={errors.graduationYear} />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-fg">{t('admin.studentEdit.hiring')}</legend>
        {/* Consent is the student's: an admin can withdraw a "yes" given before, never give one. */}
        {p.openToOpportunities ? (
          <CheckboxField label={t('admin.studentEdit.openToOpportunities')} checked={v.openToOpportunities} onChange={set('openToOpportunities')} />
        ) : (
          <p className="text-sm text-muted">{t('admin.studentEdit.openToOpportunitiesNo')}</p>
        )}
        {p.shareWithPartners ? (
          <CheckboxField label={t('admin.studentEdit.shareWithPartners')} checked={v.shareWithPartners} onChange={set('shareWithPartners')} />
        ) : (
          <p className="text-sm text-muted">{t('admin.studentEdit.shareWithPartnersNo')}</p>
        )}
        <p className="text-xs text-muted">{t('admin.studentEdit.consentHint')}</p>
      </fieldset>
      <div className="border-t border-line pt-5">
        <Button type="submit" size="lg" loading={busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Deletes the account through the usual deletion flow (sign-in blocked now, personal data
 * anonymised after 30 days), after typing the account's email address.
 */
export function DeleteAccount({ studentId, email, onDeleted }: { studentId: string; email: string; onDeleted: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/students/${studentId}/delete`, { method: 'POST', json: { confirm: typed } });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg">{t('admin.studentEdit.deleteTitle')}</h2>
      <p className="text-sm text-muted">{t('admin.studentEdit.deleteBody')}</p>
      {!open ? (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          {t('admin.studentEdit.deleteButton')}
        </Button>
      ) : (
        <form onSubmit={run} className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField label={t('admin.studentEdit.deleteType', { email })} dir="ltr" autoComplete="off" value={typed} onChange={setTyped} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={!matches} loading={busy}>
              {t('admin.studentEdit.deleteConfirm')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('admin.common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
