import type { ChallengeEntryStatus, ChallengePhase, Locale, PublicChallengeDto } from '@academy/shared';
import Link from 'next/link';
import { BadgeIcon } from '@/components/points/BadgeIcon';
import { Badge, type Tone } from '@/components/ui/Badge';
import type { Translate } from '@/i18n/translator';
import { formatDate } from '@/lib/format';

export const phaseTone: Record<ChallengePhase, Tone> = { open: 'success', upcoming: 'info', closed: 'neutral' };
export const entryTone: Record<ChallengeEntryStatus, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

export const localTitle = (c: { titleEn: string; titleAr: string }, locale: Locale) => (locale === 'ar' ? c.titleAr || c.titleEn : c.titleEn);

/** "16 Nov – 23 Nov 2026" in the viewer's language. */
export function challengeDates(c: { startsAt: string; endsAt: string }, locale: Locale): string {
  return `${formatDate(c.startsAt, locale)} – ${formatDate(c.endsAt, locale)}`;
}

/** One challenge in a list: title, who it's for, dates, reward, finishers, and my entry's status. */
export function ChallengeCard({ c, locale, t, mine }: { c: PublicChallengeDto; locale: Locale; t: Translate; mine?: ChallengeEntryStatus | null }) {
  const badgeName = locale === 'ar' ? c.badge.nameAr || c.badge.nameEn : c.badge.nameEn;
  const headingId = `challenge-${c.slug}`;
  return (
    <article aria-labelledby={headingId} className="flex h-full flex-col rounded-card border border-line bg-card p-5">
      <div className="flex items-start gap-3">
        <BadgeIcon icon={c.badge.icon} name={badgeName} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-lg break-words">
            <Link href={`/${locale}/challenges/${c.slug}`} className="hover:underline">
              {localTitle(c, locale)}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-muted">{challengeDates(c, locale)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={phaseTone[c.phase]}>{t(`challenges.phase.${c.phase}`)}</Badge>
        <Badge tone="neutral">{c.course ? t('challenges.forCourse', { course: localTitle(c.course, locale) }) : t('challenges.forEveryone')}</Badge>
        {mine && <Badge tone={entryTone[mine]}>{t(`challenges.entryStatus.${mine}`)}</Badge>}
      </div>
      <p className="mt-3 text-sm text-body">
        {c.points ? t('challenges.reward', { points: c.points, badge: badgeName }) : t('challenges.rewardBadge', { badge: badgeName })}
      </p>
      <p className="mt-auto pt-3 text-sm text-muted">
        {t('challenges.finishers', { count: c.finishers })}
        {c.finisherNames.length > 0 && (
          <span className="block text-fg">
            {/* Names are in either language: isolate each so "Rana F." keeps its full stop on the Arabic page. */}
            {c.finisherNames.map((name, i) => (
              <span key={`${name}-${i}`}>
                {i > 0 && (locale === 'ar' ? '، ' : ', ')}
                <bdi>{name}</bdi>
              </span>
            ))}
          </span>
        )}
      </p>
    </article>
  );
}
