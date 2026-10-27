'use client';

import {
  areaLabels,
  cloudPlatformLabels,
  countryName,
  educationLevelLabels,
  employmentStatusLabels,
  experienceRangeLabels,
  industryLabels,
  learningGoalLabels,
  SENIORITY_BANDS,
  seniorityLabels,
  skillLabels,
  TALENT_BENCH_SIZE,
  TALENT_LIMIT,
  TALENT_POPULATIONS,
  TALENT_ROLES,
  talentRoleLabels,
  topicLabels,
  weeklyHoursLabels,
  type Locale,
  type Localized,
  type TalentCount,
  type TalentInsightsDto,
} from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ProfileFilters } from '@/components/admin/ProfileFilters';
import { useQueryState } from '@/components/admin/query';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

type Dimension = Exclude<keyof TalentInsightsDto, 'truncated' | 'totals' | 'skills' | 'roles' | 'record' | 'bench'>;

/** How each distribution's keys are shown (tools are free text, shown as typed). */
const LABELS: Record<Dimension, Record<string, Localized> | 'country' | null> = {
  primaryArea: areaLabels,
  secondaryAreas: areaLabels,
  seniority: seniorityLabels,
  experience: experienceRangeLabels,
  mlExperience: experienceRangeLabels,
  country: 'country',
  employment: employmentStatusLabels,
  education: educationLevelLabels,
  industry: industryLabels,
  cloud: cloudPlatformLabels,
  tools: null,
  goals: learningGoalLabels,
  topics: topicLabels,
  weeklyHours: weeklyHoursLabels,
};

const SECTIONS: { key: string; dims: Dimension[] }[] = [
  { key: 'profile', dims: ['seniority', 'experience', 'mlExperience', 'primaryArea', 'secondaryAreas', 'education'] },
  { key: 'where', dims: ['country', 'employment', 'industry', 'weeklyHours'] },
  { key: 'stack', dims: ['cloud', 'tools'] },
  { key: 'intent', dims: ['goals', 'topics'] },
];

function labelOf(dim: Dimension, key: string, locale: Locale): string {
  const l = LABELS[dim];
  if (l === 'country') return countryName(key, locale);
  return l?.[key]?.[locale] ?? key;
}

const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** One series of counts: a bar per answer, the count and its share of the matching students beside it. */
function CountBars({ title, items, total, label }: { title: string; items: TalentCount[]; total: number; label: (key: string) => string }) {
  const { t } = useI18n();
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <section>
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('admin.talents.dist.empty')}</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-sm">
          {items.map((i) => (
            <li key={i.key} className="grid grid-cols-[minmax(0,9rem)_1fr_5.5rem] items-center gap-2" title={`${label(i.key)}: ${i.count} (${share(i.count, total)}%)`}>
              <span className="truncate">{label(i.key)}</span>
              <span className="h-3 rounded-full bg-muted-bg" aria-hidden>
                <span className="block h-3 rounded-full bg-primary" style={{ width: `${(i.count / max) * 100}%` }} />
              </span>
              <span className="text-end tabular-nums">
                {i.count} <span className="text-xs text-muted">({share(i.count, total)}%)</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-fg tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function TalentInsights() {
  const { locale, t } = useI18n();
  const { params, query, set, replaceAll } = useQueryState();
  const [d, setD] = useState<TalentInsightsDto | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState(params.q ?? '');
  useEffect(() => setQ(params.q ?? ''), [params.q]);

  useEffect(() => {
    let current = true;
    setError(false);
    api<TalentInsightsDto>(`/admin/talents?${query}`)
      .then((r) => current && setD(r))
      .catch(() => current && setError(true));
    return () => {
      current = false;
    };
  }, [query]);

  // The students directory takes the same filters (not the population), and exports them as CSV.
  const studentsQuery = (() => {
    const p = new URLSearchParams(query);
    p.delete('population');
    return p.toString();
  })();
  const total = d?.totals.talents ?? 0;
  const skill = (s: string) => skillLabels[s as keyof typeof skillLabels]?.[locale] ?? s;
  const dash = '–';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">{t('admin.talents.title')}</h1>
          <p className="max-w-2xl text-sm text-muted">{t('admin.talents.subtitle')}</p>
        </div>
        <Link href={`/${locale}/admin/students${studentsQuery ? `?${studentsQuery}` : ''}`} className={buttonClass('secondary', 'sm')}>
          {t('admin.talents.openInStudents')}
        </Link>
      </div>

      <div className="mt-5 space-y-4 rounded-card border border-line bg-card p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set({ q });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="block min-w-64 flex-1">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.common.search')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="block min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-base md:text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{t('admin.talents.population')}</span>
            <select
              className="block min-h-10 rounded-lg border border-line-strong bg-card px-2 text-base md:text-sm"
              value={params.population ?? 'all'}
              onChange={(e) => set({ population: e.target.value === 'all' ? undefined : e.target.value })}
            >
              {TALENT_POPULATIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`admin.talents.populations.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </form>
        <ProfileFilters params={params} set={set} />
        {query && (
          <div className="flex justify-end border-t border-line pt-3">
            <button type="button" className="text-sm text-muted underline" onClick={() => replaceAll('')}>
              {t('admin.common.reset')}
            </button>
          </div>
        )}
      </div>

      {error && <Alert tone="danger" className="mt-4">{t('errors.generic')}</Alert>}
      {d?.truncated && <Alert tone="warning" className="mt-4">{t('admin.talents.truncated', { limit: TALENT_LIMIT })}</Alert>}
      <p className="mt-4 text-xs text-muted">{t('admin.talents.selfRated')}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="talent-kpis">
        <Stat label={t('admin.talents.kpi.talents')} value={d ? total : dash} />
        <Stat label={t('admin.talents.kpi.withStrongSkill')} value={d ? `${d.totals.withStrongSkill} (${share(d.totals.withStrongSkill, total)}%)` : dash} />
        <Stat label={t('admin.talents.kpi.available')} value={d ? `${d.totals.available} (${share(d.totals.available, total)}%)` : dash} hint={t('admin.talents.kpi.availableHint')} />
        <Stat label={t('admin.talents.kpi.experienced')} value={d ? `${d.totals.experienced} (${share(d.totals.experienced, total)}%)` : dash} />
        <Stat label={t('admin.talents.kpi.certified')} value={d ? `${d.totals.certified} (${share(d.totals.certified, total)}%)` : dash} />
        <Stat label={t('admin.talents.kpi.withSkills')} value={d ? `${d.totals.withSkills} (${share(d.totals.withSkills, total)}%)` : dash} hint={t('admin.talents.kpi.withSkillsHint')} />
      </div>

      {d && (
        <>
          <Card className="mt-6">
            <h2 className="text-xl">{t('admin.talents.roles.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.talents.roles.note')}</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {d.roles.map((r) => {
                const def = TALENT_ROLES.find((x) => x.key === r.key)!;
                return (
                  <li key={r.key} className="flex flex-col rounded-xl border border-line p-4" data-testid={`talent-role-${r.key}`}>
                    <p className="font-semibold text-fg">{talentRoleLabels[r.key][locale]}</p>
                    <p className="mt-1">
                      <span className="text-3xl font-semibold tabular-nums text-fg">{r.total}</span>{' '}
                      <span className="text-sm text-muted">
                        {t('admin.talents.roles.fit')} · {r.available} {t('admin.talents.roles.available')}
                      </span>
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {SENIORITY_BANDS.map((b) => (
                        <li key={b} className="rounded-md bg-muted-bg px-2 py-0.5">
                          {t(`admin.talents.roles.bands.${b}`)} <span className="font-semibold tabular-nums">{r.bands[b]}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">
                      {t('admin.talents.roles.requires')}: {Object.entries(def.skills).map(([s, min]) => `${skill(s)} ${min}+`).join(' · ')}
                    </p>
                    <button type="button" className={buttonClass('secondary', 'sm', 'mt-3 self-start')} onClick={() => set({ skills: r.skills })} disabled={r.total === 0}>
                      {t('admin.talents.roles.show')}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="mt-6">
            <h2 className="text-xl">{t('admin.talents.skills.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.talents.skills.note', { rated: d.totals.withSkills })}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm" data-testid="talent-skills">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start">{t('admin.talents.skills.skill')}</th>
                    <th className="w-1/3 p-2 text-start">{t('admin.talents.skills.strong')}</th>
                    <th className="p-2 text-end">{t('admin.talents.skills.expert')}</th>
                    <th className="p-2 text-end">{t('admin.talents.skills.average')}</th>
                    <th className="p-2 text-end">{t('admin.talents.skills.rated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.skills.map((s) => {
                    // Of the students who rated their skills (an optional profile step), not of everyone.
                    const pct = share(s.strong, d.totals.withSkills);
                    return (
                      <tr key={s.skill} className="border-t border-line">
                        <td className="p-2">
                          <button type="button" className="text-start font-medium text-primary hover:underline" title={t('admin.talents.skills.filter')} onClick={() => set({ skills: `${s.skill}:4` })}>
                            {skill(s.skill)}
                          </button>
                          {d.totals.withSkills > 0 && pct < 5 && (
                            <span className="ms-2 inline-block align-middle">
                              <Badge tone="warning">{t('admin.talents.skills.gap')}</Badge>
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2" title={`${s.strong} (${pct}%)`}>
                            <span className="h-3 flex-1 rounded-full bg-muted-bg" aria-hidden>
                              <span className="block h-3 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-20 text-end tabular-nums">
                              {s.strong} <span className="text-xs text-muted">({pct}%)</span>
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-end tabular-nums">{s.expert}</td>
                        <td className="p-2 text-end tabular-nums">{s.average ?? '—'}</td>
                        <td className="p-2 text-end tabular-nums">{s.rated}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-6">
            <h2 className="text-xl">{t('admin.talents.record.title')}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label={t('admin.talents.record.enrolled')} value={d.record.enrolled} />
              <Stat label={t('admin.talents.record.certified')} value={d.record.certified} />
              <Stat label={t('admin.talents.record.attendance')} value={d.record.attendance === null ? '—' : `${d.record.attendance}%`} />
              <Stat label={t('admin.talents.record.graded')} value={d.record.graded === null ? '—' : `${d.record.graded}%`} />
              <Stat label={t('admin.talents.record.points')} value={d.record.points} />
            </div>
          </Card>

          {SECTIONS.map((sec) => (
            <Card key={sec.key} className="mt-6">
              <h2 className="text-xl">{t(`admin.talents.sections.${sec.key}`)}</h2>
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                {sec.dims.map((dim) => (
                  <CountBars key={dim} title={t(`admin.talents.dist.${dim}`)} items={d[dim]} total={total} label={(k) => labelOf(dim, k, locale)} />
                ))}
              </div>
            </Card>
          ))}

          <Card className="mt-6">
            <h2 className="text-xl">{t('admin.talents.bench.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.talents.bench.note', { count: TALENT_BENCH_SIZE })}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm" data-testid="talent-bench">
                <thead className="bg-muted-bg text-xs text-muted">
                  <tr>
                    <th className="p-3 text-start">{t('admin.talents.bench.student')}</th>
                    <th className="p-3 text-start">{t('admin.talents.bench.topSkills')}</th>
                    <th className="p-3 text-start">{t('admin.talents.bench.record')}</th>
                    <th className="p-3 text-end">{t('admin.talents.bench.score')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bench.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-muted">
                        {t('admin.common.none')}
                      </td>
                    </tr>
                  )}
                  {d.bench.map((b) => (
                    <tr key={b.id} className="border-t border-line align-top hover:bg-muted-bg/50">
                      <td className="p-3">
                        <Link href={`/${locale}/admin/students/${b.id}`} className="font-semibold text-primary hover:underline">
                          {b.name ?? '—'}
                        </Link>
                        <p className="text-xs text-muted">
                          {[
                            b.jobTitle,
                            b.seniority ? labelOf('seniority', b.seniority, locale) : null,
                            b.mlExperienceYears ? `${t('admin.talents.dist.mlExperience')}: ${labelOf('mlExperience', b.mlExperienceYears, locale)}` : null,
                            b.country ? countryName(b.country, locale) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {b.available && <Badge tone="success">{t('admin.talents.bench.available')}</Badge>}
                        </div>
                      </td>
                      <td className="p-3">
                        <ul className="flex flex-wrap gap-1.5 text-xs">
                          {b.topSkills.map((s) => (
                            <li key={s.skill} className="rounded-md bg-muted-bg px-2 py-0.5">
                              {skill(s.skill)} <span className="font-semibold tabular-nums">{s.level}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="p-3 text-xs">
                        {t('admin.talents.bench.certificates')}: <span className="tabular-nums">{b.certificates}</span>
                        <br />
                        {t('admin.talents.bench.attendance')}: <span className="tabular-nums">{b.attendance === null ? '—' : `${b.attendance}%`}</span>
                        <br />
                        {t('admin.talents.bench.graded')}: <span className="tabular-nums">{b.graded === null ? '—' : `${b.graded}%`}</span>
                        <br />
                        {t('admin.talents.bench.points')}: <span className="tabular-nums">{b.points}</span>
                      </td>
                      <td className="p-3 text-end text-lg font-semibold tabular-nums">{b.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
