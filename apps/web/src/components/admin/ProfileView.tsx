'use client';

import {
  areaLabels,
  cloudPlatformLabels,
  countryName,
  educationLevelLabels,
  employmentStatusLabels,
  experienceRangeLabels,
  industryLabels,
  learningFormatLabels,
  learningGoalLabels,
  referralSourceLabels,
  seniorityLabels,
  sessionTimeLabels,
  skillLabels,
  topicLabels,
  weeklyHoursLabels,
  type Localized,
  type ProfileDto,
  type Skill,
} from '@academy/shared';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { formatDate } from '@/lib/format';

/** Read-only profile for admins (they can view but never edit; notes are separate). */
export function ProfileView({ profile: p }: { profile: ProfileDto }) {
  const { locale, t } = useI18n();
  // Anonymised accounts keep their applications with an empty profile snapshot.
  if (!p || Object.keys(p).length === 0) return <p className="text-sm text-muted">{t('admin.apps.noProfile')}</p>;
  const f = (k: string) => t(`profile.fields.${k}`);
  const one = (map: Record<string, Localized>, v: string | null) => (v ? (map[v]?.[locale] ?? v) : null);
  const many = (map: Record<string, Localized>, v: string[]) => (v.length ? v.map((x) => map[x]?.[locale] ?? x).join(', ') : null);
  const link = (url: string | null) =>
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="ltr-embed text-primary underline">
        {url.replace(/^https?:\/\//, '')}
      </a>
    ) : null;
  const yes = (v: boolean | null) => (v === null ? null : v ? t('admin.common.yes') : t('admin.common.no'));
  const sections: [string, [string, ReactNode][]][] = [
    [
      'core',
      [
        [f('fullNameEn'), p.fullNameEn],
        [f('fullNameAr'), p.fullNameAr],
        [f('phone'), p.phone && <span className="ltr-embed">{p.phone}</span>],
        [f('country'), p.country && countryName(p.country, locale)],
        [f('city'), p.city],
        [f('timezone'), p.timezone],
        [f('employmentStatus'), one(employmentStatusLabels, p.employmentStatus)],
        [f('jobTitle'), p.jobTitle],
        [f('experienceYears'), one(experienceRangeLabels, p.experienceYears)],
        [f('primaryArea'), one(areaLabels, p.primaryArea)],
        [f('googleEmail'), p.googleEmail && <span className="ltr-embed">{p.googleEmail}</span>],
      ],
    ],
    [
      'professional',
      [
        [f('company'), p.company],
        [f('industry'), one(industryLabels, p.industry)],
        [f('mlExperienceYears'), one(experienceRangeLabels, p.mlExperienceYears)],
        [f('seniority'), one(seniorityLabels, p.seniority)],
        [f('secondaryAreas'), many(areaLabels, p.secondaryAreas)],
      ],
    ],
    [
      'education',
      [
        [f('educationLevel'), one(educationLevelLabels, p.educationLevel)],
        [f('fieldOfStudy'), p.fieldOfStudy],
        [f('university'), p.university],
        [f('graduationYear'), p.graduationYear],
      ],
    ],
    [
      'skills',
      [
        [
          f('skillsLegend'),
          Object.keys(p.skills).length
            ? (Object.entries(p.skills) as [Skill, number][]).map(([k, v]) => `${skillLabels[k][locale]} ${v}`).join(' · ')
            : null,
        ],
        [f('cloudPlatforms'), many(cloudPlatformLabels, p.cloudPlatforms)],
        [f('productionTools'), p.productionTools.join(', ') || null],
      ],
    ],
    [
      'goals',
      [
        [f('learningGoals'), many(learningGoalLabels, p.learningGoals)],
        [f('interestedTopics'), many(topicLabels, p.interestedTopics)],
        [f('weeklyHours'), one(weeklyHoursLabels, p.weeklyHours)],
        [f('preferredTimes'), many(sessionTimeLabels, p.preferredTimes)],
        [f('preferredFormat'), one(learningFormatLabels, p.preferredFormat)],
      ],
    ],
    [
      'links',
      [
        [f('linkedinUrl'), link(p.linkedinUrl)],
        [f('githubUrl'), link(p.githubUrl)],
        [f('websiteUrl'), link(p.websiteUrl)],
        [f('kaggleUrl'), link(p.kaggleUrl)],
        [f('huggingfaceUrl'), link(p.huggingfaceUrl)],
      ],
    ],
    [
      'community',
      [
        [f('referralSource'), one(referralSourceLabels, p.referralSource)],
        [f('communityMember'), yes(p.communityMember)],
        [f('openToOpportunities'), yes(p.openToOpportunities)],
        [f('shareWithPartners'), yes(p.shareWithPartners)],
        [f('marketingEmails'), yes(p.marketingEmails)],
      ],
    ],
  ];
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        {t('profile.completeness', { percent: p.completeness })}
        {p.updatedAt && ` · ${t('profile.lastUpdated', { date: formatDate(p.updatedAt, locale) })}`}
      </p>
      {sections.map(([key, rows]) => (
        <section key={key}>
          <h3 className="text-sm font-semibold text-primary">{t(`profile.sections.${key}`)}</h3>
          <dl className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[10rem_1fr] gap-2 border-b border-line py-1.5 text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 break-words text-fg">{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
