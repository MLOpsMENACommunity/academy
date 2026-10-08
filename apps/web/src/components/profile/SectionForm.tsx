'use client';

import {
  ALL_COUNTRIES,
  AREAS,
  areaLabels,
  CLOUD_PLATFORMS,
  cloudPlatformLabels,
  COMPANY_SIZES,
  companySizeLabels,
  countryName,
  EDUCATION_LEVELS,
  educationLevelLabels,
  EMPLOYMENT_STATUSES,
  employmentStatusLabels,
  EXPERIENCE_RANGES,
  experienceRangeLabels,
  INDUSTRIES,
  industryLabels,
  LEARNING_FORMATS,
  learningFormatLabels,
  LEARNING_GOALS,
  learningGoalLabels,
  MENA_COUNTRIES,
  profileSectionSchemas,
  REFERRAL_SOURCES,
  referralSourceLabels,
  SENIORITIES,
  seniorityLabels,
  SESSION_TIMES,
  sessionTimeLabels,
  SKILLS,
  skillLabels,
  skillLevelLabels,
  TOPICS,
  topicLabels,
  WEEKLY_HOURS,
  weeklyHoursLabels,
  type Localized,
  type ProfileDto,
  type ProfileSection,
} from '@academy/shared';
import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckboxField,
  ChipGroup,
  RadioGroup,
  SelectField,
  SkillScale,
  TagInput,
  TextField,
  type Option,
} from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';
import { CvUpload } from './CvUpload';

type Values = Record<string, unknown>;

function options(values: readonly string[], labels: Record<string, Localized>, locale: 'en' | 'ar'): Option[] {
  return values.map((v) => ({ value: v, label: labels[v]?.[locale] ?? v }));
}

const TOOL_SUGGESTIONS = [
  'MLflow', 'Kubeflow', 'Airflow', 'Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'SageMaker',
  'Vertex AI', 'Databricks', 'Spark', 'dbt', 'Kafka', 'Prometheus', 'Grafana', 'LangChain', 'LlamaIndex',
  'vLLM', 'Ray', 'FastAPI', 'Weights & Biases', 'DVC', 'Feast', 'BentoML', 'Triton',
];

/** Initial form values for a section, taken from the saved profile. */
function initialValues(section: ProfileSection, p: ProfileDto): Values {
  switch (section) {
    case 'core': {
      const detectedTz =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Africa/Cairo';
      return {
        fullNameEn: p.fullNameEn ?? '',
        fullNameAr: p.fullNameAr ?? '',
        phone: p.phone ?? '',
        country: p.country,
        city: p.city ?? '',
        timezone: p.timezone ?? detectedTz,
        employmentStatus: p.employmentStatus,
        jobTitle: p.jobTitle ?? '',
        experienceYears: p.experienceYears,
        primaryArea: p.primaryArea,
        googleEmail: p.googleEmail ?? '',
        preferredLanguage: p.preferredLanguage,
        acceptTerms: Boolean(p.acceptedTermsAt),
      };
    }
    case 'professional':
      return {
        company: p.company ?? '',
        industry: p.industry,
        companySize: p.companySize,
        mlExperienceYears: p.mlExperienceYears,
        seniority: p.seniority,
        secondaryAreas: p.secondaryAreas,
      };
    case 'education':
      return {
        educationLevel: p.educationLevel,
        fieldOfStudy: p.fieldOfStudy ?? '',
        university: p.university ?? '',
        graduationYear: p.graduationYear ?? '',
        currentlyStudying: p.currentlyStudying ?? false,
      };
    case 'skills':
      return { skills: p.skills, cloudPlatforms: p.cloudPlatforms, productionTools: p.productionTools };
    case 'goals':
      return {
        learningGoals: p.learningGoals,
        interestedTopics: p.interestedTopics,
        weeklyHours: p.weeklyHours,
        preferredTimes: p.preferredTimes,
        preferredFormat: p.preferredFormat,
      };
    case 'links':
      return {
        linkedinUrl: p.linkedinUrl ?? '',
        githubUrl: p.githubUrl ?? '',
        websiteUrl: p.websiteUrl ?? '',
        kaggleUrl: p.kaggleUrl ?? '',
        huggingfaceUrl: p.huggingfaceUrl ?? '',
      };
    case 'community':
      return {
        referralSource: p.referralSource,
        communityMember: p.communityMember ?? false,
        openToOpportunities: p.openToOpportunities,
        shareWithPartners: p.shareWithPartners,
        marketingEmails: p.marketingEmails,
      };
  }
}

export function SectionForm({
  section,
  profile,
  onSaved,
  onProfileChange,
  submitLabel,
  secondary,
}: {
  section: ProfileSection;
  profile: ProfileDto;
  onSaved: (p: ProfileDto) => void;
  /** Side updates that are not a form submit (e.g. CV upload). Defaults to onSaved. */
  onProfileChange?: (p: ProfileDto) => void;
  submitLabel?: string;
  /** Extra action next to submit (e.g. "Skip for now" in onboarding). */
  secondary?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const [values, setValues] = useState<Values>(() => initialValues(section, profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: string) => (v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  };
  const str = (key: string) => (values[key] as string | null | undefined) ?? '';
  const arr = (key: string) => (values[key] as string[] | undefined) ?? [];
  const f = (key: string) => t(`profile.fields.${key}`);

  const countryOptions = useMemo(() => {
    const all = ALL_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) })).sort((a, b) =>
      a.label.localeCompare(b.label, locale),
    );
    const mena = MENA_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) }));
    return { all, mena };
  }, [locale]);

  const timezoneOptions = useMemo(() => {
    const zones: string[] =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Cairo', 'UTC'];
    const current = str('timezone');
    const list = current && !zones.includes(current) ? [current, ...zones] : zones;
    return list.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = profileSectionSchemas[section].safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[data-invalid="true"] input')?.focus(),
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const updated = await api<ProfileDto>(`/me/profile/${section}`, { method: 'PUT', json: parsed.data });
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors());
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const link = (href: string, label: string) => (
    <Link href={href} target="_blank" className="text-primary underline">
      {label}
    </Link>
  );

  let body: ReactNode;
  switch (section) {
    case 'core': {
      const [b, m, a] = f('acceptTerms').split(/\{terms\}|\{privacy\}/);
      body = (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={f('fullNameEn')} required autoComplete="name" value={str('fullNameEn')} onChange={set('fullNameEn')} error={errors.fullNameEn} />
          <TextField label={f('fullNameAr')} dir="rtl" value={str('fullNameAr')} onChange={set('fullNameAr')} error={errors.fullNameAr} />
          <TextField label={f('phone')} required type="tel" autoComplete="tel" inputMode="tel" placeholder="+20…" hint={f('phoneHint')} value={str('phone')} onChange={set('phone')} error={errors.phone} />
          <TextField
            label={f('googleEmail')}
            required
            type="email"
            autoComplete="email"
            hint={f('googleEmailHint')}
            value={str('googleEmail')}
            onChange={set('googleEmail')}
            error={errors.googleEmail}
          />
          <SelectField
            label={f('country')}
            required
            value={str('country')}
            onChange={set('country')}
            options={countryOptions.all}
            groups={[{ label: 'MENA', options: countryOptions.mena }]}
            error={errors.country}
          />
          <TextField label={f('city')} required autoComplete="address-level2" value={str('city')} onChange={set('city')} error={errors.city} />
          <SelectField label={f('timezone')} required hint={f('timezoneHint')} value={str('timezone')} onChange={set('timezone')} options={timezoneOptions} error={errors.timezone} />
          <SelectField label={f('employmentStatus')} required value={str('employmentStatus')} onChange={set('employmentStatus')} options={options(EMPLOYMENT_STATUSES, employmentStatusLabels, locale)} error={errors.employmentStatus} />
          <TextField label={f('jobTitle')} required autoComplete="organization-title" value={str('jobTitle')} onChange={set('jobTitle')} error={errors.jobTitle} />
          <SelectField label={f('experienceYears')} required value={str('experienceYears')} onChange={set('experienceYears')} options={options(EXPERIENCE_RANGES, experienceRangeLabels, locale)} error={errors.experienceYears} />
          <SelectField label={f('primaryArea')} required value={str('primaryArea')} onChange={set('primaryArea')} options={options(AREAS, areaLabels, locale)} error={errors.primaryArea} />
          <RadioGroup
            legend={f('preferredLanguage')}
            required
            value={str('preferredLanguage')}
            onChange={set('preferredLanguage')}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
            error={errors.preferredLanguage}
          />
          <div className="sm:col-span-2">
            <CheckboxField
              checked={Boolean(values.acceptTerms)}
              onChange={set('acceptTerms')}
              error={errors.acceptTerms}
              label={
                <>
                  {b}
                  {link(`/${locale}/terms`, t('footer.terms'))}
                  {m}
                  {link(`/${locale}/privacy`, t('footer.privacy'))}
                  {a}
                </>
              }
            />
          </div>
        </div>
      );
      break;
    }
    case 'professional':
      body = (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={f('company')} autoComplete="organization" value={str('company')} onChange={set('company')} error={errors.company} />
          <SelectField label={f('industry')} required value={str('industry')} onChange={set('industry')} error={errors.industry} options={options(INDUSTRIES, industryLabels, locale)} />
          <SelectField label={f('companySize')} value={str('companySize')} onChange={set('companySize')} options={options(COMPANY_SIZES, companySizeLabels, locale)} />
          <SelectField label={f('mlExperienceYears')} required value={str('mlExperienceYears')} onChange={set('mlExperienceYears')} error={errors.mlExperienceYears} options={options(EXPERIENCE_RANGES, experienceRangeLabels, locale)} />
          <SelectField label={f('seniority')} required value={str('seniority')} onChange={set('seniority')} error={errors.seniority} options={options(SENIORITIES, seniorityLabels, locale)} />
          <div className="sm:col-span-2">
            <ChipGroup legend={f('secondaryAreas')} options={options(AREAS, areaLabels, locale)} value={arr('secondaryAreas')} onChange={set('secondaryAreas')} />
          </div>
        </div>
      );
      break;
    case 'education':
      body = (
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField label={f('educationLevel')} required value={str('educationLevel')} onChange={set('educationLevel')} error={errors.educationLevel} options={options(EDUCATION_LEVELS, educationLevelLabels, locale)} />
          <TextField label={f('fieldOfStudy')} required value={str('fieldOfStudy')} onChange={set('fieldOfStudy')} error={errors.fieldOfStudy} />
          <TextField label={f('university')} required hint={f('universityHint')} value={str('university')} onChange={set('university')} error={errors.university} />
          <TextField
            label={f('graduationYear')}
            type="number"
            inputMode="numeric"
            min={1960}
            max={new Date().getFullYear() + 8}
            value={String(values.graduationYear ?? '')}
            onChange={(v) => set('graduationYear')(v === '' ? '' : Number(v))}
            error={errors.graduationYear}
          />
          <div className="sm:col-span-2">
            <CheckboxField label={f('currentlyStudying')} checked={Boolean(values.currentlyStudying)} onChange={set('currentlyStudying')} />
          </div>
        </div>
      );
      break;
    case 'skills': {
      const skills = (values.skills as Record<string, number>) ?? {};
      const levels = Object.fromEntries(
        Object.entries(skillLevelLabels).map(([k, v]) => [Number(k), v[locale]]),
      ) as Record<number, string>;
      body = (
        <div className="space-y-6">
          <div>
            <h3 className="text-base">{f('skillsLegend')}</h3>
            <ol className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <li key={n}>
                  <strong className="text-fg">{n}</strong> · {levels[n]}
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SKILLS.map((s) => (
              <SkillScale
                key={s}
                label={skillLabels[s][locale]}
                value={skills[s]}
                levelLabels={levels}
                onChange={(v) => {
                  const next = { ...skills };
                  if (v === undefined) delete next[s];
                  else next[s] = v;
                  set('skills')(next);
                }}
              />
            ))}
          </div>
          <ChipGroup legend={f('cloudPlatforms')} options={options(CLOUD_PLATFORMS, cloudPlatformLabels, locale)} value={arr('cloudPlatforms')} onChange={set('cloudPlatforms')} />
          <TagInput label={f('productionTools')} hint={f('productionToolsHint')} value={arr('productionTools')} onChange={set('productionTools')} suggestions={TOOL_SUGGESTIONS} />
        </div>
      );
      break;
    }
    case 'goals':
      body = (
        <div className="space-y-6">
          <ChipGroup legend={f('learningGoals')} options={options(LEARNING_GOALS, learningGoalLabels, locale)} value={arr('learningGoals')} onChange={set('learningGoals')} />
          <ChipGroup legend={f('interestedTopics')} options={options(TOPICS, topicLabels, locale)} value={arr('interestedTopics')} onChange={set('interestedTopics')} />
          <RadioGroup legend={f('weeklyHours')} options={options(WEEKLY_HOURS, weeklyHoursLabels, locale)} value={str('weeklyHours')} onChange={set('weeklyHours')} />
          <ChipGroup legend={f('preferredTimes')} options={options(SESSION_TIMES, sessionTimeLabels, locale)} value={arr('preferredTimes')} onChange={set('preferredTimes')} />
          <RadioGroup legend={f('preferredFormat')} options={options(LEARNING_FORMATS, learningFormatLabels, locale)} value={str('preferredFormat')} onChange={set('preferredFormat')} />
        </div>
      );
      break;
    case 'links':
      body = (
        <div className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {(['linkedinUrl', 'githubUrl', 'websiteUrl', 'kaggleUrl', 'huggingfaceUrl'] as const).map((k) => (
              <TextField key={k} label={f(k)} type="url" inputMode="url" placeholder="https://" value={str(k)} onChange={set(k)} error={errors[k]} />
            ))}
          </div>
          <CvUpload profile={profile} onChange={onProfileChange ?? onSaved} />
        </div>
      );
      break;
    case 'community':
      body = (
        <div className="space-y-5">
          <SelectField label={f('referralSource')} value={str('referralSource')} onChange={set('referralSource')} options={options(REFERRAL_SOURCES, referralSourceLabels, locale)} />
          <CheckboxField label={f('communityMember')} checked={Boolean(values.communityMember)} onChange={set('communityMember')} />
          <hr className="border-line" />
          <CheckboxField label={f('openToOpportunities')} checked={Boolean(values.openToOpportunities)} onChange={set('openToOpportunities')} />
          <CheckboxField
            label={f('shareWithPartners')}
            hint={f('shareWithPartnersHint')}
            checked={Boolean(values.shareWithPartners)}
            onChange={set('shareWithPartners')}
          />
          <CheckboxField label={f('marketingEmails')} checked={Boolean(values.marketingEmails)} onChange={set('marketingEmails')} />
        </div>
      );
      break;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {body}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" size="lg" loading={busy}>
          {submitLabel ?? t('common.save')}
        </Button>
        {secondary}
        <span role="status" className="text-sm font-medium text-success">
          {saved && !submitLabel ? `✓ ${t('common.saved')}` : ''}
        </span>
      </div>
    </form>
  );
}
