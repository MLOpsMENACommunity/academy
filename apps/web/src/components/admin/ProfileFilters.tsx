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
  MENA_COUNTRIES,
  SENIORITIES,
  seniorityLabels,
  SKILLS,
  skillLabels,
  TOPICS,
  topicLabels,
  WEEKLY_HOURS,
  weeklyHoursLabels,
  type Localized,
} from '@academy/shared';
import { useMemo } from 'react';
import { useI18n } from '@/i18n/client';
import { MultiSelect, type Opt } from './MultiSelect';
import { listParam } from './query';

const selectClass = 'block min-h-10 w-full rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm';

/** The profile filters shared by Applications and Students (values are URL query params). */
export function ProfileFilters({ params, set }: { params: Record<string, string>; set: (n: Record<string, string | string[] | undefined>) => void }) {
  const { locale, t } = useI18n();
  const opts = (values: readonly string[], labels: Record<string, Localized>): Opt[] => values.map((v) => ({ value: v, label: labels[v]?.[locale] ?? v }));
  const countries = useMemo(() => {
    const mena = new Set<string>(MENA_COUNTRIES);
    const all = ALL_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) }));
    return [...all.filter((c) => mena.has(c.value)), ...all.filter((c) => !mena.has(c.value)).sort((a, b) => a.label.localeCompare(b.label, locale))];
  }, [locale]);
  const f = (k: string) => t(`admin.filters.${k}`);
  const skills = listParam(params.skills).map((p) => {
    const [skill, min] = p.split(':');
    return { skill: skill ?? '', min: min ?? '3' };
  });
  const setSkills = (list: { skill: string; min: string }[]) => set({ skills: list.filter((s) => s.skill).map((s) => `${s.skill}:${s.min}`) });
  const single = (key: string, values: readonly string[], labels: Record<string, Localized>) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-fg">{f(key)}</span>
      <select className={selectClass} value={params[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })}>
        <option value="">{t('admin.common.any')}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]?.[locale] ?? v}
          </option>
        ))}
      </select>
    </label>
  );
  const bool = (key: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-fg">{f(key)}</span>
      <select className={selectClass} value={params[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })}>
        <option value="">{t('admin.common.any')}</option>
        <option value="true">{t('admin.common.yes')}</option>
        <option value="false">{t('admin.common.no')}</option>
      </select>
    </label>
  );
  const multi = (key: string, options: Opt[]) => (
    <MultiSelect label={f(key)} options={options} value={listParam(params[key])} onChange={(v) => set({ [key]: v })} />
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {multi('country', countries)}
      {single('experienceMin', EXPERIENCE_RANGES, experienceRangeLabels)}
      {single('mlExperienceMin', EXPERIENCE_RANGES, experienceRangeLabels)}
      {multi('seniority', opts(SENIORITIES, seniorityLabels))}
      {multi('primaryArea', opts(AREAS, areaLabels))}
      {multi('secondaryArea', opts(AREAS, areaLabels))}
      {multi('employmentStatus', opts(EMPLOYMENT_STATUSES, employmentStatusLabels))}
      {multi('educationLevel', opts(EDUCATION_LEVELS, educationLevelLabels))}
      {multi('cloud', opts(CLOUD_PLATFORMS, cloudPlatformLabels))}
      {single('weeklyHoursMin', WEEKLY_HOURS, weeklyHoursLabels)}
      {multi('topic', opts(TOPICS, topicLabels))}
      {bool('openToOpportunities')}
      <div className="sm:col-span-2 lg:col-span-4">
        <span className="mb-1 block text-xs font-semibold text-fg">{f('skills')}</span>
        <div className="flex flex-wrap items-end gap-2">
          {skills.map((s, i) => (
            <span key={i} className="flex items-center gap-1 rounded-lg border border-line p-1">
              <select
                aria-label={f('skills')}
                className="min-h-9 rounded border border-line-strong bg-card px-1 text-base md:text-sm"
                value={s.skill}
                onChange={(e) => setSkills(skills.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)))}
              >
                {SKILLS.map((k) => (
                  <option key={k} value={k}>
                    {skillLabels[k][locale]}
                  </option>
                ))}
              </select>
              <select
                aria-label={f('skillLevel')}
                className="min-h-9 rounded border border-line-strong bg-card px-1 text-base md:text-sm"
                value={s.min}
                onChange={(e) => setSkills(skills.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    ≥ {n}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={t('admin.common.remove')} className="grid size-8 place-items-center rounded hover:bg-muted-bg" onClick={() => setSkills(skills.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
          <button type="button" className="min-h-9 rounded-lg border border-dashed border-line-strong px-3 text-sm" onClick={() => setSkills([...skills, { skill: 'KUBERNETES', min: '3' }])}>
            + {f('addSkill')}
          </button>
        </div>
      </div>
    </div>
  );
}
