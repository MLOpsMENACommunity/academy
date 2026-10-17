'use client';

import {
  ALL_COUNTRIES,
  AREAS,
  areaLabels,
  CLOUD_PLATFORMS,
  cloudPlatformLabels,
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
  PRODUCTION_TOOL_MAX_LENGTH,
  adminSectionSchemaFor,
  sectionSchemaFor,
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
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckboxField,
  ChipGroup,
  focusFirstInvalid,
  RadioGroup,
  SelectField,
  SkillScale,
  TagInput,
  TextField,
  type Option,
} from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { issuesToErrors } from '@/lib/zod-errors';
import { SavedCv } from './SavedCv';

type Values = Record<string, unknown>;

function options(values: readonly string[], labels: Record<string, Localized>, locale: 'en' | 'ar'): Option[] {
  return values.map((v) => ({ value: v, label: labels[v]?.[locale] ?? v }));
}

const TOOL_SUGGESTIONS = [
  'MLflow', 'Kubeflow', 'Airflow', 'Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'SageMaker',
  'Vertex AI', 'Databricks', 'Spark', 'dbt', 'Kafka', 'Prometheus', 'Grafana', 'LangChain', 'LlamaIndex',
  'vLLM', 'Ray', 'FastAPI', 'Weights & Biases', 'DVC', 'Feast', 'BentoML', 'Triton',
];

/**
 * Initial form values for a section, taken from the saved profile.
 * `language` preselects the preferred language when none is saved yet
 * (the account's language, else the UI's).
 */
function initialValues(section: ProfileSection, p: ProfileDto, language: 'en' | 'ar', admin = false): Values {
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
        // An admin's device says nothing about the student's timezone.
        timezone: p.timezone ?? (admin ? null : detectedTz),
        employmentStatus: p.employmentStatus,
        jobTitle: p.jobTitle ?? '',
        experienceYears: p.experienceYears,
        primaryArea: p.primaryArea,
        googleEmail: p.googleEmail ?? '',
        preferredLanguage: p.preferredLanguage ?? (admin ? null : language),
        acceptTerms: Boolean(p.acceptedTermsAt),
      };
    }
    case 'professional':
      return {
        company: p.company ?? '',
        industry: p.industry,
        mlExperienceYears: p.mlExperienceYears,
        seniority: p.seniority,
        secondaryAreas: p.secondaryAreas,
      };
    case 'education':
      return { educationLevel: p.educationLevel };
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
      return { linkedinUrl: p.linkedinUrl ?? '', githubUrl: p.githubUrl ?? '' };
    case 'community': {
      // Nothing is preselected for a new student. A "yes" given before these became
      // required questions is still in effect, so it is shown (and can be changed).
      const answer = (v: boolean | null) => (p.communityAnsweredAt || v ? Boolean(v) : null);
      return {
        // "Open to job opportunities" and "Share with hiring partners" are no longer asked:
        // never sent, so their saved answers stay as they are.
        referralSource: p.referralSource,
        communityMember: answer(p.communityMember),
        marketingEmails: answer(p.marketingEmails),
        telegramUsername: p.telegramUsername ?? '',
        discordUsername: p.discordUsername ?? '',
      };
    }
  }
}

export function SectionForm({
  section,
  profile,
  onSaved,
  onProfileChange,
  submitLabel,
  secondary,
  adminFor,
}: {
  section: ProfileSection;
  profile: ProfileDto;
  onSaved: (p: ProfileDto) => void;
  /** Side updates that are not a form submit (e.g. removing a saved CV). Defaults to onSaved. */
  onProfileChange?: (p: ProfileDto) => void;
  submitLabel?: string;
  /** Extra action next to submit (e.g. "Skip for now" in onboarding). */
  secondary?: ReactNode;
  /**
   * An admin editing this student's profile (Admin → Students → {student}): same fields and
   * validation, saved through the admin API. The Terms checkbox isn't shown (only the student
   * accepts them), and consents can only be turned off.
   */
  adminFor?: string;
}) {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(() => initialValues(section, profile, user?.locale ?? locale, Boolean(adminFor)));
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
  const f = (key: string, vars?: Record<string, string | number>) => t(`profile.fields.${key}`, vars);
  /** A required Yes/No question with nothing preselected. */
  // A render helper, not a component: a component defined here would remount on every keystroke.
  const yesNo = (name: string, label: string, hint?: string) => {
    const v = values[name];
    return (
      <RadioGroup
        legend={label}
        hint={hint}
        required
        name={name}
        error={errors[name]}
        value={v === true ? 'yes' : v === false ? 'no' : null}
        onChange={(x) => set(name)(x === 'yes')}
        options={[
          { value: 'yes', label: t('common.yes') },
          { value: 'no', label: t('common.no') },
        ]}
      />
    );
  };

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
    // Cross-section checks (ML/AI vs total experience) use the saved profile, as the API does.
    const parsed = (adminFor ? adminSectionSchemaFor(section, profile) : sectionSchemaFor(section, profile)).safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t));
      setFormError(t('forms.fixErrors'));
      focusFirstInvalid(form.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const url = adminFor ? `/admin/students/${adminFor}/profile/${section}` : `/me/profile/${section}`;
      const updated = await api<ProfileDto>(url, { method: 'PUT', json: parsed.data });
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) {
        setErrors(err.fieldErrors());
        focusFirstInvalid(form.current);
      }
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
      // The checkbox's name is plain text; the links sit in its description, so a
      // screen reader reads the whole sentence and then the two links (QA L14).
      const consent = f('acceptTerms', { terms: t('footer.terms'), privacy: t('footer.privacy') });
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
          <SelectField label={f('timezone')} required hint={adminFor ? undefined : f('timezoneHint')} value={str('timezone')} onChange={set('timezone')} options={timezoneOptions} error={errors.timezone} />
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
          {!adminFor && (
          <div className="sm:col-span-2">
            <CheckboxField
              checked={Boolean(values.acceptTerms)}
              onChange={set('acceptTerms')}
              error={errors.acceptTerms}
              label={consent}
              hint={
                <>
                  {link(`/${locale}/terms`, t('footer.terms'))}
                  <span aria-hidden> · </span>
                  {link(`/${locale}/privacy`, t('footer.privacy'))}
                </>
              }
            />
          </div>
          )}
        </div>
      );
      break;
    }
    case 'professional':
      body = (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={f('company')} autoComplete="organization" value={str('company')} onChange={set('company')} error={errors.company} />
          <SelectField label={f('industry')} value={str('industry')} onChange={set('industry')} error={errors.industry} options={options(INDUSTRIES, industryLabels, locale)} />
          <SelectField label={f('mlExperienceYears')} required value={str('mlExperienceYears')} onChange={set('mlExperienceYears')} error={errors.mlExperienceYears} options={options(EXPERIENCE_RANGES, experienceRangeLabels, locale)} />
          <SelectField label={f('seniority')} required value={str('seniority')} onChange={set('seniority')} error={errors.seniority} options={options(SENIORITIES, seniorityLabels, locale)} />
          <div className="sm:col-span-2">
            {/* The primary area (from the basics step) is not offered again here. */}
            <ChipGroup
              legend={f('secondaryAreas')}
              options={options(AREAS.filter((a) => a !== profile.primaryArea), areaLabels, locale)}
              value={arr('secondaryAreas').filter((a) => a !== profile.primaryArea)}
              onChange={set('secondaryAreas')}
            />
          </div>
        </div>
      );
      break;
    case 'education':
      body = (
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField label={f('educationLevel')} required value={str('educationLevel')} onChange={set('educationLevel')} error={errors.educationLevel} options={options(EDUCATION_LEVELS, educationLevelLabels, locale)} />
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
          <TagInput
            label={f('productionTools')}
            hint={f('productionToolsHint', { max: PRODUCTION_TOOL_MAX_LENGTH })}
            value={arr('productionTools')}
            onChange={set('productionTools')}
            suggestions={TOOL_SUGGESTIONS}
            maxLength={PRODUCTION_TOOL_MAX_LENGTH}
          />
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
            <TextField label={f('linkedinUrl')} required type="url" inputMode="url" placeholder="https://www.linkedin.com/in/…" value={str('linkedinUrl')} onChange={set('linkedinUrl')} error={errors.linkedinUrl} />
            <TextField label={f('githubUrl')} required type="url" inputMode="url" placeholder="https://github.com/…" value={str('githubUrl')} onChange={set('githubUrl')} error={errors.githubUrl} />
          </div>
          {/* CVs are no longer collected; a student who uploaded one before can still open or remove it. */}
          {profile.hasCv && !adminFor && <SavedCv profile={profile} onChange={onProfileChange ?? onSaved} />}
        </div>
      );
      break;
    case 'community':
      body = (
        <div className="space-y-5">
          <SelectField label={f('referralSource')} required value={str('referralSource')} onChange={set('referralSource')} error={errors.referralSource} options={options(REFERRAL_SOURCES, referralSourceLabels, locale)} />
          {yesNo('communityMember', f('communityMember'))}
          {/* Required for students (the community runs on these chats); an admin may leave them empty. */}
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label={f('telegramUsername')}
              required={!adminFor}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="@username"
              hint={f('telegramUsernameHint')}
              value={str('telegramUsername')}
              onChange={set('telegramUsername')}
              error={errors.telegramUsername}
            />
            <TextField
              label={f('discordUsername')}
              required={!adminFor}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="username"
              hint={f('discordUsernameHint')}
              value={str('discordUsername')}
              onChange={set('discordUsername')}
              error={errors.discordUsername}
            />
          </div>
          <hr className="border-line" />
          {yesNo('marketingEmails', f('marketingEmails'), adminFor ? t('admin.studentEdit.consentHint') : undefined)}
        </div>
      );
      break;
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate aria-busy={busy || undefined} className="space-y-6">
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
