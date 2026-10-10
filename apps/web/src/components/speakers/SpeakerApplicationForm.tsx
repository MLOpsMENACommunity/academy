'use client';

import {
  ALL_COUNTRIES,
  COURSE_LANGUAGES,
  countryName,
  courseLanguageLabels,
  MENA_COUNTRIES,
  SPEAKER_AREAS,
  SPEAKER_FORMATS,
  speakerApplicationSchema,
  speakerAreaLabels,
  speakerFormatLabels,
  type MeResponse,
  type SpeakerApplicationDto,
} from '@academy/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ChipGroup, focusFirstInvalid, RadioGroup, SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { issuesToErrors } from '@/lib/zod-errors';
import { monthLabel, speakerError, upcomingMonths } from './shared';

type Values = {
  fullName: string;
  phone: string;
  linkedinUrl: string;
  title: string;
  company: string;
  country: string;
  bio: string;
  photoUrl: string;
  areas: string[];
  sessionTitle: string;
  abstract: string;
  format: string;
  language: string;
  preferredMonths: string[];
};

function initial(app: SpeakerApplicationDto | null, me: MeResponse): Values {
  return {
    fullName: app?.fullName ?? me.name ?? '',
    phone: app?.phone ?? '',
    linkedinUrl: app?.linkedinUrl ?? '',
    title: app?.title ?? '',
    company: app?.company ?? '',
    country: app?.country ?? '',
    bio: app?.bio ?? '',
    photoUrl: app?.photoUrl ?? '',
    areas: app?.areas ?? [],
    sessionTitle: app?.sessionTitle ?? '',
    abstract: app?.abstract ?? '',
    format: app?.format ?? '',
    language: app?.language ?? '',
    preferredMonths: app?.preferredMonths ?? [],
  };
}

/** The speaker application: who you are, what you'd like to talk about, and when. */
export function SpeakerApplicationForm({ me, application }: { me: MeResponse; application: SpeakerApplicationDto | null }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [v, setV] = useState<Values>(() => initial(application, me));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Values>(k: K) => (x: Values[K] | null) => setV((p) => ({ ...p, [k]: x ?? (Array.isArray(p[k]) ? [] : '') }));
  const label = (k: string) => t(`speakers.portal.form.${k}`);

  const countries = useMemo(() => {
    const all = ALL_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale));
    return { all, mena: MENA_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) })) };
  }, [locale]);
  const months = useMemo(() => {
    const list = upcomingMonths(6);
    for (const m of v.preferredMonths) if (!list.includes(m)) list.push(m);
    return list.sort().map((m) => ({ value: m, label: monthLabel(m, locale) }));
  }, [locale, v.preferredMonths]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = speakerApplicationSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      focusFirstInvalid(form.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api<SpeakerApplicationDto>('/speaker/application', { method: 'PUT', json: parsed.data });
      router.push(`/${locale}/speaker?sent=1`);
    } catch (err) {
      setFormError(speakerError(err, t));
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="space-y-5">
      {application?.status === 'REJECTED' && application.reviewNote && (
        <Alert tone="warning" title={t('speakers.portal.form.rejectedTitle')}>
          {application.reviewNote}
        </Alert>
      )}
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Card>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-fg">{label('aboutYou')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={label('fullName')} required autoComplete="name" value={v.fullName} onChange={set('fullName')} error={errors.fullName} />
            <div>
              <p className="mb-1.5 text-sm font-semibold text-fg">{label('email')}</p>
              <p className="flex min-h-12 items-center rounded-lg bg-muted-bg px-3 break-all ltr-embed text-body">{me.email}</p>
              <p className="mt-1 text-xs text-muted">{label('emailHint')}</p>
            </div>
            <TextField label={label('phone')} required type="tel" autoComplete="tel" dir="ltr" value={v.phone} onChange={set('phone')} error={errors.phone} hint={label('phoneHint')} />
            <TextField
              label={label('linkedinUrl')}
              required
              type="url"
              dir="ltr"
              placeholder="https://www.linkedin.com/in/…"
              value={v.linkedinUrl}
              onChange={set('linkedinUrl')}
              error={errors.linkedinUrl}
            />
            <TextField label={label('title')} required value={v.title} onChange={set('title')} error={errors.title} />
            <TextField label={label('company')} value={v.company} onChange={set('company')} error={errors.company} />
            <SelectField
              label={label('country')}
              required
              value={v.country}
              onChange={set('country')}
              error={errors.country}
              groups={[{ label: t('speakers.portal.form.mena'), options: countries.mena }]}
              options={countries.all}
            />
            <TextField
              label={label('photoUrl')}
              type="url"
              dir="ltr"
              placeholder="https://…"
              value={v.photoUrl}
              onChange={set('photoUrl')}
              error={errors.photoUrl}
              hint={label('photoHint')}
            />
          </div>
          <TextAreaField label={label('bio')} required rows={4} maxLength={1500} value={v.bio} onChange={set('bio')} error={errors.bio} hint={t('speakers.portal.form.bioHint', { n: v.bio.trim().length })} />
        </fieldset>
      </Card>
      <Card>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-fg">{label('yourSession')}</legend>
          <ChipGroup
            legend={label('areas')}
            required
            value={v.areas}
            onChange={set('areas')}
            error={errors.areas ?? errors['areas.0']}
            options={SPEAKER_AREAS.map((a) => ({ value: a, label: speakerAreaLabels[a][locale] }))}
          />
          <TextField label={label('sessionTitle')} required value={v.sessionTitle} onChange={set('sessionTitle')} error={errors.sessionTitle} />
          <TextAreaField
            label={label('abstract')}
            required
            rows={6}
            maxLength={2000}
            value={v.abstract}
            onChange={set('abstract')}
            error={errors.abstract}
            hint={t('speakers.portal.form.abstractHint', { n: v.abstract.trim().length })}
          />
          <RadioGroup
            legend={label('format')}
            required
            value={v.format}
            onChange={set('format')}
            error={errors.format}
            options={SPEAKER_FORMATS.map((f) => ({ value: f, label: speakerFormatLabels[f][locale] }))}
          />
          <RadioGroup
            legend={label('language')}
            required
            value={v.language}
            onChange={set('language')}
            error={errors.language}
            options={COURSE_LANGUAGES.map((l) => ({ value: l, label: courseLanguageLabels[l][locale] }))}
          />
          <ChipGroup
            legend={label('preferredMonths')}
            required
            value={v.preferredMonths}
            onChange={set('preferredMonths')}
            error={errors.preferredMonths}
            options={months}
          />
        </fieldset>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={busy}>
          {application ? t('speakers.portal.form.resubmit') : t('speakers.portal.form.submit')}
        </Button>
        <p className="text-sm text-muted">{t('speakers.portal.form.reviewNote')}</p>
      </div>
    </form>
  );
}
